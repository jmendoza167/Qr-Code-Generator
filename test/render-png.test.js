import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import pngjs from 'pngjs';
import { renderPng, crc32 } from '../src/render/png.js';
import { encode } from '../src/core/qr.js';
import { decodeRgba } from './helpers/decode.js';

const { PNG } = pngjs;
const T = true;
const F = false;

function pixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

describe('crc32', () => {
  test('matches the standard check value for "123456789"', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  });

  test('empty input is 0', () => {
    assert.equal(crc32(new Uint8Array(0)), 0);
  });
});

describe('renderPng', () => {
  test('starts with the PNG signature and ends with an IEND chunk', () => {
    const png = renderPng([[T]]);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(png.subarray(png.length - 8, png.length - 4).toString('latin1'), 'IEND');
  });

  test('pngjs can parse it: dimensions, module colours and quiet zone', () => {
    const buf = renderPng([[T, F], [F, T]], { scale: 3, margin: 1, fg: '#ff0000', bg: '#00ff00' });
    const png = PNG.sync.read(buf);
    assert.equal(png.width, 12);
    assert.equal(png.height, 12);
    assert.deepEqual(pixel(png, 0, 0), [0, 255, 0, 255]); // quiet zone
    assert.deepEqual(pixel(png, 3, 3), [255, 0, 0, 255]); // (0,0) dark
    assert.deepEqual(pixel(png, 5, 5), [255, 0, 0, 255]); // still inside module (0,0)
    assert.deepEqual(pixel(png, 6, 3), [0, 255, 0, 255]); // (0,1) light
    assert.deepEqual(pixel(png, 8, 8), [255, 0, 0, 255]); // (1,1) dark
    assert.deepEqual(pixel(png, 11, 11), [0, 255, 0, 255]); // quiet zone
  });

  test('widths that are not a multiple of 8 pixels pack correctly (1-bit rows are byte padded)', () => {
    const row = [T, F, T, F, T, F, T, F, T, T, F]; // 11 modules
    const png = PNG.sync.read(renderPng([row], { scale: 1, margin: 0 }));
    assert.equal(png.width, 11);
    for (let x = 0; x < 11; x++) {
      assert.deepEqual(pixel(png, x, 0), row[x] ? [0, 0, 0, 255] : [255, 255, 255, 255], `x=${x}`);
    }
  });

  test('defaults: scale 10, margin 4, black on white', () => {
    const qr = encode('png defaults');
    const png = PNG.sync.read(renderPng(qr.matrix));
    assert.equal(png.width, (qr.size + 8) * 10);
    assert.deepEqual(pixel(png, 0, 0), [255, 255, 255, 255]);
    assert.deepEqual(pixel(png, 40, 40), [0, 0, 0, 255]); // top-left finder corner
  });

  test('a rendered QR decodes with jsQR', () => {
    const text = 'PNG round trip with UTF-8: ñ 😀';
    const qr = encode(text, { ecc: 'Q' });
    const png = PNG.sync.read(renderPng(qr.matrix, { scale: 4 }));
    const decoded = decodeRgba(png.data, png.width, png.height);
    assert.ok(decoded, 'jsQR returned null');
    assert.equal(decoded.data, text);
  });

  test('a large symbol (version 40) still produces a valid, decodable PNG', () => {
    const text = 'v40 '.repeat(720); // 2880 bytes: more than version 39-L holds (2812)
    const qr = encode(text, { ecc: 'L' });
    assert.equal(qr.version, 40);
    const png = PNG.sync.read(renderPng(qr.matrix, { scale: 4 }));
    assert.equal(png.width, (177 + 8) * 4);
    const decoded = decodeRgba(png.data, png.width, png.height);
    assert.ok(decoded, 'jsQR returned null');
    assert.equal(decoded.data, text);
  });

  test('validation', () => {
    assert.throws(() => renderPng([[T]], { scale: 0 }), RangeError);
    assert.throws(() => renderPng([[T]], { margin: -1 }), RangeError);
    assert.throws(() => renderPng([[T]], { bg: 'white' }), RangeError);
  });
});
