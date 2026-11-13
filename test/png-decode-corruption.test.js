// Regression tests for the PNG decoder's corruption paths: a chunk whose CRC
// does not match, a scanline with an unknown filter type, a colour type /
// bit depth combination the decoder does not handle, and image data that is
// not a valid zlib stream. Every malformed file is built in code from one
// known-good 3x2 RGBA image, so each test changes exactly one thing, and each
// must be refused with a PngDecodeError that names the problem, quickly and
// without allocating much.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { decodePng, PngDecodeError } from '../src/render/png-decode.js';
import { buildPng, ihdr } from './helpers/png-chunks.js';

const DECODER_URL = pathToFileURL(fileURLToPath(new URL('../src/render/png-decode.js', import.meta.url))).href;

const WIDTH = 3;
const HEIGHT = 2;
const STRIDE = WIDTH * 4; // RGBA bytes per row

/**
 * Raw (pre-compression) scanlines for a width x height RGBA image: one
 * filter byte per row followed by distinct pixel bytes. `filters` gives the
 * filter byte for each row (the last value repeats).
 */
function rawRows(filters = [0], { width = WIDTH, height = HEIGHT } = {}) {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filters[Math.min(y, filters.length - 1)];
    for (let i = 0; i < stride; i++) raw[y * (stride + 1) + 1 + i] = (y * stride + i + 1) & 0xff;
  }
  return raw;
}

/** A complete PNG file: IHDR, one IDAT holding `idat`, IEND; all CRCs correct. */
function pngWith(idat, { width = WIDTH, height = HEIGHT, bitDepth = 8, colorType = 6 } = {}) {
  return buildPng([
    ['IHDR', ihdr(width, height, bitDepth, colorType)],
    ['IDAT', idat],
    ['IEND', Buffer.alloc(0)],
  ]);
}

const VALID_RAW = rawRows();
const VALID_IDAT = deflateSync(VALID_RAW);
const VALID = pngWith(VALID_IDAT);

/** Byte offsets of the named chunk inside a PNG file. */
function locate(bytes, type) {
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(pos);
    if (bytes.toString('latin1', pos + 4, pos + 8) === type) {
      return { dataStart: pos + 8, dataEnd: pos + 8 + length, crcStart: pos + 8 + length };
    }
    pos += 12 + length;
  }
  throw new Error(`no ${type} chunk`);
}

/** A copy of `bytes` with the byte at `offset` inverted. */
function flipByte(bytes, offset) {
  const copy = Buffer.from(bytes);
  copy[offset] ^= 0xff;
  return copy;
}

/**
 * Assert that decoding `bytes` throws a PngDecodeError whose message
 * matches `pattern`, returns promptly, and is never mistaken for the
 * decompression-bomb error (the one corruption path that was already
 * covered before these tests).
 */
function assertRejected(bytes, pattern, label = '') {
  const started = performance.now();
  assert.throws(
    () => decodePng(bytes),
    (err) => {
      assert.ok(err instanceof PngDecodeError, `${label} expected PngDecodeError, got ${err.name}: ${err.message}`);
      assert.match(err.message, pattern, label);
      assert.doesNotMatch(err.message, /larger than its declared size/, label);
      return true;
    },
  );
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `${label} took ${elapsed.toFixed(0)} ms to reject`);
}

test('the known-good image the corruptions are derived from decodes', () => {
  const { width, height, data } = decodePng(VALID);
  assert.equal(width, WIDTH);
  assert.equal(height, HEIGHT);
  // Filter 0 rows: the pixels come out exactly as written.
  assert.deepEqual([...data.subarray(0, STRIDE)], [...VALID_RAW.subarray(1, 1 + STRIDE)]);
});

