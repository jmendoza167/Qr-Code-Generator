/**
 * Turns text into the data codewords of a QR symbol (ISO/IEC 18004
 * section 7.4): mode indicator, character count, the data itself, the
 * terminator, bit padding and pad codewords.
 */
import { BitBuffer } from './bits.js';
import { ALPHANUMERIC_CHARSET, PAD_BYTES } from './tables.js';
import {
  getMode,
  getCharCountBits,
  getUnitCount,
  getUnitName,
  getSegmentBitLength,
  getCapacity,
  utf8Encode,
} from './mode.js';
import { getDataCodewords, getEccLevel, MIN_VERSION, MAX_VERSION, assertVersion } from './version.js';
import { DataTooLongError } from './errors.js';

/**
 * Encode the segment: [mode indicator][character count][data bits].
 * No terminator or padding yet; that depends on the final version.
 *
 * @returns {BitBuffer}
 */
export function encodeData(text, mode, version) {
  const bits = new BitBuffer();
  const m = getMode(mode);
  const count = getUnitCount(text, mode);

  bits.append(m.indicator, 4);
  bits.append(count, getCharCountBits(mode, version));

  switch (mode) {
    case 'numeric':
      // Three digits become one 10-bit number (max 999 < 1024). A trailing
      // pair becomes 7 bits (max 99 < 128), a single digit 4 bits.
      for (let i = 0; i < text.length; i += 3) {
        const chunk = text.slice(i, i + 3);
        bits.append(Number(chunk), chunk.length * 3 + 1);
      }
      break;

    case 'alphanumeric':
      // Pairs become 45 * first + second in 11 bits (max 2024 < 2048);
      // a trailing single character is its 6-bit value.
      for (let i = 0; i < text.length; i += 2) {
        const a = ALPHANUMERIC_CHARSET.indexOf(text[i]);
        if (i + 1 < text.length) {
          const b = ALPHANUMERIC_CHARSET.indexOf(text[i + 1]);
          bits.append(a * 45 + b, 11);
        } else {
          bits.append(a, 6);
        }
      }
      break;

    case 'byte':
      // Plain bytes. We always use UTF-8, which is what every modern reader
      // assumes for byte mode, so accents and emoji survive the round trip.
      for (const byte of utf8Encode(text)) bits.append(byte, 8);
      break;

    default:
      throw new RangeError(`unknown mode ${JSON.stringify(mode)}`);
  }
  return bits;
}

/**
 * The smallest version (within [minVersion, maxVersion]) whose data
 * capacity holds the text. The character count indicator grows at versions
 * 10 and 27, so the bit length is recomputed per version.
 *
 * @throws {DataTooLongError} if even maxVersion is too small
 */
export function chooseVersion(text, mode, ecc, { minVersion = MIN_VERSION, maxVersion = MAX_VERSION } = {}) {
  assertVersion(minVersion);
  assertVersion(maxVersion);
  const level = getEccLevel(ecc);
  const count = getUnitCount(text, mode);
  for (let version = minVersion; version <= maxVersion; version++) {
    if (getSegmentBitLength(mode, count, version) <= getDataCodewords(version, level.name) * 8) {
      return version;
    }
  }
  throw tooLong(count, mode, maxVersion, level.name);
}

function tooLong(count, mode, version, ecc) {
  const unit = getUnitName(mode);
  const capacity = getCapacity(version, ecc, mode);
  return new DataTooLongError(
    `Data too long: ${count} ${unit} in ${mode} mode, but version ${version}-${ecc} holds at most ${capacity} ${unit}`,
    { count, mode, version, ecc, capacity },
  );
}

/**
 * Full data codeword sequence for a known version/level (section 7.4.9-10):
 *
 *   1. the encoded segment,
 *   2. a terminator of up to four 0 bits (fewer if the symbol is nearly full),
 *   3. 0 bits until the length is a multiple of 8,
 *   4. pad codewords 0xEC, 0x11, 0xEC, 0x11 ... until every data codeword is used.
 *
 * @returns {Uint8Array} exactly getDataCodewords(version, ecc) bytes
 */
export function buildDataCodewords(text, mode, version, ecc) {
  const level = getEccLevel(ecc);
  const capacityBits = getDataCodewords(version, level.name) * 8;
  const bits = encodeData(text, mode, version);
  if (bits.length > capacityBits) throw tooLong(getUnitCount(text, mode), mode, version, level.name);

  bits.append(0, Math.min(4, capacityBits - bits.length)); // terminator
  bits.append(0, (8 - (bits.length % 8)) % 8); // byte-align

  const codewords = new Uint8Array(capacityBits / 8);
  codewords.set(bits.toBytes());
  for (let i = bits.length / 8, p = 0; i < codewords.length; i++, p++) {
    codewords[i] = PAD_BYTES[p % 2];
  }
  return codewords;
}
