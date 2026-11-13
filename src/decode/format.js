/**
 * Reading the format information (ECC level + mask pattern) and the version
 * information from their raw bits.
 *
 * Both are BCH codes with so few valid values (32 and 34) that decoding is
 * simplest as a nearest-neighbour search: the encoder's own formatBits /
 * versionBits produce every valid codeword, and the reading is matched to
 * the one at the smallest Hamming distance. Valid format codewords differ
 * in at least 7 bits and version codewords in at least 8, so up to 3 wrong
 * bits always point back to the right value. A reading further than that
 * from every codeword is unreadable: the symbol carries two copies of each,
 * so the caller passes both and the better one is used.
 */
import { formatBits, versionBits } from '../core/format.js';
import { FormatUnreadableError } from './errors.js';

const MAX_BIT_ERRORS = 3;

const FORMAT_TABLE = [];
for (const ecc of ['L', 'M', 'Q', 'H']) {
  for (let mask = 0; mask < 8; mask++) FORMAT_TABLE.push({ ecc, mask, bits: formatBits(ecc, mask) });
}

const VERSION_TABLE = [];
for (let version = 7; version <= 40; version++) VERSION_TABLE.push({ version, bits: versionBits(version) });

function popcount(n) {
  let count = 0;
  for (; n !== 0; n >>>= 1) count += n & 1;
  return count;
}

/** The table entry nearest to any of the readings, if within MAX_BIT_ERRORS. */
function nearest(readings, table, width) {
  const mask = (1 << width) - 1;
  let best = null;
  for (const reading of readings) {
    if (!Number.isInteger(reading)) continue;
    const value = reading & mask;
    for (const entry of table) {
      const distance = popcount(entry.bits ^ value);
      if (distance <= MAX_BIT_ERRORS && (best === null || distance < best.distance)) best = { entry, distance };
    }
  }
  return best;
}

/**
 * @param {number[]} readings  the raw 15-bit format information, one entry per copy read
 * @returns {{ ecc: string, mask: number, bitErrors: number }}
 * @throws {FormatUnreadableError}
 */
export function decodeFormat(readings) {
  const best = nearest(readings, FORMAT_TABLE, 15);
  if (!best) {
    throw new FormatUnreadableError('Format information unreadable: neither copy is within 3 bits of a valid value', {
      readings: [...readings],
    });
  }
  return { ecc: best.entry.ecc, mask: best.entry.mask, bitErrors: best.distance };
}

/**
 * @param {number[]} readings  the raw 18-bit version information, one entry per copy read
 * @returns {{ version: number, bitErrors: number }}
 * @throws {FormatUnreadableError}
 */
export function decodeVersion(readings) {
  const best = nearest(readings, VERSION_TABLE, 18);
  if (!best) {
    throw new FormatUnreadableError('Version information unreadable: neither copy is within 3 bits of a valid value', {
      readings: [...readings],
    });
  }
  return { version: best.entry.version, bitErrors: best.distance };
}
