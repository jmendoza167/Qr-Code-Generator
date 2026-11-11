import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatBits, versionBits } from '../src/core/format.js';

describe('format information (BCH(15,5) + mask 0x5412, Annex C)', () => {
  test('known values from Table C.1', () => {
    assert.equal(formatBits('M', 0), 0x5412); // data 00000 -> remainder 0 -> just the XOR mask
    assert.equal(formatBits('L', 0), 0x77c4);
    assert.equal(formatBits('L', 7), 0x6976);
    assert.equal(formatBits('M', 3), 0x5b4b);
    assert.equal(formatBits('Q', 3), 0x3a06);
    assert.equal(formatBits('Q', 7), 0x2bed);
    assert.equal(formatBits('H', 0), 0x1689);
    assert.equal(formatBits('H', 7), 0x083b);
  });

  test('all 32 format codes are distinct 15-bit values', () => {
    const seen = new Set();
    for (const ecc of ['L', 'M', 'Q', 'H']) {
      for (let mask = 0; mask < 8; mask++) {
        const bits = formatBits(ecc, mask);
        assert.ok(bits >= 0 && bits < 1 << 15);
        seen.add(bits);
      }
    }
    assert.equal(seen.size, 32);
  });

  test('rejects an invalid mask', () => {
    assert.throws(() => formatBits('M', 8), RangeError);
    assert.throws(() => formatBits('M', -1), RangeError);
  });
});

describe('version information (BCH(18,6), Annex D)', () => {
  test('known values from Table D.1', () => {
    assert.equal(versionBits(7), 0x07c94);
    assert.equal(versionBits(8), 0x085bc);
    assert.equal(versionBits(21), 0x15683);
    assert.equal(versionBits(40), 0x28c69);
  });

  test('the top 6 bits are the version number itself', () => {
    for (let v = 7; v <= 40; v++) assert.equal(versionBits(v) >>> 12, v);
  });

  test('only versions 7 and up carry version information', () => {
    assert.throws(() => versionBits(6), RangeError);
  });
});
