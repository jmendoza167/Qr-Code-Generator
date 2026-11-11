/**
 * Reed-Solomon error correction codewords, as used by QR codes
 * (ISO/IEC 18004 section 7.5.2 and Annex A).
 *
 * The idea
 * --------
 * Treat the data codewords d0, d1, ... d(k-1) as the coefficients of a
 * polynomial D(x) = d0 x^(k-1) + d1 x^(k-2) + ... + d(k-1), with arithmetic
 * in GF(256). Pick a "generator" polynomial g(x) of degree n whose roots are
 * alpha^0, alpha^1, ..., alpha^(n-1). The n error-correction codewords are
 * the coefficients of the remainder of
 *
 *     D(x) * x^n  divided by  g(x).
 *
 * Appending that remainder to the data gives a codeword polynomial that is
 * exactly divisible by g(x), so it evaluates to zero at every root. A decoder
 * evaluates the received polynomial at those roots; any non-zero results
 * ("syndromes") pinpoint which bytes were damaged and by how much. We only
 * need the encoding half here, which is just long division.
 */
import { exp, mul, polyMul } from './gf256.js';

const generatorCache = new Map();

/**
 * g(x) = (x - alpha^0)(x - alpha^1)...(x - alpha^(degree-1)).
 * In characteristic 2, minus is the same as plus, so each factor is
 * [1, alpha^i] (highest degree first). Result has `degree + 1` coefficients
 * with a leading 1.
 */
export function generatorPolynomial(degree) {
  if (!Number.isInteger(degree) || degree < 1) {
    throw new RangeError(`generator degree must be a positive integer, got ${degree}`);
  }
  let g = generatorCache.get(degree);
  if (g) return g;
  g = Uint8Array.of(1);
  for (let i = 0; i < degree; i++) g = polyMul(g, [1, exp(i)]);
  generatorCache.set(degree, g);
  return g;
}

/**
 * Compute `degree` error-correction codewords for one block of data codewords.
 *
 * This is polynomial long division where we only care about the remainder.
 * We "shift" the data left by `degree` positions (multiply by x^degree) by
 * walking the data through a `degree`-byte register: each step takes the
 * byte falling off the top, scales the generator by it, and subtracts (XOR)
 * the result from the register. Because the generator is monic (leading
 * coefficient 1) the subtraction always clears that top byte, which is why
 * the loop skips g[0].
 *
 * @param {ArrayLike<number>} data   data codewords of ONE block
 * @param {number} degree            number of EC codewords for that block
 * @returns {Uint8Array}             the EC codewords, in transmission order
 */
export function computeEcc(data, degree) {
  const g = generatorPolynomial(degree);
  const remainder = new Uint8Array(degree);
  for (let i = 0; i < data.length; i++) {
    // Bring in the next data byte; `factor` is what is being divided out.
    const factor = data[i] ^ remainder[0];
    // Shift the register left by one byte (the top byte is now consumed).
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    // Subtract factor * g(x) from the register (skipping g[0], see above).
    if (factor !== 0) {
      for (let j = 1; j <= degree; j++) {
        remainder[j - 1] ^= mul(g[j], factor);
      }
    }
  }
  return remainder;
}
