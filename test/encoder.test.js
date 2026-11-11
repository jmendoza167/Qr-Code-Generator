import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BitBuffer } from '../src/core/bits.js';
import { encodeData, chooseVersion, buildDataCodewords } from '../src/core/encoder.js';
import { DataTooLongError } from '../src/core/errors.js';

describe('BitBuffer', () => {
  test('appends values MSB first and packs into bytes', () => {
    const b = new BitBuffer();
    b.append(0b101, 3);
    b.append(0b1, 1);
    b.append(0xff, 8);
    assert.equal(b.length, 12);
    assert.equal(b.toString(), '101111111111');
    // Trailing bits of the last byte are zero-padded.
    assert.deepEqual([...b.toBytes()], [0b10111111, 0b11110000]);
  });
});

describe('encodeData: mode indicator + character count + data', () => {
  test('spec example: numeric "01234567" (ISO/IEC 18004 Annex I)', () => {
    const bits = encodeData('01234567', 'numeric', 1);
    assert.equal(bits.toString(), '0001' + '0000001000' + '0000001100' + '0101011001' + '1000011');
  });

  test('numeric: trailing 2 digits use 7 bits, trailing 1 digit uses 4 bits', () => {
    assert.equal(encodeData('12', 'numeric', 1).toString(), '0001' + '0000000010' + '0001100');
    assert.equal(encodeData('7', 'numeric', 1).toString(), '0001' + '0000000001' + '0111');
  });

  test('alphanumeric: pairs use 11 bits (45 * first + second), a final single char uses 6', () => {
    // H=17, E=14 -> 17*45+14 = 779
    assert.equal(encodeData('HE', 'alphanumeric', 1).toString(), '0010' + '000000010' + '01100001011');
    assert.equal(encodeData('D', 'alphanumeric', 1).toString(), '0010' + '000000001' + '001101');
  });

  test('byte: UTF-8 bytes, count is the number of BYTES not characters', () => {
    // "é" is C3 A9 in UTF-8
    assert.equal(encodeData('é', 'byte', 1).toString(), '0100' + '00000010' + '11000011' + '10101001');
    // Emoji is 4 bytes; version 10 uses a 16-bit count
    const bits = encodeData('😀', 'byte', 10);
    assert.equal(bits.toString().slice(0, 20), '0100' + '0000000000000100');
    assert.equal(bits.length, 4 + 16 + 32);
  });

  test('character count indicator width follows the version', () => {
    assert.equal(encodeData('1', 'numeric', 27).length, 4 + 14 + 4);
    assert.equal(encodeData('A', 'alphanumeric', 10).length, 4 + 11 + 6);
  });
});

describe('chooseVersion: smallest version whose capacity fits', () => {
  test('"hello world" fits in version 1 at every level except H', () => {
    assert.equal(chooseVersion('hello world', 'byte', 'L'), 1);
    assert.equal(chooseVersion('hello world', 'byte', 'M'), 1);
    assert.equal(chooseVersion('hello world', 'byte', 'Q'), 1);
    assert.equal(chooseVersion('hello world', 'byte', 'H'), 2);
  });

  test('exact capacity boundaries for 1-L byte mode (17 bytes)', () => {
    assert.equal(chooseVersion('x'.repeat(17), 'byte', 'L'), 1);
    assert.equal(chooseVersion('x'.repeat(18), 'byte', 'L'), 2);
  });

  test('multi-byte characters count as bytes', () => {
    // 17 accented chars = 34 bytes -> too big for version 1 (17) and 2 (32)
    assert.equal(chooseVersion('é'.repeat(17), 'byte', 'L'), 3);
  });

  test('version 40 limits and DataTooLongError beyond them', () => {
    assert.equal(chooseVersion('9'.repeat(7089), 'numeric', 'L'), 40);
    assert.throws(() => chooseVersion('9'.repeat(7090), 'numeric', 'L'), DataTooLongError);
    assert.equal(chooseVersion('x'.repeat(2953), 'byte', 'L'), 40);
    assert.throws(() => chooseVersion('x'.repeat(2954), 'byte', 'L'), DataTooLongError);
    assert.equal(chooseVersion('x'.repeat(1273), 'byte', 'H'), 40);
    assert.throws(() => chooseVersion('x'.repeat(1274), 'byte', 'H'), DataTooLongError);
  });

  test('the error message says what was too long for what', () => {
    assert.throws(() => chooseVersion('x'.repeat(3000), 'byte', 'L'), /3000 bytes.*2953/);
  });

  test('respects a forced minimum version', () => {
    assert.equal(chooseVersion('hi', 'byte', 'M', { minVersion: 5 }), 5);
    assert.throws(() => chooseVersion('x'.repeat(100), 'byte', 'H', { maxVersion: 3 }), DataTooLongError);
  });
});

describe('buildDataCodewords: terminator, bit padding, pad bytes', () => {
  test('spec example 1-M "01234567" gives the published 16 data codewords', () => {
    const cw = buildDataCodewords('01234567', 'numeric', 1, 'M');
    assert.deepEqual(
      [...cw],
      [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11],
    );
  });

  test('thonky.com example 1-M "HELLO WORLD"', () => {
    const cw = buildDataCodewords('HELLO WORLD', 'alphanumeric', 1, 'M');
    assert.deepEqual([...cw], [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]);
  });

  test('terminator is shortened when fewer than 4 bits remain', () => {
    // 41 digits in 1-L: 4 + 10 + 13*10 + 7 = 151 bits of 152 -> 1 terminator bit, no pad bytes.
    const cw = buildDataCodewords('1'.repeat(41), 'numeric', 1, 'L');
    assert.equal(cw.length, 19);
    assert.equal(cw[18] & 1, 0);
  });

  test('always returns exactly the number of data codewords for the version/level', () => {
    assert.equal(buildDataCodewords('a', 'byte', 7, 'H').length, 66);
    assert.equal(buildDataCodewords('a', 'byte', 40, 'L').length, 2956);
  });

  test('refuses data that does not fit the given version', () => {
    assert.throws(() => buildDataCodewords('x'.repeat(18), 'byte', 1, 'L'), DataTooLongError);
  });
});
