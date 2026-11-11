/**
 * Arithmetic in the Galois field GF(2^8) used by QR codes.
 *
 * Why a finite field?
 * -------------------
 * Reed-Solomon error correction treats a message as a polynomial and needs
 * to add, multiply and divide its coefficients. Ordinary bytes are not a
 * field (you cannot divide 5 by 2 and stay inside 0..255), so QR codes use
 * GF(256): the 256 polynomials of degree < 8 with coefficients in {0, 1},
 * taken modulo the *primitive polynomial*
 *
 *     x^8 + x^4 + x^3 + x^2 + 1   =  0b1_0001_1101  =  0x11D
 *
 * Each byte is such a polynomial (bit i = coefficient of x^i):
 *   - addition is XOR (adding coefficients mod 2, no carries),
 *   - multiplication is polynomial multiplication followed by reduction
 *     mod 0x11D so the result fits back in 8 bits.
 *
 * Because 0x11D is primitive, the element alpha = x = 2 generates every
 * non-zero element: alpha^0, alpha^1, ..., alpha^254 are all distinct and
 * alpha^255 = 1. That lets us turn multiplication into table lookups:
 *
 *     a * b = EXP[ LOG[a] + LOG[b] ]
 *
 * exactly like slide rules did with ordinary logarithms.
 */

/** EXP[i] = alpha^i. Doubled to 512 entries so LOG[a] + LOG[b] never needs a modulo. */
export const EXP = new Uint8Array(512);

/** LOG[v] = the exponent i such that alpha^i = v. LOG[0] is undefined (stays 0). */
export const LOG = new Uint8Array(256);

// Build the tables by repeatedly multiplying by alpha (= 2, i.e. a left shift).
// Whenever the shift overflows bit 8 we subtract (XOR) the primitive polynomial,
// which is what "reduce modulo 0x11D" means for these bit-polynomials.
{
  let value = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

/** alpha raised to the n-th power (n may exceed 255; it wraps every 255). */
export function exp(n) {
  return EXP[n % 255];
}

/** Discrete logarithm base alpha. Only defined for non-zero values. */
export function log(value) {
  if (value === 0) throw new RangeError('log(0) is undefined in GF(256)');
  return LOG[value];
}

/** Multiply two field elements. */
export function mul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

/**
 * Multiply two polynomials whose coefficients are field elements.
 * Coefficients are stored highest degree first, matching how the spec
 * writes them, e.g. [1, 6, 8] is x^2 + 6x + 8.
 */
export function polyMul(p, q) {
  const result = new Uint8Array(p.length + q.length - 1);
  for (let i = 0; i < p.length; i++) {
    for (let j = 0; j < q.length; j++) {
      // Addition in GF(256) is XOR, so coefficients accumulate with ^=.
      result[i + j] ^= mul(p[i], q[j]);
    }
  }
  return result;
}
