/**
 * Encoding modes: which one to use for a given string, how wide the
 * character count indicator is, and how many characters a symbol can hold.
 * (ISO/IEC 18004 sections 7.3, 7.4 and Table 7.)
 */
import { ALPHANUMERIC_CHARSET, MODES } from './tables.js';
import { getDataCodewords, assertVersion } from './version.js';

const NUMERIC_RE = /^[0-9]+$/;
const ALPHANUMERIC_RE = /^[0-9A-Z $%*+\-./:]+$/;

/** UTF-8 encode (TextEncoder is a web standard, available in Node and browsers). */
export function utf8Encode(text) {
  return new TextEncoder().encode(text);
}

/**
 * Pick the most compact mode that can represent the whole string.
 *   numeric       3 digits in 10 bits  (3.33 bits/char)
 *   alphanumeric  2 chars in 11 bits   (5.5 bits/char)
 *   byte          1 byte in 8 bits     (8+ bits/char, UTF-8)
 */
export function detectMode(text) {
  if (NUMERIC_RE.test(text)) return 'numeric';
  if (ALPHANUMERIC_RE.test(text)) return 'alphanumeric';
  return 'byte';
}

export function getMode(mode) {
  const m = MODES[mode];
  if (!m) throw new RangeError(`unknown mode ${JSON.stringify(mode)}`);
  return m;
}

/** Width in bits of the character count indicator (Table 3). */
export function getCharCountBits(mode, version) {
  assertVersion(version);
  const m = getMode(mode);
  if (version <= 9) return m.charCountBits[0];
  if (version <= 26) return m.charCountBits[1];
  return m.charCountBits[2];
}

/**
 * The "units" the character count indicator counts: characters for numeric
 * and alphanumeric, UTF-8 BYTES for byte mode.
 */
export function getUnitCount(text, mode) {
  return mode === 'byte' ? utf8Encode(text).length : text.length;
}

/** Name of the unit, for messages ("17 bytes", "41 digits"). */
export function getUnitName(mode) {
  return { numeric: 'digits', alphanumeric: 'characters', byte: 'bytes' }[mode];
}

/** Number of data bits needed to encode `count` units in `mode`. */
export function getDataBitLength(mode, count) {
  switch (mode) {
    case 'numeric': {
      // Groups of 3 digits -> 10 bits; a leftover of 2 -> 7 bits, 1 -> 4 bits.
      const rest = count % 3;
      return Math.floor(count / 3) * 10 + (rest === 2 ? 7 : rest === 1 ? 4 : 0);
    }
    case 'alphanumeric':
      // Pairs -> 11 bits; a leftover single character -> 6 bits.
      return Math.floor(count / 2) * 11 + (count % 2) * 6;
    case 'byte':
      return count * 8;
    default:
      throw new RangeError(`unknown mode ${JSON.stringify(mode)}`);
  }
}

/** Total bits of the segment: mode indicator + count indicator + data. */
export function getSegmentBitLength(mode, count, version) {
  return 4 + getCharCountBits(mode, version) + getDataBitLength(mode, count);
}

/**
 * Maximum number of units (digits / characters / bytes) that fit in the
 * given version and level. Matches Table 7 of the standard; the table is not
 * hard-coded, it falls out of the codeword counts and the bit costs above.
 */
export function getCapacity(version, ecc, mode) {
  const available = getDataCodewords(version, ecc) * 8 - 4 - getCharCountBits(mode, version);
  switch (mode) {
    case 'numeric': {
      const rest = available % 10;
      return Math.floor(available / 10) * 3 + (rest >= 7 ? 2 : rest >= 4 ? 1 : 0);
    }
    case 'alphanumeric': {
      const rest = available % 11;
      return Math.floor(available / 11) * 2 + (rest >= 6 ? 1 : 0);
    }
    case 'byte':
      return Math.floor(available / 8);
    default:
      throw new RangeError(`unknown mode ${JSON.stringify(mode)}`);
  }
}

export { ALPHANUMERIC_CHARSET };
