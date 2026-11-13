// The image side of the decoder: binarizing RGBA pixels, locating the three
// finder patterns, sampling the module grid, and decodeQr end to end on
// real qrgen output (renderPng -> decodePng), with jsQR as the reference.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { binarize } from '../src/decode/binarize.js';
import { findFinderPatterns, rankTriples } from '../src/decode/finder.js';
import { decodeQr } from '../src/decode/decode.js';
import { decodeQrPng } from '../src/decode/from-png.js';
import { NoQrFoundError, QrDecodeError, FormatUnreadableError } from '../src/decode/errors.js';
import { encode } from '../src/core/qr.js';
import { formatInfoPositions } from '../src/core/matrix.js';
import { encodeWithLogo } from '../src/render/logo.js';
import { renderPng } from '../src/render/png.js';
import { decodePng } from '../src/render/png-decode.js';
import { decodeRgba, rasterize } from './helpers/decode.js';
import { renderRgba, rotateRgba, mirrorRgba, pasteRgba, blitRgba, solidRgba, noiseRgba } from './helpers/image.js';
import { makeLogoImage, encodeWithPngjs } from './helpers/fixtures.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEVELS = ['L', 'M', 'Q', 'H'];

/** Decode with jsQR and require the same text as ours. */
function assertAgreesWithJsqr(image, ours, label) {
  const reference = decodeRgba(image.data, image.width, image.height);
  assert.ok(reference, `${label}: jsQR could not read the image`);
  assert.equal(ours.text, reference.data, `${label}: jsQR disagrees`);
}

describe('binarize', () => {
  test('black on white: dark pixels become 1, light pixels 0, size preserved', () => {
    const qr = encode('binarize', { ecc: 'L' });
    const image = renderRgba(qr.matrix, { scale: 4, margin: 4 });
    const bitmap = binarize(image);
    assert.equal(bitmap.width, image.width);
    assert.equal(bitmap.height, image.height);
    assert.equal(bitmap.bits.length, image.width * image.height);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const expected = image.data[(y * image.width + x) * 4] < 128 ? 1 : 0;
        assert.equal(bitmap.bits[y * image.width + x], expected, `pixel ${x},${y}`);
      }
    }
  });

  test('a uniform image is all light, whatever its shade', () => {
    for (const shade of [0, 60, 128, 200, 255]) {
      const bitmap = binarize(solidRgba(64, 48, [shade, shade, shade]));
      assert.equal(bitmap.bits.some((b) => b === 1), false, `shade ${shade}`);
    }
  });

  test('a dark gradient over the symbol still separates modules from background', () => {
    const qr = encode('gradient binarization', { ecc: 'M' });
    const image = renderRgba(qr.matrix, { scale: 6, gradient: '#000000,#5050a0', gradientDir: 'diagonal' });
    const bitmap = binarize(image);
    // Every module centre must come out dark exactly where the matrix is dark.
    for (let r = 0; r < qr.size; r++) {
      for (let c = 0; c < qr.size; c++) {
        const x = (c + 4) * 6 + 3;
        const y = (r + 4) * 6 + 3;
        assert.equal(bitmap.bits[y * image.width + x], qr.matrix[r][c] ? 1 : 0, `module ${r},${c}`);
      }
    }
  });

  test('transparent pixels count as white (composited over a white background)', () => {
    const image = solidRgba(50, 50, [0, 0, 0, 0]);
    assert.equal(binarize(image).bits.some((b) => b === 1), false);
  });

  test('a small image (under 40 pixels) uses a global threshold', () => {
    const qr = encode('1', { ecc: 'L' }); // 21 modules
    const image = renderRgba(qr.matrix, { scale: 1, margin: 0 }); // 21 x 21 px
    const bitmap = binarize(image);
    for (let r = 0; r < 21; r++) for (let c = 0; c < 21; c++) assert.equal(bitmap.bits[r * 21 + c], qr.matrix[r][c] ? 1 : 0);
  });
});