describe('decodePng: chunk CRC errors', () => {
  test('a wrong CRC on any chunk is reported with that chunk name', () => {
    for (const type of ['IHDR', 'IDAT', 'IEND']) {
      const { crcStart } = locate(VALID, type);
      for (let i = 0; i < 4; i++) {
        assertRejected(flipByte(VALID, crcStart + i), new RegExp(`^Corrupt PNG file \\(bad CRC in ${type} chunk\\)$`), `${type} CRC byte ${i}`);
      }
    }
  });

  test('a flipped byte in IHDR data fails the CRC before the header is interpreted', () => {
    const { dataStart } = locate(VALID, 'IHDR');
    // Byte 1 of the width: as a header this would be a 65539-pixel-wide image,
    // which has its own "too large" error. The CRC check must win.
    assertRejected(flipByte(VALID, dataStart + 1), /bad CRC in IHDR chunk/, 'width byte');
    assertRejected(flipByte(VALID, dataStart + 9), /bad CRC in IHDR chunk/, 'colour type byte');
  });

  test('a flipped byte in IDAT data fails the CRC before anything is inflated', () => {
    const { dataStart, dataEnd } = locate(VALID, 'IDAT');
    for (const offset of [dataStart, dataStart + 2, dataEnd - 1]) {
      assertRejected(flipByte(VALID, offset), /^Corrupt PNG file \(bad CRC in IDAT chunk\)$/, `IDAT data byte ${offset - dataStart}`);
    }
  });

  test('a wrong CRC on a chunk the decoder otherwise ignores is still an error', () => {
    const withText = buildPng([
      ['IHDR', ihdr(WIDTH, HEIGHT)],
      ['tEXt', Buffer.from('Comment\0hello', 'latin1')],
      ['IDAT', VALID_IDAT],
      ['IEND', Buffer.alloc(0)],
    ]);
    assert.equal(decodePng(withText).width, WIDTH, 'the file is fine with a correct CRC');
    assertRejected(flipByte(withText, locate(withText, 'tEXt').crcStart), /bad CRC in tEXt chunk/);
  });
});

describe('decodePng: unknown scanline filter types', () => {
  test('a filter byte outside 0-4 is rejected and named', () => {
    for (const filter of [5, 6, 100, 255]) {
      const png = pngWith(deflateSync(rawRows([filter])));
      assertRejected(png, new RegExp(`^Corrupt PNG file \\(unknown filter type ${filter}\\)$`), `filter ${filter}`);
    }
  });

  test('the bad filter byte is caught on whichever row it is on', () => {
    // Valid filters on the first rows, then the bad one.
    assertRejected(pngWith(deflateSync(rawRows([0, 7]))), /unknown filter type 7/, 'second row');
    assertRejected(pngWith(deflateSync(rawRows([1, 2, 3, 4, 9], { height: 5 })), { height: 5 }), /unknown filter type 9/, 'last of five rows');
  });

  test('a one-pixel-wide image with a bad filter byte', () => {
    assertRejected(pngWith(deflateSync(rawRows([200], { width: 1, height: 1 })), { width: 1, height: 1 }), /unknown filter type 200/);
  });
});

