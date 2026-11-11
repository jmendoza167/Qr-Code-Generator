import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generatorPolynomial, computeEcc } from '../src/core/reed-solomon.js';
import { mul, exp, log } from '../src/core/gf256.js';

// Evaluates a polynomial (coefficients highest degree first) at x using
// Horner's rule, in GF(256).
function polyEval(coefficients, x) {
  let y = 0;
  for (const c of coefficients) y = mul(y, x) ^ c;
  return y;
}

describe('Reed-Solomon generator polynomials', () => {
  test('degree 7 matches ISO/IEC 18004 Annex A (coefficients as alpha exponents)', () => {
    const g = generatorPolynomial(7);
    assert.equal(g.length, 8);
    assert.deepEqual([...g].map(log), [0, 87, 229, 146, 149, 238, 102, 21]);
  });

  test('degree 10 matches ISO/IEC 18004 Annex A', () => {
    const g = generatorPolynomial(10);
    assert.deepEqual([...g].map(log), [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
  });

  test('generator of degree n has roots alpha^0 .. alpha^(n-1)', () => {
    for (const n of [7, 10, 13, 17, 22, 30]) {
      const g = generatorPolynomial(n);
      for (let i = 0; i < n; i++) assert.equal(polyEval(g, exp(i)), 0, `root alpha^${i} of g${n}`);
      // ...and alpha^n is NOT a root
      assert.notEqual(polyEval(g, exp(n)), 0);
    }
  });
});

describe('Reed-Solomon error correction codewords', () => {
  // ISO/IEC 18004 Annex I: version 1-M, numeric "01234567".
  const specData = [
    0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
  ];
  const specEcc = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55];

  test('spec example: version 1-M "01234567" produces the published EC codewords', () => {
    assert.deepEqual([...computeEcc(specData, 10)], specEcc);
  });

  test('thonky.com example: version 1-M "HELLO WORLD"', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    assert.deepEqual([...computeEcc(data, 10)], [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });

  test('data followed by its ECC is divisible by the generator (zero at every root)', () => {
    const data = Array.from({ length: 50 }, (_, i) => (i * 37 + 11) & 0xff);
    for (const n of [7, 15, 28]) {
      const codeword = [...data, ...computeEcc(data, n)];
      for (let i = 0; i < n; i++) assert.equal(polyEval(codeword, exp(i)), 0);
    }
  });

  test('returns exactly `degree` codewords even for all-zero data', () => {
    const ecc = computeEcc(new Array(19).fill(0), 7);
    assert.equal(ecc.length, 7);
    assert.deepEqual([...ecc], [0, 0, 0, 0, 0, 0, 0]);
  });
});
