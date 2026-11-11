/**
 * Everything that depends only on the symbol version (1..40) and error
 * correction level: symbol size, how many codewords fit, and how those
 * codewords are split into Reed-Solomon blocks.
 */
import { ECC_LEVELS, EC_CODEWORDS_PER_BLOCK, NUM_EC_BLOCKS, ALIGNMENT_POSITIONS } from './tables.js';

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

export function assertVersion(version) {
  if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) {
    throw new RangeError(`version must be an integer from ${MIN_VERSION} to ${MAX_VERSION}, got ${version}`);
  }
}

/** Normalises an ECC level name ("m" -> "M") and returns its table entry. */
export function getEccLevel(ecc) {
  const level = typeof ecc === 'string' ? ECC_LEVELS[ecc.toUpperCase()] : undefined;
  if (!level) throw new RangeError(`ECC level must be one of L, M, Q, H, got ${JSON.stringify(ecc)}`);
  return level;
}

/** Width/height in modules. Every version adds 4 modules per side. */
export function getSize(version) {
  assertVersion(version);
  return 17 + 4 * version;
}

/**
 * Number of modules available for data + error correction codewords, i.e.
 * everything that is not a function pattern (section 7.1, Table 1).
 *
 * Start from the full square and subtract the fixed patterns:
 *   - 3 finder patterns with their separators: 3 x 8 x 8 = 192
 *   - 2 timing patterns: 2 x (size - 16)
 *   - format information: 2 x 15 bits + the always-dark module = 31
 *   - alignment patterns: 25 each, minus the ones overlapping the timing
 *     patterns (the (n - 2) patterns in row 6 and in column 6 each cover
 *     5 timing modules already counted above)
 *   - version information (versions 7+): 2 x 18 = 36
 */
export function getRawDataModules(version) {
  assertVersion(version);
  const size = getSize(version);
  let modules = size * size;
  modules -= 3 * 64; // finders + separators
  modules -= 2 * (size - 16); // timing patterns
  modules -= 31; // format info (x2) + dark module
  const numAlign = ALIGNMENT_POSITIONS[version].length;
  if (numAlign > 0) {
    const patterns = numAlign * numAlign - 3; // all grid points minus the 3 finder corners
    const overlappingTiming = 2 * (numAlign - 2) * 5;
    modules -= patterns * 25 - overlappingTiming;
  }
  if (version >= 7) modules -= 36; // version info (x2)
  return modules;
}

/** Codewords are 8 bits; whatever does not fill a codeword is "remainder bits". */
export function getTotalCodewords(version) {
  return Math.floor(getRawDataModules(version) / 8);
}

/** 0, 3, 4 or 7 zero bits appended after the last codeword (Table 1). */
export function getRemainderBits(version) {
  return getRawDataModules(version) % 8;
}

/**
 * How the codewords of a symbol are divided into Reed-Solomon blocks
 * (Table 9). All blocks of a symbol get the same number of EC codewords,
 * but the data codewords cannot always be split evenly: the first
 * "group 1" blocks are one codeword shorter than the "group 2" blocks.
 *
 * Example, version 5-Q: 134 codewords, 4 blocks with 18 EC codewords each
 * -> 62 data codewords -> 2 blocks of 15 and 2 blocks of 16.
 */
export function getBlockLayout(version, ecc) {
  assertVersion(version);
  const level = getEccLevel(ecc);
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[level.index][version];
  const numBlocks = NUM_EC_BLOCKS[level.index][version];
  const totalCodewords = getTotalCodewords(version);
  const dataCodewords = totalCodewords - ecPerBlock * numBlocks;
  const shortBlockLength = Math.floor(dataCodewords / numBlocks);
  const numLongBlocks = dataCodewords % numBlocks;
  return {
    ecPerBlock,
    numBlocks,
    totalCodewords,
    dataCodewords,
    group1: { count: numBlocks - numLongBlocks, dataPerBlock: shortBlockLength },
    group2: { count: numLongBlocks, dataPerBlock: shortBlockLength + 1 },
  };
}

/** Number of data codewords (before error correction) for a version/level. */
export function getDataCodewords(version, ecc) {
  return getBlockLayout(version, ecc).dataCodewords;
}
