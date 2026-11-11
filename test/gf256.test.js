import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EXP, LOG, mul, exp, log, polyMul } from '../src/core/gf256.js';

describe('GF(256) with primitive polynomial 0x11D', () => {
  test('alpha^8 reduces to 0x1D (the low bits of 0x11D)', () => {
    assert.equal(exp(8), 0x1d);
    assert.equal(mul(2, 128), 0x1d);
  });

  test('alpha^255 wraps around to 1 (alpha has multiplicative order 255)', () => {
    assert.equal(exp(255), 1);
    assert.equal(exp(0), 1);
    assert.equal(exp(1), 2);
  });

  test('the generator alpha=2 is primitive: alpha^0..alpha^254 are all distinct', () => {
    const seen = new Set();
    for (let i = 0; i < 255; i++) seen.add(EXP[i]);
    assert.equal(seen.size, 255);
    assert.equal(seen.has(0), false);
  });

  test('LOG is the inverse of EXP', () => {
    for (let i = 0; i < 255; i++) assert.equal(LOG[EXP[i]], i);
    assert.equal(log(1), 0);
    assert.equal(log(2), 1);
    assert.equal(log(0x1d), 8);
  });

  test('multiplication of known values', () => {
    // (x + 1)(x^2 + x + 1) = x^3 + 1 in characteristic 2
    assert.equal(mul(3, 7), 9);
    // 2 * 142 = 1, so 142 is the inverse of 2
    assert.equal(mul(2, 142), 1);
    assert.equal(mul(0x53, 0xca), mul(0xca, 0x53));
  });

  test('anything times zero is zero', () => {
    assert.equal(mul(0, 77), 0);
    assert.equal(mul(77, 0), 0);
    assert.equal(mul(0, 0), 0);
  });

  test('mul agrees with adding exponents', () => {
    for (let a = 0; a < 255; a += 7) {
      for (let b = 0; b < 255; b += 11) {
        assert.equal(mul(exp(a), exp(b)), exp((a + b) % 255));
      }
    }
  });

  test('polyMul: (x + 1)^2 = x^2 + 1 and (x + a)(x + b) expands correctly', () => {
    assert.deepEqual([...polyMul([1, 1], [1, 1])], [1, 0, 1]);
    // (x + 2)(x + 4) = x^2 + (2 ^ 4) x + 2*4 = x^2 + 6x + 8
    assert.deepEqual([...polyMul([1, 2], [1, 4])], [1, 6, 8]);
  });
});
