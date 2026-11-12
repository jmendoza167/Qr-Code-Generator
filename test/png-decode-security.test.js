// Security regression tests for the PNG decoder: decompression bombs,
// oversized declared dimensions and empty images must all be refused with
// a PngDecodeError, and without the decoder allocating much memory.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createDeflate, deflateSync } from 'node:zlib';
import { once } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { decodePng, PngDecodeError, MAX_PNG_DIMENSION, MAX_PNG_PIXELS } from '../src/render/png-decode.js';
import { crc32 } from '../src/render/png.js';
import { makeNoiseImage, encodeWithPngjs } from './helpers/fixtures.js';

const DECODER_URL = pathToFileURL(fileURLToPath(new URL('../src/render/png-decode.js', import.meta.url))).href;
const BIN = fileURLToPath(new URL('../bin/qrgen.js', import.meta.url));
const MB = 1024 * 1024;

function buildPng(chunks) {
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  for (const [type, data] of chunks) {
    const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(typeAndData.length + 8);
    out.writeUInt32BE(data.length, 0);
    typeAndData.copy(out, 4);
    out.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4);
    parts.push(out);
  }
  return Buffer.concat(parts);
}

function ihdr(width, height, bitDepth = 8, colorType = 6) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0);
  b.writeUInt32BE(height, 4);
  b[8] = bitDepth;
  b[9] = colorType;
  return b;
}

const png = (width, height, idat, bitDepth, colorType) =>
  buildPng([
    ['IHDR', ihdr(width, height, bitDepth, colorType)],
    ['IDAT', idat],
    ['IEND', Buffer.alloc(0)],
  ]);

/** Deflate `megabytes` MB of zeros as a stream, so the test itself never holds them in memory. */
async function deflateZeros(megabytes) {
  const deflate = createDeflate({ level: 9 });
  const chunks = [];
  deflate.on('data', (chunk) => chunks.push(chunk));
  const ended = once(deflate, 'end');
  const block = Buffer.alloc(MB);
  for (let i = 0; i < megabytes; i++) {
    if (!deflate.write(block)) await once(deflate, 'drain');
  }
  deflate.end();
  await ended;
  return Buffer.concat(chunks);
}

/**
 * Decode a PNG in a fresh Node process and report the outcome together
 * with that process's peak memory (resourceUsage().maxRSS is in kilobytes).
 */
