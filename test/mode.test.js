import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectMode, getCharCountBits, getCapacity } from '../src/core/mode.js';

describe('mode selection', () => {
  test('digits only -> numeric', () => {
    assert.equal(detectMode('0123456789'), 'numeric');
    assert.equal(detectMode('7'), 'numeric');
  });

  test('uppercase letters, digits and the 9 symbols -> alphanumeric', () => {
    assert.equal(detectMode('HELLO WORLD'), 'alphanumeric');
    assert.equal(detectMode('12A'), 'alphanumeric');
    assert.equal(detectMode('$%*+-./: '), 'alphanumeric');
    assert.equal(detectMode('HTTP://EXAMPLE.COM/A-B'), 'alphanumeric');
  });

  test('anything else -> byte (lowercase, punctuation, accents, emoji)', () => {
    assert.equal(detectMode('hello'), 'byte');
    assert.equal(detectMode('A,B'), 'byte');
    assert.equal(detectMode('ÁÉÍ'), 'byte');
    assert.equal(detectMode('123😀'), 'byte');
    assert.equal(detectMode('a_b'), 'byte');
  });
});

describe('character count indicator length', () => {
  test('numeric: 10 / 12 / 14 bits for versions 1-9 / 10-26 / 27-40', () => {
    assert.equal(getCharCountBits('numeric', 1), 10);
    assert.equal(getCharCountBits('numeric', 9), 10);
    assert.equal(getCharCountBits('numeric', 10), 12);
    assert.equal(getCharCountBits('numeric', 26), 12);
    assert.equal(getCharCountBits('numeric', 27), 14);
    assert.equal(getCharCountBits('numeric', 40), 14);
  });

  test('alphanumeric: 9 / 11 / 13 bits', () => {
    assert.equal(getCharCountBits('alphanumeric', 1), 9);
    assert.equal(getCharCountBits('alphanumeric', 10), 11);
    assert.equal(getCharCountBits('alphanumeric', 27), 13);
  });

  test('byte: 8 / 16 / 16 bits', () => {
    assert.equal(getCharCountBits('byte', 9), 8);
    assert.equal(getCharCountBits('byte', 10), 16);
    assert.equal(getCharCountBits('byte', 40), 16);
  });
});

describe('capacity (ISO/IEC 18004 Table 7)', () => {
  // [version, ecc, numeric, alphanumeric, byte]
  const rows = [
    [1, 'L', 41, 25, 17],
    [1, 'M', 34, 20, 14],
    [1, 'Q', 27, 16, 11],
    [1, 'H', 17, 10, 7],
    [2, 'M', 63, 38, 26],
    [10, 'L', 652, 395, 271],
    [10, 'H', 288, 174, 119],
    [40, 'L', 7089, 4296, 2953],
    [40, 'M', 5596, 3391, 2331],
    [40, 'Q', 3993, 2420, 1663],
    [40, 'H', 3057, 1852, 1273],
  ];
  for (const [version, ecc, numeric, alphanumeric, byte] of rows) {
    test(`version ${version}-${ecc}: ${numeric} / ${alphanumeric} / ${byte}`, () => {
      assert.equal(getCapacity(version, ecc, 'numeric'), numeric);
      assert.equal(getCapacity(version, ecc, 'alphanumeric'), alphanumeric);
      assert.equal(getCapacity(version, ecc, 'byte'), byte);
    });
  }
});