describe('finder patterns', () => {
  test('the three finders of a plain symbol are found at their centres with the right module size', () => {
    for (const scale of [1, 2, 3, 5, 10]) {
      const qr = encode('finder test', { ecc: 'M' });
      const image = renderRgba(qr.matrix, { scale, margin: 4 });
      const candidates = findFinderPatterns(binarize(image));
      assert.ok(candidates.length >= 3, `scale ${scale}: found ${candidates.length}`);
      const expected = [
        [(4 + 3.5) * scale, (4 + 3.5) * scale],
        [(4 + qr.size - 3.5) * scale, (4 + 3.5) * scale],
        [(4 + 3.5) * scale, (4 + qr.size - 3.5) * scale],
      ];
      for (const [ex, ey] of expected) {
        const hit = candidates.find((c) => Math.abs(c.x - ex) <= Math.max(0.6, scale * 0.3) && Math.abs(c.y - ey) <= Math.max(0.6, scale * 0.3));
        assert.ok(hit, `scale ${scale}: no candidate near (${ex}, ${ey}); got ${JSON.stringify(candidates.slice(0, 5))}`);
        assert.ok(Math.abs(hit.moduleSize - scale) <= Math.max(0.5, scale * 0.15), `scale ${scale}: module size ${hit.moduleSize}`);
      }
      const [triple] = rankTriples(candidates);
      assert.ok(triple, `scale ${scale}: no triple`);
      assert.ok(Math.abs(triple.topLeft.x - expected[0][0]) < scale && Math.abs(triple.topRight.x - expected[1][0]) < scale && Math.abs(triple.bottomLeft.y - expected[2][1]) < scale);
      assert.equal(triple.confident, true);
    }
  });

  test('a blank image and pure noise give no usable triple', () => {
    assert.deepEqual(rankTriples(findFinderPatterns(binarize(solidRgba(200, 200, [255, 255, 255])))), []);
    const noise = findFinderPatterns(binarize(noiseRgba(300, 300, 7)));
    for (const triple of rankTriples(noise)) assert.equal(triple.confident, false);
  });

  test('the candidate list is capped', () => {
    // A field of finder-like squares: 7x7 modules at scale 3, tiled with a 3-module gap.
    const cell = 10 * 3;
    const cols = 40;
    const image = solidRgba(cols * cell, cols * cell, [255, 255, 255]);
    const finder = encode('x').matrix.slice(0, 7).map((row) => row.slice(0, 7));
    const tile = rasterize(finder, { scale: 3, margin: 0 });
    for (let ty = 0; ty < cols; ty++) for (let tx = 0; tx < cols; tx++) blitRgba(image, { width: 21, height: 21, data: tile.data }, tx * cell + 3, ty * cell + 3);
    const started = performance.now();
    const candidates = findFinderPatterns(binarize(image));
    assert.ok(candidates.length <= 64, `${candidates.length} candidates`);
    assert.ok(performance.now() - started < 2000);
  });
});