function decodeInChild(bytes) {
  const script = `
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const { decodePng } = await import(${JSON.stringify(DECODER_URL)});
    let outcome;
    try {
      const image = decodePng(Buffer.concat(chunks));
      outcome = { ok: true, width: image.width, height: image.height };
    } catch (err) {
      outcome = { ok: false, name: err.name, message: err.message };
    }
    outcome.peakMB = process.resourceUsage().maxRSS / 1024;
    console.log(JSON.stringify(outcome));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input: bytes, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const isDecodeError = (pattern) => (err) => {
  assert.ok(err instanceof PngDecodeError, `expected PngDecodeError, got ${err.name}: ${err.message}`);
  assert.match(err.message, pattern);
  return true;
};

describe('decodePng: decompression bombs', () => {
  const BOMB_MB = 768; // what the image data inflates to
  let zeros; // ~750 KB of deflate data
  let baselineMB;

  before(async () => {
    zeros = await deflateZeros(BOMB_MB);
    baselineMB = decodeInChild(encodeWithPngjs(makeNoiseImage(8, 8), { colorType: 6 })).peakMB;
  });

  test('the bomb is small on disk and huge when inflated', () => {
    assert.ok(zeros.length < MB, `compressed size ${zeros.length}`);
  });

  test('a small declared size with image data that inflates to 768 MB is rejected', () => {
    assert.throws(() => decodePng(png(1, 1, zeros)), isDecodeError(/larger than its declared size of 1x1/));
    assert.throws(() => decodePng(png(64, 64, zeros)), isDecodeError(/larger than its declared size/));
    assert.throws(() => decodePng(png(8, 8, zeros, 8, 3)), PngDecodeError); // palette image without PLTE: refused earlier still
  });

  test('rejecting the bomb does not inflate it: peak memory stays near the baseline', () => {
    const outcome = decodeInChild(png(16, 16, zeros));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.name, 'PngDecodeError');
    assert.match(outcome.message, /larger than its declared size/);
    assert.ok(
      outcome.peakMB < baselineMB + 64,
      `decoding the bomb peaked at ${outcome.peakMB.toFixed(0)} MB (a tiny image peaks at ${baselineMB.toFixed(0)} MB)`,
    );
  });

  test('a bomb hidden behind an oversized declared size is rejected before inflating', () => {
    for (const [width, height] of [[20000, 20000], [0xffffffff, 0xffffffff], [MAX_PNG_DIMENSION + 1, 1], [1, MAX_PNG_DIMENSION + 1]]) {
      const outcome = decodeInChild(png(width, height, zeros));
      assert.equal(outcome.name, 'PngDecodeError', `${width}x${height}`);
      assert.match(outcome.message, /too large/, `${width}x${height}`);
      assert.ok(outcome.peakMB < baselineMB + 64, `${width}x${height} peaked at ${outcome.peakMB.toFixed(0)} MB`);
    }
  });

  test('the CLI reports the bomb as a usage error instead of running out of memory', async () => {
    const { mkdtempSync, writeFileSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'qrgen-bomb-'));
    try {
      const logo = join(dir, 'bomb.png');
      const out = join(dir, 'out.png');
      writeFileSync(logo, png(32, 32, zeros));
      const result = spawnSync(process.execPath, [BIN, 'x', '-o', out, '--logo', logo], { input: '', encoding: 'utf8' });
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /bomb\.png: Corrupt PNG file \(the image data is larger than its declared size of 32x32\)/);
      assert.equal(existsSync(out), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('decodePng: declared dimensions are validated before inflating', () => {
  const tiny = deflateSync(Buffer.alloc(5));

  test('the cap is 4096 x 4096 (16 megapixels)', () => {
    assert.equal(MAX_PNG_DIMENSION, 4096);
    assert.equal(MAX_PNG_PIXELS, 16 * 1024 * 1024);
  });

  test('oversized width, height or both are rejected with a clear error', () => {
    for (const [width, height] of [
      [4097, 1],
      [1, 4097],
      [4097, 4097],
      [100000, 100000],
      [0x7fffffff, 0x7fffffff],
      [0xffffffff, 1],
      [1, 0xffffffff],
      [0xffffffff, 0xffffffff],
    ]) {
      assert.throws(() => decodePng(png(width, height, tiny)), isDecodeError(new RegExp(`too large \\(${width}x${height}\\).*4096x4096`)), `${width}x${height}`);
    }
  });

  test('the size check happens before the image data is touched', () => {
    // Not even valid deflate data: if the decoder inflated first, the error would be about that.
    const garbage = Buffer.from('this is not a zlib stream');
    assert.throws(() => decodePng(png(5000, 5000, garbage)), isDecodeError(/too large/));
    assert.throws(() => decodePng(png(0, 0, garbage)), isDecodeError(/no pixels/));
  });

  test('a 0x0 image, and any image with a zero side, is rejected', () => {
    for (const [width, height] of [[0, 0], [0, 10], [10, 0], [0, 0xffffffff]]) {
      assert.throws(
        () => decodePng(png(width, height, deflateSync(Buffer.alloc(0)))),
        isDecodeError(new RegExp(`no pixels \\(its size is ${width}x${height}\\)`)),
        `${width}x${height}`,
      );
    }
  });

  test('a malformed IHDR chunk is rejected', () => {
    const short = buildPng([['IHDR', Buffer.alloc(4)], ['IDAT', tiny], ['IEND', Buffer.alloc(0)]]);
    assert.throws(() => decodePng(short), isDecodeError(/IHDR/));
    const twice = buildPng([['IHDR', ihdr(1, 1)], ['IHDR', ihdr(1, 1)], ['IDAT', tiny], ['IEND', Buffer.alloc(0)]]);
    assert.throws(() => decodePng(twice), isDecodeError(/IHDR/));
  });

  test('images at the limit are still accepted', () => {
    // 4096 x 1 and 1 x 4096 RGBA, all zeros.
    const wide = decodePng(png(4096, 1, deflateSync(Buffer.alloc(1 + 4096 * 4))));
    assert.equal(wide.width, 4096);
    assert.equal(wide.data.length, 4096 * 4);
    const tall = decodePng(png(1, 4096, deflateSync(Buffer.alloc(4096 * 5))));
    assert.equal(tall.height, 4096);
  });

  test('image data shorter than the declared size is still reported as truncated', () => {
    assert.throws(() => decodePng(png(4, 4, deflateSync(Buffer.alloc(10)))), isDecodeError(/Truncated/));
  });
});
