/**
 * From a module matrix to text: the reverse of src/core/qr.js once the
 * modules are known.
 *
 *   modules ──size──▶ version
 *           ──format positions──▶ ECC level + mask (BCH-corrected)
 *           ──version positions──▶ version check for v7+ (BCH-corrected)
 *           ──unmask + zigzag walk──▶ interleaved codewords
 *           ──de-interleave──▶ Reed-Solomon blocks
 *           ──correctBlock──▶ data codewords (or TooManyErrorsError)
 *           ──decodeSegments──▶ text
 *
 * The function-pattern map comes from the encoder's createMatrix, so the
 * reader skips exactly the modules the writer skipped. Every loop here is
 * bounded by the symbol size (at most 177 x 177).
 */
import { createMatrix, dataModulePositions, formatInfoPositions, versionInfoPositions } from '../core/matrix.js';
import { MASK_PATTERNS } from '../core/mask.js';
import { getBlockLayout, getTotalCodewords, MIN_VERSION, MAX_VERSION } from '../core/version.js';
import { decodeFormat, decodeVersion } from './format.js';
import { correctBlock } from './rs-decode.js';
import { decodeSegments } from './segments.js';
import { QrDecodeError, FormatUnreadableError } from './errors.js';

/** Validate the matrix shape and return its version. */
function versionFromSize(modules) {
  if (!Array.isArray(modules) || modules.length === 0) throw new QrDecodeError('Not a QR symbol: expected a square module matrix');
  const size = modules.length;
  for (const row of modules) {
    if (row == null || row.length !== size) throw new QrDecodeError(`Not a QR symbol: the module matrix is not square (${size} rows)`);
  }
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) {
    throw new QrDecodeError(`Not a QR symbol: ${size} modules per side does not match any version (21 to 177 in steps of 4)`);
  }
  return version;
}

/** Read the bits at the given [row, col] positions as an integer, bit i at positions[i]. */
function readBits(modules, positions) {
  let value = 0;
  positions.forEach(([row, col], i) => {
    if (modules[row][col]) value |= 1 << i;
  });
  return value;
}

/** Interleaved codeword sequence -> per-block arrays (data followed by EC), reverse of interleaveBlocks. */
function deinterleave(codewords, layout) {
  const lengths = [];
  for (let i = 0; i < layout.group1.count; i++) lengths.push(layout.group1.dataPerBlock);
  for (let i = 0; i < layout.group2.count; i++) lengths.push(layout.group2.dataPerBlock);
  const blocks = lengths.map((dataLength) => new Uint8Array(dataLength + layout.ecPerBlock));
  let n = 0;
  const longest = Math.max(...lengths);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < blocks.length; b++) if (i < lengths[b]) blocks[b][i] = codewords[n++];
  }
  for (let i = 0; i < layout.ecPerBlock; i++) {
    for (let b = 0; b < blocks.length; b++) blocks[b][lengths[b] + i] = codewords[n++];
  }
  return { blocks, lengths };
}

/**
 * @typedef {Object} DecodedQr
 * @property {string} text               the content, exactly as encoded (untrusted: escape before printing)
 * @property {number} version            1..40
 * @property {'L'|'M'|'Q'|'H'} ecc
 * @property {number} mask               0..7
 * @property {number} errorsCorrected    codewords repaired by Reed-Solomon, over all blocks
 * @property {number} formatBitErrors    wrong bits in the best copy of the format information (0..3)
 * @property {number|null} versionBitErrors  same for the version information; null below version 7
 * @property {{mode: string, count: number}[]} segments
 * @property {'utf-8'|'latin-1'|null} encoding  how byte segments were read; null if there were none
 * @property {number|null} eci           the ECI designator, if the data carried one
 */

/**
 * Decode a QR symbol given as a square matrix of modules (true / 1 = dark).
 *
 * @param {ArrayLike<ArrayLike<boolean|number>>[]} modules  modules[row][col]
 * @returns {DecodedQr}
 * @throws {QrDecodeError} and its subclasses; never returns partially corrected data
 */
export function readMatrix(modules) {
  const version = versionFromSize(modules);
  const size = modules.length;
  const template = createMatrix(version);

  const formatReadings = [0, 1].map((copy) => readBits(modules, formatInfoPositions(size).map((pair) => pair[copy])));
  const format = decodeFormat(formatReadings);

  let versionBitErrors = null;
  if (version >= 7) {
    const readings = [0, 1].map((copy) => readBits(modules, versionInfoPositions(size).map((pair) => pair[copy])));
    const info = decodeVersion(readings);
    if (info.version !== version) {
      throw new FormatUnreadableError(
        `Version information says version ${info.version}, but the symbol is ${size} modules wide (version ${version})`,
        { readings, sizeVersion: version, infoVersion: info.version },
      );
    }
    versionBitErrors = info.bitErrors;
  }

  // Unmask while reading: the mask only ever touched non-function modules,
  // which are exactly the ones the zigzag walk visits.
  const pattern = MASK_PATTERNS[format.mask];
  const total = getTotalCodewords(version);
  const codewords = new Uint8Array(total);
  let bitIndex = 0;
  for (const [row, col] of dataModulePositions(template)) {
    if (bitIndex >= total * 8) break; // remainder bits carry nothing
    const dark = Boolean(modules[row][col]) !== pattern(row, col);
    if (dark) codewords[bitIndex >> 3] |= 0x80 >> (bitIndex & 7);
    bitIndex++;
  }

  const layout = getBlockLayout(version, format.ecc);
  const { blocks, lengths } = deinterleave(codewords, layout);
  const data = new Uint8Array(layout.dataCodewords);
  let errorsCorrected = 0;
  let offset = 0;
  blocks.forEach((block, b) => {
    const result = correctBlock(block, layout.ecPerBlock);
    errorsCorrected += result.corrected;
    data.set(result.codewords.subarray(0, lengths[b]), offset);
    offset += lengths[b];
  });

  const { text, segments, encoding, eci } = decodeSegments(data, version);
  return {
    text,
    version,
    ecc: format.ecc,
    mask: format.mask,
    errorsCorrected,
    formatBitErrors: format.bitErrors,
    versionBitErrors,
    segments,
    encoding,
    eci,
  };
}