describe('decodeQr: round trips through renderPng and decodePng', () => {
  test('plain output at scales 1..10 and margins 0..4 (sampled), with jsQR agreeing where it can read them', () => {
    let jsqrAgreed = 0;
    for (const version of [1, 2, 4, 7, 11, 20, 33, 40]) {
      for (const [i, ecc] of LEVELS.entries()) {
        const text = '0123456789'.repeat(version); // fits every level from version 1 up
        const qr = encode(text, { version, ecc });
        const scale = 1 + ((version + i) % 10);
        const margin = (version + i) % 5;
        const image = renderRgba(qr.matrix, { scale, margin });
        const result = decodeQr(image);
        assert.equal(result.text, text, `v${version}-${ecc} scale ${scale} margin ${margin}`);
        assert.equal(result.version, version);
        assert.equal(result.ecc, ecc);
        assert.equal(result.mask, qr.mask);
        assert.equal(result.errorsCorrected, 0);
        assert.equal(result.inverted, false);
        assert.equal(result.location.dimension, qr.size);
        assert.ok(Math.abs(result.location.moduleSize - scale) < 0.5, `module size ${result.location.moduleSize} vs ${scale}`);
        const reference = decodeRgba(image.data, image.width, image.height);
        if (reference) {
          assert.equal(result.text, reference.data);
          jsqrAgreed++;
        }
      }
    }
    assert.ok(jsqrAgreed >= 24, `jsQR agreed on ${jsqrAgreed} of 32`);
  });

  test('every version 1..40 at scale 3 (all levels, auto mask)', () => {
    for (let version = 1; version <= 40; version++) {
      const ecc = LEVELS[version % 4];
      const text = `v${version} ${'abc'.repeat(version)}`;
      const qr = encode(text, { version, ecc });
      const result = decodeQr(renderRgba(qr.matrix, { scale: 3, margin: 2 }));
      assert.equal(result.text, text, `v${version}-${ecc}`);
      assert.equal(result.version, version);
    }
  });

  test('styles: rounded and dotted modules, rounded and circular finders, finder colour', () => {
    const text = 'https://example.com/styled?x=1&y=2';
    const cases = [
      { shape: 'rounded' },
      { shape: 'dots' },
      { shape: 'rounded', finder: 'rounded' },
      { shape: 'dots', finder: 'circle' },
      { shape: 'square', finder: 'circle', finderColor: '#1a237e' },
      { shape: 'dots', finder: 'rounded', finderColor: '#b71c1c', fg: '#004d40' },
    ];
    for (const ecc of ['L', 'H']) {
      for (const style of cases) {
        for (const scale of [4, 8]) {
          const qr = encode(text, { ecc });
          const image = renderRgba(qr.matrix, { scale, ...style });
          const result = decodeQr(image);
          const label = `${ecc} scale ${scale} ${JSON.stringify(style)}`;
          assert.equal(result.text, text, label);
          assert.equal(result.errorsCorrected, 0, label);
          assertAgreesWithJsqr(image, result, label);
        }
      }
    }
  });

  test('colours and gradients in every direction', () => {
    const text = 'colour and gradient round trip';
    const cases = [
      { fg: '#1a237e', bg: '#fffde7' },
      { fg: '#263238', bg: '#eceff1' },
      { gradient: '#000000,#3f51b5', gradientDir: 'horizontal' },
      { gradient: '#1b5e20,#000000', gradientDir: 'vertical' },
      { gradient: '#b71c1c,#1a237e', gradientDir: 'diagonal' },
      { gradient: '#000000,#4a148c', gradientDir: 'radial' },
      { gradient: '#880e4f,#311b92', gradientDir: 'diagonal', shape: 'rounded', finder: 'rounded' },
    ];
    for (const style of cases) {
      const qr = encode(text, { ecc: 'M' });
      const image = renderRgba(qr.matrix, { scale: 6, ...style });
      const result = decodeQr(image);
      assert.equal(result.text, text, JSON.stringify(style));
      assertAgreesWithJsqr(image, result, JSON.stringify(style));
    }
  });

  test('inverted colours (light modules on a dark background) are decoded and flagged', () => {
    const qr = encode('inverted', { ecc: 'Q' });
    for (const style of [{ fg: '#ffffff', bg: '#000000' }, { fg: '#fffde7', bg: '#1a237e' }]) {
      const result = decodeQr(renderRgba(qr.matrix, { scale: 5, ...style }));
      assert.equal(result.text, 'inverted', JSON.stringify(style));
      assert.equal(result.inverted, true);
    }
  });

  test('rotations by 90, 180 and 270 degrees decode; a mirrored image does not', () => {
    const text = 'rotation test 12345';
    const qr = encode(text, { ecc: 'M' });
    const image = renderRgba(qr.matrix, { scale: 4, margin: 3 });
    for (const turns of [1, 2, 3]) {
      const rotated = rotateRgba(image, turns);
      const result = decodeQr(rotated);
      assert.equal(result.text, text, `${turns * 90} degrees`);
      assertAgreesWithJsqr(rotated, result, `${turns * 90} degrees`);
    }
    assert.throws(() => decodeQr(mirrorRgba(image)), QrDecodeError);
  });

  test('a symbol pasted anywhere in a larger image, with a rotation, is found', () => {
    const text = 'somewhere in a bigger picture';
    const qr = encode(text, { ecc: 'M' });
    const small = renderRgba(qr.matrix, { scale: 3, margin: 2 });
    const canvas = solidRgba(400, 300, [240, 240, 240]);
    for (const [x, y, turns] of [[0, 0, 0], [250, 150, 1], [130, 60, 2], [300, 0, 3]]) {
      const image = pasteRgba(canvas, rotateRgba(small, turns), x, y);
      assert.equal(decodeQr(image).text, text, `at ${x},${y} turns ${turns}`);
    }
  });

  test('a logo covering the centre is corrected by the error correction and counted', () => {
    const logoImage = decodePng(encodeWithPngjs(makeLogoImage(64, 64), { colorType: 6 }));
    const text = 'https://example.com/with-logo';
    for (const sizePercent of [15, 25]) {
      const { plan } = encodeWithLogo(text, { sizePercent, aspect: 1 });
      const png = renderPng(plan.matrix, { scale: 5, logo: { image: logoImage, box: plan.box, area: plan.area } });
      const result = decodeQrPng(png);
      assert.equal(result.text, text, `${sizePercent}%`);
      assert.equal(result.ecc, 'H');
      assert.ok(result.errorsCorrected > 0, `${sizePercent}%: the logo should have damaged codewords`);
    }
  });

  test('the hand-made gallery PNGs decode to their known content', () => {
    const expected = {
      'plain.png': 'https://github.com/jmendoza167/Qr-Code-Generator',
      'rounded.png': 'https://github.com/jmendoza167/Qr-Code-Generator',
      'dots.png': 'https://github.com/jmendoza167/Qr-Code-Generator',
      'gradient.png': 'https://github.com/jmendoza167/Qr-Code-Generator',
      'logo-photo.png': 'https://github.com/jmendoza167',
      'logo-instagram.png': 'https://instagram.com/jmendoza.16',
      'logo-linkedin.png': 'https://www.linkedin.com',
    };
    for (const [file, text] of Object.entries(expected)) {
      const result = decodeQrPng(readFileSync(join(ROOT, 'docs', 'examples', file)));
      assert.equal(result.text, text, file);
    }
  });

  test('control characters and escape sequences survive the full image round trip', () => {
    const hostile = '\u001b[31m\u001b]8;;http://evil.example\u0007link\u001b]8;;\u0007\r\n‮oops‬\u0000';
    const result = decodeQr(renderRgba(encode(hostile).matrix, { scale: 4 }));
    assert.equal(result.text, hostile);
    assert.equal(result.encoding, 'utf-8');
  });

  test('the result carries the matrix-level fields plus geometry', () => {
    const qr = encode('12345678', { ecc: 'L' });
    const result = decodeQr(renderRgba(qr.matrix, { scale: 7, margin: 1 }));
    assert.deepEqual(Object.keys(result).sort(), [
      'ecc', 'eci', 'encoding', 'errorsCorrected', 'formatBitErrors', 'inverted', 'location', 'mask', 'segments', 'text', 'version', 'versionBitErrors',
    ]);
    assert.deepEqual(Object.keys(result.location).sort(), ['bottomLeft', 'dimension', 'moduleSize', 'topLeft', 'topRight']);
    assert.ok(Math.abs(result.location.topLeft.x - (1 + 3.5) * 7) < 1);
    assert.ok(Math.abs(result.location.topLeft.y - (1 + 3.5) * 7) < 1);
    assert.ok(Math.abs(result.location.topRight.x - (1 + 21 - 3.5) * 7) < 1);
    assert.ok(Math.abs(result.location.bottomLeft.y - (1 + 21 - 3.5) * 7) < 1);
  });
});

