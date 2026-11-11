/**
 * The public entry point of the pure QR engine. Pipeline:
 *
 *   text ──detectMode──▶ mode
 *        ──chooseVersion──▶ version (smallest that fits)
 *        ──buildCodewords──▶ data codewords + Reed-Solomon ECC, interleaved
 *        ──createMatrix + placeData──▶ modules with function patterns
 *        ──chooseMask──▶ masked modules + format information
 *
 * No Node APIs are used anywhere under src/core, so this runs unchanged in
 * a browser.
 */
import { detectMode } from './mode.js';
import { chooseVersion } from './encoder.js';
import { buildCodewords } from './blocks.js';
import { createMatrix, placeData } from './matrix.js';
import { chooseMask } from './mask.js';
import { getEccLevel, assertVersion, MIN_VERSION, MAX_VERSION } from './version.js';

export { DataTooLongError } from './errors.js';
export { detectMode, getCapacity } from './mode.js';
export { MIN_VERSION, MAX_VERSION } from './version.js';

/**
 * @typedef {Object} QrCode
 * @property {boolean[][]} matrix  matrix[row][col], true = dark module
 * @property {number} size         modules per side (17 + 4 * version)
 * @property {number} version      1..40
 * @property {'L'|'M'|'Q'|'H'} ecc error correction level
 * @property {number} mask         mask pattern used, 0..7
 * @property {'numeric'|'alphanumeric'|'byte'} mode
 */

/**
 * Encode text into a QR code matrix.
 *
 * @param {string} text  the content; UTF-8 is used for byte mode
 * @param {Object} [options]
 * @param {'L'|'M'|'Q'|'H'} [options.ecc='M']  error correction level
 * @param {number} [options.version]    force a version instead of picking the smallest
 * @param {number} [options.minVersion=1]
 * @param {number} [options.maxVersion=40]
 * @param {number} [options.mask]       force a mask pattern (0..7) instead of scoring all eight
 * @returns {QrCode}
 * @throws {DataTooLongError} if the text does not fit in the allowed versions
 */
export function encode(text, options = {}) {
  if (typeof text !== 'string') throw new TypeError(`text must be a string, got ${typeof text}`);
  if (text.length === 0) throw new RangeError('Cannot encode empty text');

  const { ecc = 'M', version: forcedVersion, minVersion = MIN_VERSION, maxVersion = MAX_VERSION, mask } = options;
  const level = getEccLevel(ecc);
  if (forcedVersion !== undefined) assertVersion(forcedVersion);

  const mode = detectMode(text);
  const version = forcedVersion ?? chooseVersion(text, mode, level.name, { minVersion, maxVersion });
  const codewords = buildCodewords(text, mode, version, level.name);

  const matrix = createMatrix(version);
  placeData(matrix, codewords);
  const chosen = chooseMask(matrix, level.name, mask);

  return {
    matrix: matrix.modules,
    size: matrix.size,
    version,
    ecc: level.name,
    mask: chosen.mask,
    mode,
  };
}