describe('decodePng: unsupported colour type / bit depth combinations', () => {
  const unsupported = (colorType, bitDepth) =>
    new RegExp(`^Unsupported PNG \\(colour type ${colorType}, bit depth ${bitDepth}\\): re-save it as 8-bit RGB or RGBA$`);

  test('colour types that do not exist', () => {
    for (const colorType of [1, 5, 7, 8, 255]) {
      assertRejected(pngWith(VALID_IDAT, { colorType }), unsupported(colorType, 8), `colour type ${colorType}`);
    }
  });

  test('sub-byte depths are only valid for palette images', () => {
    for (const colorType of [0, 2, 4, 6]) {
      for (const bitDepth of [1, 2, 4]) {
        assertRejected(pngWith(VALID_IDAT, { colorType, bitDepth }), unsupported(colorType, bitDepth), `colour type ${colorType} depth ${bitDepth}`);
      }
    }
  });

  test('palette images with a depth that is not 1, 2, 4 or 8', () => {
    const palette = Buffer.from([0, 0, 0]);
    for (const bitDepth of [0, 3, 5, 6, 7, 12]) {
      const png = buildPng([
        ['IHDR', ihdr(WIDTH, HEIGHT, bitDepth, 3)],
        ['PLTE', palette],
        ['IDAT', VALID_IDAT],
        ['IEND', Buffer.alloc(0)],
      ]);
      assertRejected(png, unsupported(3, bitDepth), `palette depth ${bitDepth}`);
    }
  });

  test('a bit depth of 0 or an unknown one for RGBA', () => {
    for (const bitDepth of [0, 3, 7, 32]) {
      assertRejected(pngWith(VALID_IDAT, { bitDepth }), unsupported(6, bitDepth), `depth ${bitDepth}`);
    }
  });

  test('16-bit keeps its own, more helpful message', () => {
    assertRejected(pngWith(VALID_IDAT, { bitDepth: 16 }), /^16-bit PNGs are not supported/);
    assertRejected(pngWith(VALID_IDAT, { bitDepth: 16, colorType: 3 }), /^16-bit PNGs are not supported/);
  });

  test('the header is checked before the image data is touched', () => {
    // Garbage image data: if the decoder inflated first, the error would be about that.
    assertRejected(pngWith(Buffer.from('not a zlib stream'), { colorType: 7 }), unsupported(7, 8));
  });
});

describe('decodePng: image data that is not a valid zlib stream', () => {
  const corrupt = /^Corrupt PNG file \(.+\)$/;

  test('IDAT holding bytes that are not a zlib stream at all', () => {
    assertRejected(pngWith(Buffer.from('this is not a zlib stream')), /^Corrupt PNG file \(incorrect header check\)$/);
  });

  test('a zlib stream with a corrupted body', () => {
    // Flip a byte inside the deflate data (not the 2-byte header, not the
    // 4-byte Adler-32 trailer) and re-wrap it with a correct chunk CRC.
    const bodyStart = 2;
    const bodyEnd = VALID_IDAT.length - 4;
    assert.ok(bodyEnd > bodyStart, 'the deflate body is not empty');
    let rejected = 0;
    for (let i = bodyStart; i < bodyEnd; i++) {
      const idat = flipByte(VALID_IDAT, i);
      let threw = false;
      try {
        decodePng(pngWith(idat));
      } catch (err) {
        threw = true;
        assert.ok(err instanceof PngDecodeError, `byte ${i}: ${err.name}: ${err.message}`);
        assert.match(err.message, corrupt, `byte ${i}`);
        assert.doesNotMatch(err.message, /larger than its declared size/, `byte ${i}`);
        rejected++;
      }
      // A flip that happens to leave a decodable stream is allowed (zlib's
      // checksum is not perfect), but the decoder must then produce a
      // complete image rather than garbage of the wrong size.
      if (!threw) assert.equal(decodePng(pngWith(idat)).data.length, WIDTH * HEIGHT * 4, `byte ${i}`);
    }
    assert.ok(rejected > 0, 'at least one corrupted body is detected');
  });

  test('a zlib stream with a wrong Adler-32 checksum', () => {
    assertRejected(pngWith(flipByte(VALID_IDAT, VALID_IDAT.length - 1)), /^Corrupt PNG file \(incorrect data check\)$/);
  });

  test('a zlib stream cut short, and an empty IDAT chunk', () => {
    assertRejected(pngWith(VALID_IDAT.subarray(0, VALID_IDAT.length - 6)), /^Corrupt PNG file \(unexpected end of file\)$/, 'cut short');
    assertRejected(pngWith(VALID_IDAT.subarray(0, 2)), /^Corrupt PNG file \(unexpected end of file\)$/, 'header only');
    assertRejected(pngWith(Buffer.alloc(0)), /^Corrupt PNG file \(unexpected end of file\)$/, 'empty IDAT');
  });

  test('the same corruptions are detected when the stream is split over several IDAT chunks', () => {
    const garbage = Buffer.from('this is not a zlib stream');
    const chunks = [['IHDR', ihdr(WIDTH, HEIGHT)]];
    for (let i = 0; i < garbage.length; i += 4) chunks.push(['IDAT', garbage.subarray(i, i + 4)]);
    chunks.push(['IEND', Buffer.alloc(0)]);
    assertRejected(buildPng(chunks), /incorrect header check/);
  });
});

