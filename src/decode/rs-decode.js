/**
 * Reed-Solomon error correction for one block (the decoding half of
 * src/core/reed-solomon.js, same field, same generator roots alpha^0..).
 *
 * How it works, in four steps
 * ---------------------------
 * 1. Syndromes. The received block r(x) is evaluated at every root of the
 *    generator. A clean block gives all zeros. Otherwise the n syndromes
 *    S_j = r(alpha^j) depend only on the error polynomial, not on the data.
 * 2. Berlekamp-Massey finds the shortest "error locator" polynomial sigma(x)
 *    consistent with the syndromes. Its degree L is the number of errors,
 *    and its roots are the inverses of the error positions.
 * 3. Chien search tries every position to find those roots.
 * 4. Forney's formula gives the error value at each position, which is then
 *    XORed out.
 *
 * With n EC codewords a block can correct t = floor(n / 2) errors. Beyond
 * that the maths still produces *something*, so the result is checked on
 * every exit: the locator degree must match the number of roots found, the
 * corrected block must have all-zero syndromes, and L must not exceed t.
 * Any mismatch is reported as TooManyErrorsError rather than returned.
 */
import { EXP, LOG, mul } from '../core/gf256.js';
import { TooManyErrorsError } from './errors.js';

/** a / b in GF(256); b must be non-zero. */
function div(a, b) {
  if (a === 0) return 0;
  return EXP[LOG[a] + 255 - LOG[b]];
}

/** p(x) for a polynomial stored lowest degree first. */
function evalLow(poly, x) {
  let y = 0;
  for (let i = poly.length - 1; i >= 0; i--) y = mul(y, x) ^ poly[i];
  return y;
}

/** r(alpha^j) for j = 0 .. count-1; codewords are highest degree first. */
function syndromes(codewords, count) {
  const out = new Uint8Array(count);
  for (let j = 0; j < count; j++) {
    const x = EXP[j];
    let y = 0;
    for (let i = 0; i < codewords.length; i++) y = mul(y, x) ^ codewords[i];
    out[j] = y;
  }
  return out;
}

/** Berlekamp-Massey: the error locator sigma(x), lowest degree first, sigma[0] = 1. */
function errorLocator(S) {
  let sigma = [1];
  let prev = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let i = 0; i < S.length; i++) {
    let d = S[i];
    for (let j = 1; j <= L; j++) d ^= mul(sigma[j] ?? 0, S[i - j]);
    if (d === 0) {
      m++;
      continue;
    }
    const scale = div(d, b);
    const next = sigma.slice();
    for (let j = 0; j < prev.length; j++) {
      const k = j + m;
      next[k] = (next[k] ?? 0) ^ mul(scale, prev[j]);
    }
    if (2 * L <= i) {
      L = i + 1 - L;
      prev = sigma;
      b = d;
      m = 1;
    } else {
      m++;
    }
    sigma = next;
  }
  while (sigma.length > 1 && sigma[sigma.length - 1] === 0) sigma.pop();
  return { sigma, L };
}

/**
 * Correct one block of codewords (data followed by its EC codewords).
 *
 * @param {ArrayLike<number>} received  the block as read from the symbol
 * @param {number} ecCount              number of EC codewords at the end of the block
 * @returns {{ codewords: Uint8Array, corrected: number, positions: number[] }}
 *   a corrected copy, how many codewords were changed, and their indexes
 * @throws {TooManyErrorsError} when the block cannot be corrected with certainty
 */
export function correctBlock(received, ecCount) {
  if (!Number.isInteger(ecCount) || ecCount < 1) {
    throw new RangeError(`ecCount must be a positive integer, got ${ecCount}`);
  }
  if (received.length <= ecCount) {
    throw new RangeError(`a block of ${received.length} codewords cannot hold ${ecCount} EC codewords plus data`);
  }
  const n = received.length;
  const codewords = Uint8Array.from(received);
  const t = Math.floor(ecCount / 2);
  const fail = (why) => new TooManyErrorsError(`Too many errors to correct: ${why}`, { capacity: t });

  const S = syndromes(codewords, ecCount);
  if (S.every((s) => s === 0)) return { codewords, corrected: 0, positions: [] };

  const { sigma, L } = errorLocator(S);
  if (L > t) throw fail(`the block has more than ${t} errors`);
  if (sigma.length - 1 !== L) throw fail('inconsistent error locator');

  // Chien search: codeword index i has degree p = n-1-i; it is an error
  // position when sigma(alpha^-p) = 0. n <= 255 so alpha^-p = EXP[255 - p].
  const positions = [];
  for (let i = 0; i < n; i++) {
    const p = n - 1 - i;
    if (evalLow(sigma, EXP[255 - p]) === 0) positions.push(i);
  }
  if (positions.length !== L) throw fail('error positions could not be located');

  // Forney: Omega(x) = S(x) sigma(x) mod x^ecCount, sigma'(x) the formal
  // derivative (only odd-degree terms survive in characteristic 2).
  const omega = new Uint8Array(ecCount);
  for (let k = 0; k < ecCount; k++) {
    let v = 0;
    for (let j = 0; j <= k && j < sigma.length; j++) v ^= mul(sigma[j], S[k - j]);
    omega[k] = v;
  }
  const sigmaPrime = [];
  for (let k = 1; k < sigma.length; k += 2) {
    sigmaPrime[k - 1] = sigma[k];
    if (k < sigma.length - 1) sigmaPrime[k] = 0;
  }
  for (const i of positions) {
    const p = n - 1 - i;
    const x = EXP[p];
    const xInv = EXP[255 - p];
    const denominator = evalLow(sigmaPrime, xInv);
    if (denominator === 0) throw fail('error values could not be computed');
    codewords[i] ^= div(mul(x, evalLow(omega, xInv)), denominator);
  }

  if (!syndromes(codewords, ecCount).every((s) => s === 0)) throw fail('the correction did not produce a valid block');
  return { codewords, corrected: L, positions };
}
