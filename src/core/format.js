/**
 * Format information and version information (ISO/IEC 18004 sections 7.9
 * and 7.10, Annexes C and D).
 *
 * Both are tiny messages protected by a BCH code, which is just like the
 * Reed-Solomon idea but over single bits (GF(2)) instead of bytes: append
 * the remainder of (data * x^degree) / generator so the whole thing is
 * divisible by the generator. A reader can then correct a few flipped bits
 * in the most important 15 (or 18) bits of the symbol.
 */
import { getEccLevel, assertVersion } from './version.js';

/** x^10 + x^8 + x^5 + x^4 + x^2 + x + 1 */
const FORMAT_GENERATOR = 0b10100110111; // 0x537
/** XORed onto the format bits so that no level/mask combination is all zeros. */
const FORMAT_XOR_MASK = 0b101010000010010; // 0x5412
/** x^12 + x^11 + x^10 + x^9 + x^8 + x^5 + x^2 + 1 */
const VERSION_GENERATOR = 0b1111100100101; // 0x1F25

/**
 * Remainder of (data << degree) divided by `generator` over GF(2).
 * Plain long division: scan from the top bit down and, wherever a 1 is
 * found, XOR in the generator aligned to that bit.
 */
function bchRemainder(data, dataBits, generator, degree) {
  let remainder = data << degree;
  for (let i = dataBits + degree - 1; i >= degree; i--) {
    if ((remainder >>> i) & 1) remainder ^= generator << (i - degree);
  }
  return remainder;
}

/**
 * The 15-bit format information: 2 bits of ECC level, 3 bits of mask
 * pattern, 10 BCH bits, all XORed with 0x5412.
 */
export function formatBits(ecc, mask) {
  const level = getEccLevel(ecc);
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new RangeError(`mask pattern must be 0..7, got ${mask}`);
  }
  const data = (level.formatBits << 3) | mask; // 5 bits
  const remainder = bchRemainder(data, 5, FORMAT_GENERATOR, 10);
  return ((data << 10) | remainder) ^ FORMAT_XOR_MASK;
}

/**
 * The 18-bit version information for versions 7..40: 6 bits of version
 * number followed by 12 BCH bits. Small symbols do not carry it, a reader
 * infers their version from the size.
 */
export function versionBits(version) {
  assertVersion(version);
  if (version < 7) throw new RangeError('version information only exists for versions 7 to 40');
  const remainder = bchRemainder(version, 6, VERSION_GENERATOR, 12);
  return (version << 12) | remainder;
}