describe('decodePng: rejecting corrupt files is quick and cheap', () => {
  // The same corruptions, but with a 1024 x 1024 declared size (4 MB of
  // pixels), decoded in a fresh Node process whose peak memory is measured.
  const BIG = 1024;
  const cases = {
    'bad CRC': flipByte(pngWith(deflateSync(rawRows([0], { width: BIG, height: BIG })), { width: BIG, height: BIG }), 29),
    'unknown filter type': pngWith(deflateSync(rawRows([0, 0, 0, 5], { width: BIG, height: BIG })), { width: BIG, height: BIG }),
    'unsupported colour type': pngWith(VALID_IDAT, { width: BIG, height: BIG, colorType: 7 }),
    'garbage image data': pngWith(Buffer.from('this is not a zlib stream'), { width: BIG, height: BIG }),
    'truncated image data': pngWith(VALID_IDAT, { width: BIG, height: BIG }),
  };
  let outcomes;
  let peakMB;
  let baselineMB;
  let elapsedMs;

  /** Decode every file in one child process; report each outcome and the process's peak RSS. */
  function decodeInChild(files) {
    const script = `
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const { decodePng } = await import(${JSON.stringify(DECODER_URL)});
      const files = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const outcomes = {};
      for (const [label, base64] of Object.entries(files)) {
        const started = performance.now();
        try {
          const image = decodePng(Buffer.from(base64, 'base64'));
          outcomes[label] = { ok: true, width: image.width };
        } catch (err) {
          outcomes[label] = { ok: false, name: err.name, message: err.message };
        }
        outcomes[label].ms = performance.now() - started;
      }
      console.log(JSON.stringify({ outcomes, peakMB: process.resourceUsage().maxRSS / 1024 }));
    `;
    const input = JSON.stringify(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString('base64')])));
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { input, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  }

  before(() => {
    baselineMB = decodeInChild({ valid: VALID }).peakMB;
    const started = performance.now();
    ({ outcomes, peakMB } = decodeInChild(cases));
    elapsedMs = performance.now() - started;
  });

  test('every corrupt file is refused with a PngDecodeError', () => {
    const expected = {
      'bad CRC': /bad CRC in IHDR chunk/,
      'unknown filter type': /unknown filter type 5/,
      'unsupported colour type': /Unsupported PNG \(colour type 7, bit depth 8\)/,
      'garbage image data': /incorrect header check/,
      'truncated image data': /^Truncated PNG image data$/,
    };
    for (const [label, pattern] of Object.entries(expected)) {
      assert.equal(outcomes[label].ok, false, label);
      assert.equal(outcomes[label].name, 'PngDecodeError', label);
      assert.match(outcomes[label].message, pattern, label);
    }
  });

  test('each rejection takes well under a second', () => {
    for (const [label, outcome] of Object.entries(outcomes)) {
      assert.ok(outcome.ms < 1000, `${label} took ${outcome.ms.toFixed(0)} ms`);
    }
    assert.ok(elapsedMs < 15000, `the whole child process took ${elapsedMs.toFixed(0)} ms`);
  });

  test('peak memory stays near that of decoding a tiny valid image', () => {
    assert.ok(peakMB < baselineMB + 64, `peaked at ${peakMB.toFixed(0)} MB (baseline ${baselineMB.toFixed(0)} MB)`);
  });
});
