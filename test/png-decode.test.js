import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import pngjs from 'pngjs';
import { decodePng, PngDecodeError } from '../src/render/png-decode.js';
import { renderPng, crc32 } from '../src/render/png.js';
import { encode } from '../src/core/qr.js';
import { makeNoiseImage, encodeWithPngjs } from './helpers/fixtures.js';

const { PNG } = pngjs;

/** Decode with pngjs (reference) and with ours, compare RGBA byte for byte. */
function assertSameAsPngjs(buffer, label) {
  const ref = PNG.sync.read(buffer);
  const ours = decodePng(buffer);
  assert.equal(ours.width, ref.width, `${label} width`);
  assert.equal(ours.height, ref.height, `${label} height`);
  assert.deepEqual(Buffer.from(ours.data), Buffer.from(ref.data), `${label} pixels`);
}

/** Build a PNG by hand from chunks (for cases pngjs cannot write). */
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

function ihdr(width, height, bitDepth, colorType, interlace = 0) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0);
  b.writeUInt32BE(height, 4);
  b[8] = bitDepth;
  b[9] = colorType;
  b[12] = interlace;
  return b;
}

describe('decodePng: supported colour types (8-bit, non-interlaced)', () => {
  const noise = makeNoiseImage(13, 7); // odd sizes exercise row padding and Paeth edges

  test('RGBA (colour type 6)', () => {
    assertSameAsPngjs(encodeWithPngjs(noise, { colorType: 6 }), 'rgba');
  });

  test('RGB (colour type 2)', () => {
    assertSameAsPngjs(encodeWithPngjs(makeNoiseImage(13, 7, { opaque: true }), { colorType: 2 }), 'rgb');
  });

  test('grayscale (colour type 0) and grayscale + alpha (colour type 4)', () => {
    assertSameAsPngjs(encodeWithPngjs(noise, { colorType: 0 }), 'gray');
    assertSameAsPngjs(encodeWithPngjs(noise, { colorType: 4 }), 'gray+alpha');
  });

  test('every filter type (None, Sub, Up, Average, Paeth)', () => {
    for (const filterType of [0, 1, 2, 3, 4]) {
      assertSameAsPngjs(encodeWithPngjs(noise, { colorType: 6, filterType }), `filter ${filterType}`);
    }
  });

  test('1-bit palette (our own plain QR output)', () => {
    const qr = encode('palette');
    const buffer = renderPng(qr.matrix, { scale: 3, fg: '#102030', bg: '#f0e0d0' });
    assertSameAsPngjs(buffer, 'palette 1-bit');
  });

  test('8-bit palette with tRNS transparency', () => {
    // 4x2 image, 3 palette entries, the third fully transparent.
    const palette = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const trns = Buffer.from([255, 128]); // entry 2 defaults to 255
    const rows = Buffer.from([0, 0, 1, 2, 2, 0, 2, 1, 0, 0]); // filter byte + 4 indices, twice
    const png = buildPng([
      ['IHDR', ihdr(4, 2, 8, 3)],
      ['PLTE', palette],
      ['tRNS', trns],
      ['IDAT', deflateSync(rows)],
      ['IEND', Buffer.alloc(0)],
    ]);
    const { width, height, data } = decodePng(png);
    assert.equal(width, 4);
    assert.equal(height, 2);
    assert.deepEqual([...data.subarray(0, 16)], [255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 0, 0, 255, 255]);
    assert.deepEqual([...data.subarray(16, 32)], [0, 0, 255, 255, 0, 255, 0, 128, 255, 0, 0, 255, 255, 0, 0, 255]);
    assertSameAsPngjs(png, 'palette + tRNS');
  });

  test('IDAT split across several chunks', () => {
    const img = makeNoiseImage(5, 5, { opaque: true });
    const single = encodeWithPngjs(img, { colorType: 2, filterType: 0 });
    // Re-pack: raw rows -> compressed -> split into 7-byte IDAT chunks.
    const raw = Buffer.alloc(5 * (1 + 15));
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const s = (y * 5 + x) * 4;
        raw.set(img.data.subarray(s, s + 3), y * 16 + 1 + x * 3);
      }
    }
    const z = deflateSync(raw);
    const chunks = [['IHDR', ihdr(5, 5, 8, 2)]];
    for (let i = 0; i < z.length; i += 7) chunks.push(['IDAT', z.subarray(i, i + 7)]);
    chunks.push(['IEND', Buffer.alloc(0)]);
    const split = buildPng(chunks);
    assert.deepEqual(Buffer.from(decodePng(split).data), Buffer.from(decodePng(single).data));
  });
});

describe('decodePng: clear errors for unsupported input', () => {
  test('JPEG', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
    assert.throws(() => decodePng(jpeg), (err) => err instanceof PngDecodeError && /JPEG/.test(err.message) && /PNG/.test(err.message));
  });

  test('something that is not an image at all', () => {
    assert.throws(() => decodePng(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), /not a PNG/i);
    assert.throws(() => decodePng(Buffer.alloc(0)), /not a PNG/i);
  });

  test('interlaced', () => {
    const png = buildPng([
      ['IHDR', ihdr(2, 2, 8, 6, 1)],
      ['IDAT', deflateSync(Buffer.alloc(20))],
      ['IEND', Buffer.alloc(0)],
    ]);
    assert.throws(() => decodePng(png), /interlaced/i);
  });

  test('16-bit', () => {
    const png = encodeWithPngjs(makeNoiseImage(3, 3), { colorType: 6, bitDepth: 16 });
    assert.throws(() => decodePng(png), /16-bit/i);
  });

  test('truncated file', () => {
    const png = encodeWithPngjs(makeNoiseImage(9, 9), { colorType: 6 });
    assert.throws(() => decodePng(png.subarray(0, 40)), PngDecodeError);
  });
});
