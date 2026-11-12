import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import pngjs from 'pngjs';
import { renderPng } from '../src/render/png.js';
import { encode } from '../src/core/qr.js';
import { buildWifiPayload } from '../src/presets/wifi.js';
import { buildVCard } from '../src/presets/vcard.js';
import { decodeRgba } from './helpers/decode.js';

const { PNG } = pngjs;

function pixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

function decodeBuffer(buf) {
  const png = PNG.sync.read(buf);
  return decodeRgba(png.data, png.width, png.height);
}

const ihdr = (buf) => ({ bitDepth: buf[24], colorType: buf[25] });

describe('renderPng: plain fast path is untouched', () => {
  const qr = encode('plain png');

  test('default options and explicit default style produce identical 1-bit palette files', () => {
    const plain = renderPng(qr.matrix, { scale: 4 });
    const explicit = renderPng(qr.matrix, { scale: 4, shape: 'square', finder: 'square' });
    assert.deepEqual(explicit, plain);
    assert.deepEqual(ihdr(plain), { bitDepth: 1, colorType: 3 });
  });

  test('custom flat colours still use the 1-bit palette', () => {
    assert.deepEqual(ihdr(renderPng(qr.matrix, { scale: 4, fg: '#123456', bg: '#fedcba' })), { bitDepth: 1, colorType: 3 });
  });
});

describe('renderPng: styled output', () => {
  const qr = encode('styled png', { ecc: 'M' });

  test('switches to 8-bit RGBA when a style is used', () => {
    const buf = renderPng(qr.matrix, { scale: 4, shape: 'dots' });
    assert.deepEqual(ihdr(buf), { bitDepth: 8, colorType: 6 });
    const png = PNG.sync.read(buf);
    assert.equal(png.width, (qr.size + 8) * 4);
    assert.deepEqual(pixel(png, 0, 0), [255, 255, 255, 255]);
  });

  test('curved shapes are anti-aliased (intermediate grey pixels exist)', () => {
    const png = PNG.sync.read(renderPng(qr.matrix, { scale: 8, shape: 'dots', finder: 'circle' }));
    let intermediate = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i] > 0 && png.data[i] < 255) intermediate++;
    }
    assert.ok(intermediate > 100, `only ${intermediate} anti-aliased pixels`);
  });

  test('square shapes keep hard edges even on the RGBA path', () => {
    const png = PNG.sync.read(renderPng(qr.matrix, { scale: 8, finderColor: '#ff0000' }));
    for (let i = 0; i < png.data.length; i += 4) {
      assert.ok(png.data[i] === 0 || png.data[i] === 255, `pixel ${i / 4} red channel ${png.data[i]}`);
    }
  });

  test('finder colour is used for the finders only; fg for data; bg for the quiet zone', () => {
    const scale = 4;
    const margin = 4;
    const png = PNG.sync.read(renderPng(qr.matrix, { scale, margin, finderColor: '#ff0000', fg: '#0000ff', bg: '#ffffff' }));
    const at = (row, col) => pixel(png, (col + margin) * scale + 2, (row + margin) * scale + 2);
    assert.deepEqual(at(0, 0), [255, 0, 0, 255]); // finder frame
    assert.deepEqual(at(3, 3), [255, 0, 0, 255]); // finder centre
    assert.deepEqual(at(1, 1), [255, 255, 255, 255]); // finder light ring
    assert.deepEqual(at(6, 8), [0, 0, 255, 255]); // timing module (dark) is "data"
    assert.deepEqual(at(0, 7), [255, 255, 255, 255]); // separator
    assert.deepEqual(pixel(png, 1, 1), [255, 255, 255, 255]);
  });

  test('horizontal gradient: left finder is the start colour, right finder the end colour', () => {
    const scale = 4;
    const margin = 2;
    const png = PNG.sync.read(
      renderPng(qr.matrix, { scale, margin, gradient: '#ff0000,#0000ff', gradientDir: 'horizontal' }),
    );
    const left = pixel(png, margin * scale, margin * scale + 2);
    const right = pixel(png, (margin + qr.size) * scale - 1, margin * scale + 2);
    assert.ok(left[0] > 240 && left[2] < 15, `left ${left}`);
    assert.ok(right[2] > 240 && right[0] < 15, `right ${right}`);
  });

  test('radial gradient: centre colour at the middle, end colour at the corners', () => {
    const scale = 4;
    const margin = 2;
    const png = PNG.sync.read(
      renderPng(qr.matrix, { scale, margin, gradient: '#00ff00,#000000', gradientDir: 'radial', finderColor: '#00ff00' }),
    );
    // the timing pattern at (6, 8) is dark and far from the centre of a 21-module symbol
    const corner = pixel(png, margin * scale, margin * scale);
    assert.deepEqual(corner, [0, 255, 0, 255]); // finder colour overrides the gradient
    let darkestGreen = 255;
    let brightestGreen = 0;
    for (let i = 0; i < png.data.length; i += 4) {
      if (png.data[i + 3] === 255 && png.data[i] === 0 && png.data[i + 2] === 0 && png.data[i + 1] < 250) {
        darkestGreen = Math.min(darkestGreen, png.data[i + 1]);
        brightestGreen = Math.max(brightestGreen, png.data[i + 1]);
      }
    }
    assert.ok(darkestGreen < 100 && brightestGreen > 150, `${darkestGreen}..${brightestGreen}`);
  });
});