describe('decodeQr: errors and input checks', () => {
  test('no QR code: blank, noise and a photo-like gradient raise NoQrFoundError', () => {
    const gradient = solidRgba(120, 120, [0, 0, 0]);
    for (let i = 0; i < gradient.data.length; i += 4) gradient.data[i] = gradient.data[i + 1] = gradient.data[i + 2] = (i / 4) % 120 * 2;
    for (const image of [solidRgba(100, 100, [255, 255, 255]), solidRgba(100, 100, [0, 0, 0]), noiseRgba(200, 200, 3), gradient, solidRgba(1, 1, [0, 0, 0])]) {
      assert.throws(
        () => decodeQr(image),
        (err) => {
          assert.ok(err instanceof NoQrFoundError, `${err.name}: ${err.message}`);
          assert.ok(err instanceof QrDecodeError);
          return true;
        },
      );
    }
  });

  test('a symbol with both format copies destroyed raises FormatUnreadableError', () => {
    const qr = encode('format damage', { ecc: 'M' });
    const matrix = qr.matrix.map((row) => row.slice());
    // Flip every other format module in both copies (8 of 15 bits each).
    formatInfoPositions(qr.size).forEach(([a, b], i) => {
      if (i % 2 === 0) {
        matrix[a[0]][a[1]] = !matrix[a[0]][a[1]];
        matrix[b[0]][b[1]] = !matrix[b[0]][b[1]];
      }
    });
    assert.throws(() => decodeQr(renderRgba(matrix, { scale: 4 })), FormatUnreadableError);
    // One copy destroyed still decodes.
    const oneCopy = qr.matrix.map((row) => row.slice());
    formatInfoPositions(qr.size).forEach(([a], i) => {
      if (i % 2 === 0) oneCopy[a[0]][a[1]] = !oneCopy[a[0]][a[1]];
    });
    assert.equal(decodeQr(renderRgba(oneCopy, { scale: 4 })).text, 'format damage');
  });

  test('image objects are validated: shape, data length and the size caps', () => {
    assert.throws(() => decodeQr(null), TypeError);
    assert.throws(() => decodeQr({ width: 10, height: 10 }), TypeError);
    assert.throws(() => decodeQr({ width: 10, height: 10, data: new Uint8Array(10) }), RangeError);
    assert.throws(() => decodeQr({ width: 0, height: 10, data: new Uint8Array(0) }), RangeError);
    assert.throws(() => decodeQr({ width: 4097, height: 1, data: new Uint8Array(4097 * 4) }), /too large/);
    assert.throws(() => decodeQr({ width: 1.5, height: 10, data: new Uint8Array(60) }), RangeError);
  });

  test('decodeQrPng rejects non-PNG input with PngDecodeError and reads a PNG buffer', () => {
    assert.throws(() => decodeQrPng(Buffer.from('not a png')), (err) => err.name === 'PngDecodeError');
    const qr = encode('from png', { ecc: 'L' });
    assert.equal(decodeQrPng(renderPng(qr.matrix, { scale: 3 })).text, 'from png');
  });
});
