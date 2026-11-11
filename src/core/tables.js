/**
 * Constant tables from ISO/IEC 18004. Nothing in here is computed; this file
 * is the part of the standard you have to look up rather than derive.
 */

/**
 * Error correction levels. `formatBits` is the 2-bit code written into the
 * format information (note the odd ordering: L=01, M=00, Q=11, H=10).
 * `index` selects the row in the block tables below.
 */
export const ECC_LEVELS = Object.freeze({
  L: Object.freeze({ name: 'L', index: 0, formatBits: 0b01, recovery: '~7%' }),
  M: Object.freeze({ name: 'M', index: 1, formatBits: 0b00, recovery: '~15%' }),
  Q: Object.freeze({ name: 'Q', index: 2, formatBits: 0b11, recovery: '~25%' }),
  H: Object.freeze({ name: 'H', index: 3, formatBits: 0b10, recovery: '~30%' }),
});

/**
 * Encoding modes (section 7.4). `indicator` is the 4-bit mode indicator that
 * starts the bit stream. `charCountBits` is the width of the character count
 * indicator for versions 1-9, 10-26 and 27-40 respectively (Table 3).
 */
export const MODES = Object.freeze({
  numeric: Object.freeze({ name: 'numeric', indicator: 0b0001, charCountBits: [10, 12, 14] }),
  alphanumeric: Object.freeze({ name: 'alphanumeric', indicator: 0b0010, charCountBits: [9, 11, 13] }),
  byte: Object.freeze({ name: 'byte', indicator: 0b0100, charCountBits: [8, 16, 16] }),
});

/** The 45 characters of alphanumeric mode, in value order (Table 5). */
export const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Pad codewords alternate between these two after the data (section 7.4.10). */
export const PAD_BYTES = Object.freeze([0xec, 0x11]);

/**
 * Error correction codewords per block, indexed [ECC_LEVELS[x].index][version]
 * (Table 9). Index 0 of each row is unused so that version numbers can be
 * used directly.
 */
export const EC_CODEWORDS_PER_BLOCK = Object.freeze([
  // L
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // M
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  // Q
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  // H
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]);

/** Total number of error correction blocks, same indexing as above (Table 9). */
export const NUM_EC_BLOCKS = Object.freeze([
  // L
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  // M
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  // Q
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  // H
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]);

/**
 * Row/column coordinates of alignment pattern centres, per version (Annex E,
 * Table E.1). Alignment patterns sit at every combination of these
 * coordinates except the three that would overlap the finder patterns.
 * Index 0 is unused.
 */
export const ALIGNMENT_POSITIONS = Object.freeze([
  [],
  [], // version 1 has no alignment patterns
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
  [6, 30, 54, 78],
  [6, 30, 56, 82],
  [6, 30, 58, 86],
  [6, 34, 62, 90],
  [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102],
  [6, 28, 54, 80, 106],
  [6, 32, 58, 84, 110],
  [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122],
  [6, 30, 54, 78, 102, 126],
  [6, 26, 52, 78, 104, 130],
  [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138],
  [6, 30, 58, 86, 114, 142],
  [6, 34, 62, 90, 118, 146],
  [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158],
  [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166],
  [6, 30, 58, 86, 114, 142, 170],
].map(Object.freeze));
