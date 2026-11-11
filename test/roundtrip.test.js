// End-to-end: encode with our engine, decode with jsQR (an independent
// implementation). Anything wrong in tables, encoding, placement, masking or
// format/version information shows up here as a null or a wrong string.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encode } from '../src/core/qr.js';
import { DataTooLongError } from '../src/core/errors.js';
import { decodeMatrix } from './helpers/decode.js';

function assertRoundTrip(text, options = {}, expect = {}) {
  const qr = encode(text, options);
  assert.equal(qr.matrix.length, qr.size);
  assert.equal(qr.size, 17 + 4 * qr.version);
  if (expect.version !== undefined) assert.equal(qr.version, expect.version, 'version');
  if (expect.mode !== undefined) assert.equal(qr.mode, expect.mode, 'mode');

  const decoded = decodeMatrix(qr.matrix);
  assert.ok(decoded, `jsQR could not decode ${JSON.stringify(text.slice(0, 40))} (${qr.version}-${qr.ecc} mask ${qr.mask})`);
  assert.equal(decoded.data, text, 'decoded text');
  assert.equal(decoded.version, qr.version, 'decoded version');
  assert.equal(decoded.chunks.length, 1, 'one segment');
  assert.equal(decoded.chunks[0].type, qr.mode, 'decoded mode');
  return qr;
}

describe('encode(): result shape and validation', () => {
  test('returns matrix + metadata', () => {
    const qr = encode('hello world');
    assert.deepEqual(Object.keys(qr).sort(), ['ecc', 'mask', 'matrix', 'mode', 'size', 'version']);
    assert.equal(qr.version, 1);
    assert.equal(qr.size, 21);
    assert.equal(qr.ecc, 'M');
    assert.equal(qr.mode, 'byte');
    assert.ok(qr.mask >= 0 && qr.mask <= 7);
    assert.ok(qr.matrix.every((row) => row.length === 21 && row.every((v) => typeof v === 'boolean')));
  });

  test('defaults to ECC level M; accepts lowercase', () => {
    assert.equal(encode('x').ecc, 'M');
    assert.equal(encode('x', { ecc: 'q' }).ecc, 'Q');
  });

  test('rejects empty input, bad ECC levels, bad versions and bad masks', () => {
    assert.throws(() => encode(''), /empty/i);
    assert.throws(() => encode(42), TypeError);
    assert.throws(() => encode('x', { ecc: 'Z' }), RangeError);
    assert.throws(() => encode('x', { version: 41 }), RangeError);
    assert.throws(() => encode('x', { mask: 8 }), RangeError);
  });

  test('throws DataTooLongError when the text cannot fit', () => {
    assert.throws(() => encode('x'.repeat(3000)), DataTooLongError);
    assert.throws(() => encode('x'.repeat(20), { version: 1 }), DataTooLongError);
  });
});

describe('round trip through jsQR: modes', () => {
  test('numeric', () => {
    assertRoundTrip('01234567', {}, { version: 1, mode: 'numeric' });
    assertRoundTrip('1', {}, { mode: 'numeric' });
    assertRoundTrip('98765432109876543210987654321', {}, { mode: 'numeric' });
  });

  test('alphanumeric', () => {
    assertRoundTrip('HELLO WORLD', {}, { version: 1, mode: 'alphanumeric' });
    assertRoundTrip('A', {}, { mode: 'alphanumeric' });
    assertRoundTrip('ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789 $%*+-./:', {}, { mode: 'alphanumeric' });
  });

  test('byte, plain ASCII', () => {
    assertRoundTrip('hello world', {}, { version: 1, mode: 'byte' });
    assertRoundTrip('https://github.com/jmendoza167/Qr-Code-Generator', {}, { mode: 'byte' });
  });

  test('byte, UTF-8 with accents', () => {
    assertRoundTrip('Olá, mundo! ¿Qué tal? Ñandú – «niño»', {}, { mode: 'byte' });
  });

  test('byte, emoji and CJK', () => {
    assertRoundTrip('emoji 😀🎉 日本語 çğış', {}, { mode: 'byte' });
  });
});

describe('round trip through jsQR: ECC levels', () => {
  const text = 'The quick brown fox jumps over the lazy dog';
  for (const ecc of ['L', 'M', 'Q', 'H']) {
    test(`level ${ecc}`, () => {
      const qr = assertRoundTrip(text, { ecc });
      assert.equal(qr.ecc, ecc);
    });
  }
});

describe('round trip through jsQR: versions', () => {
  test('small versions 1-6 (no version information)', () => {
    for (let v = 1; v <= 6; v++) assertRoundTrip(`version ${v}`, { version: v }, { version: v });
  });

  test('versions with version information (7+), across the count-indicator boundaries', () => {
    for (const v of [7, 9, 10, 14, 21, 26, 27, 33]) {
      assertRoundTrip(`version ${v} payload`, { version: v, ecc: 'H' }, { version: v });
    }
  });

  test('auto-selected mid-size versions from real content', () => {
    const lorem =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
    const qr1 = assertRoundTrip(lorem, { ecc: 'L' });
    assert.ok(qr1.version >= 5);
    const qr2 = assertRoundTrip(lorem.repeat(4), { ecc: 'M' });
    assert.ok(qr2.version >= 15);
  });

  test('version 40 at maximum capacity for each mode', () => {
    assertRoundTrip('7'.repeat(7089), { ecc: 'L' }, { version: 40, mode: 'numeric' });
    const alnum = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 $%*+-./:';
    assertRoundTrip(alnum.repeat(96).slice(0, 4296), { ecc: 'L' }, { version: 40, mode: 'alphanumeric' });
    assertRoundTrip('byte mode '.repeat(300).slice(0, 2953), { ecc: 'L' }, { version: 40, mode: 'byte' });
    assertRoundTrip('x'.repeat(1273), { ecc: 'H' }, { version: 40, mode: 'byte' });
  });
});

describe('round trip through jsQR: masks', () => {
  for (let mask = 0; mask < 8; mask++) {
    test(`forced mask ${mask}`, () => {
      const qr = assertRoundTrip('masking test 123', { mask });
      assert.equal(qr.mask, mask);
    });
  }
});