describe('renderPng: styled output decodes with jsQR', () => {
  const text = 'https://github.com/jmendoza167/Qr-Code-Generator';
  const qr = encode(text);

  for (const shape of ['square', 'rounded', 'dots']) {
    for (const finder of ['square', 'rounded', 'circle']) {
      test(`shape ${shape}, finder ${finder}`, () => {
        const decoded = decodeBuffer(renderPng(qr.matrix, { scale: 5, shape, finder }));
        assert.ok(decoded, 'jsQR returned null');
        assert.equal(decoded.data, text);
      });
    }
  }

  for (const gradientDir of ['horizontal', 'vertical', 'diagonal', 'radial']) {
    test(`gradient ${gradientDir} with rounded modules and a finder colour`, () => {
      const decoded = decodeBuffer(
        renderPng(qr.matrix, { scale: 5, shape: 'rounded', gradient: '#1a237e,#006064', gradientDir, finderColor: '#b71c1c' }),
      );
      assert.ok(decoded, 'jsQR returned null');
      assert.equal(decoded.data, text);
    });
  }

  test('a larger symbol (version 10+) with dots', () => {
    const long = 'dots '.repeat(60);
    const big = encode(long, { ecc: 'Q' });
    assert.ok(big.version >= 10);
    const decoded = decodeBuffer(renderPng(big.matrix, { scale: 4, shape: 'dots', finder: 'rounded' }));
    assert.ok(decoded, 'jsQR returned null');
    assert.equal(decoded.data, long);
  });

  test('Wi-Fi payload with dots and circle finders', () => {
    const payload = buildWifiPayload({ ssid: 'Café;Net', password: 'p,a:s"s', hidden: true });
    const decoded = decodeBuffer(renderPng(encode(payload, { ecc: 'H' }).matrix, { scale: 5, shape: 'dots', finder: 'circle' }));
    assert.ok(decoded, 'jsQR returned null');
    assert.equal(decoded.data, payload);
  });

  test('vCard payload with rounded modules and a gradient', () => {
    const payload = buildVCard({ name: 'José Núñez', phones: ['+34600000000'], emails: ['jose@example.com'] });
    const decoded = decodeBuffer(
      renderPng(encode(payload).matrix, { scale: 5, shape: 'rounded', gradient: '#000000,#1b5e20', gradientDir: 'vertical' }),
    );
    assert.ok(decoded, 'jsQR returned null');
    assert.equal(decoded.data, payload);
  });
});
