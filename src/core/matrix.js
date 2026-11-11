/**
 * The module matrix: function patterns, reserved areas, data placement and
 * format/version information (ISO/IEC 18004 sections 7.3 and 7.7-7.10).
 *
 * A matrix carries two grids of the same size:
 *   modules[row][col]    true = dark
 *   isFunction[row][col] true = fixed pattern or reserved area; data
 *                        placement and masking must leave it alone.
 */
import { ALIGNMENT_POSITIONS } from './tables.js';
import { assertVersion, getSize, getTotalCodewords, getRemainderBits } from './version.js';
import { formatBits, versionBits } from './format.js';

/**
 * Build a matrix with every function pattern drawn and every reserved area
 * marked. Data modules are left light. Format information is only
 * *reserved* here (it depends on the mask, chosen later); version
 * information is drawn because it depends only on the version.
 */
export function createMatrix(version) {
  assertVersion(version);
  const size = getSize(version);
  const matrix = {
    version,
    size,
    modules: Array.from({ length: size }, () => new Array(size).fill(false)),
    isFunction: Array.from({ length: size }, () => new Array(size).fill(false)),
  };
  drawFinderPatterns(matrix);
  drawTimingPatterns(matrix);
  drawAlignmentPatterns(matrix);
  reserveFormatInfo(matrix);
  if (version >= 7) drawVersionInfo(matrix);
  return matrix;
}

function setFunctionModule(matrix, row, col, dark) {
  matrix.modules[row][col] = dark;
  matrix.isFunction[row][col] = true;
}

/**
 * Three 7x7 finder patterns (dark 3x3 centre, light ring, dark border) in
 * the top-left, top-right and bottom-left corners, each wrapped in a
 * 1-module light separator. Offsets -1 and 7 are the separator; anything
 * outside the symbol is skipped.
 */
function drawFinderPatterns(matrix) {
  const { size } = matrix;
  for (const [r0, c0] of [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ]) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const row = r0 + dr;
        const col = c0 + dc;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onLightRing = Math.max(Math.abs(dr - 3), Math.abs(dc - 3)) === 2;
        setFunctionModule(matrix, row, col, inside && !onLightRing);
      }
    }
  }
}

/** Row 6 and column 6 alternate dark/light between the finders, starting dark. */
function drawTimingPatterns(matrix) {
  const { size } = matrix;
  for (let i = 8; i < size - 8; i++) {
    setFunctionModule(matrix, 6, i, i % 2 === 0);
    setFunctionModule(matrix, i, 6, i % 2 === 0);
  }
}

/**
 * 5x5 alignment patterns (dark centre, light ring, dark border) at every
 * pair of coordinates from the table, except the three spots covered by
 * finder patterns. Where one crosses a timing pattern the modules agree
 * by design (the centres are always at even coordinates).
 */
function drawAlignmentPatterns(matrix) {
  const positions = ALIGNMENT_POSITIONS[matrix.version];
  const first = positions[0];
  const last = positions[positions.length - 1];
  for (const r of positions) {
    for (const c of positions) {
      const overlapsFinder = (r === first && c === first) || (r === first && c === last) || (r === last && c === first);
      if (overlapsFinder) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          setFunctionModule(matrix, r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }
}

/**
 * Where each of the 15 format bits lives (Figure 25). Bit i is written
 * twice for redundancy: once around the top-left finder and once split
 * between the top-right and bottom-left finders. The first copy hops over
 * the timing pattern at (6,8) and (8,6).
 *
 * @returns {[[number, number], [number, number]][]} [row, col] pairs per bit
 */
function formatInfoPositions(size) {
  const positions = [];
  for (let i = 0; i < 15; i++) {
    let first;
    if (i <= 5) first = [i, 8]; // column 8, going down
    else if (i === 6) first = [7, 8]; // skip the timing module at row 6
    else if (i === 7) first = [8, 8]; // the corner
    else if (i === 8) first = [8, 7]; // skip the timing module at column 6
    else first = [8, 14 - i]; // row 8, going left to column 0
    const second = i <= 7 ? [8, size - 1 - i] : [size - 15 + i, 8];
    positions.push([first, second]);
  }
  return positions;
}

/** Mark the format areas as reserved (light for now) and draw the dark module. */
function reserveFormatInfo(matrix) {
  for (const [first, second] of formatInfoPositions(matrix.size)) {
    setFunctionModule(matrix, first[0], first[1], false);
    setFunctionModule(matrix, second[0], second[1], false);
  }
  // The module just above the bottom-left finder's separator is always dark.
  setFunctionModule(matrix, matrix.size - 8, 8, true);
}

/** Write the real format bits for the chosen ECC level and mask. */
export function drawFormatInfo(matrix, ecc, mask) {
  const bits = formatBits(ecc, mask);
  formatInfoPositions(matrix.size).forEach(([first, second], i) => {
    const dark = ((bits >>> i) & 1) === 1;
    setFunctionModule(matrix, first[0], first[1], dark);
    setFunctionModule(matrix, second[0], second[1], dark);
  });
}

/**
 * Versions 7+ carry their 18 version bits in two 6x3 blocks: one above the
 * bottom-left finder, one left of the top-right finder (transposed). Bit i
 * sits at row floor(i / 3), column size - 11 + (i % 3) of the top-right block.
 */
function drawVersionInfo(matrix) {
  const { size } = matrix;
  const bits = versionBits(matrix.version);
  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const a = Math.floor(i / 3);
    const b = size - 11 + (i % 3);
    setFunctionModule(matrix, a, b, dark); // top-right block
    setFunctionModule(matrix, b, a, dark); // bottom-left block
  }
}

/**
 * Place the codeword bits in the zigzag order of section 7.7.3.
 *
 * Walk column pairs from the right edge to the left. The first pair is
 * filled bottom-to-top, the next top-to-bottom, and so on. Within each
 * row of a pair the right module comes before the left one. Function
 * modules are skipped, and so is column 6 entirely (the vertical timing
 * pattern), which is why `right` jumps from 6 to 5.
 *
 * Any free modules left after the last codeword bit are the "remainder
 * bits"; they stay light (zero).
 */
export function placeData(matrix, codewords) {
  const { size, modules, isFunction, version } = matrix;
  const total = getTotalCodewords(version);
  if (codewords.length !== total) {
    throw new RangeError(`version ${version} needs ${total} codewords, got ${codewords.length}`);
  }
  const totalBits = total * 8;
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (isFunction[row][col]) continue;
        if (bitIndex < totalBits) {
          const byte = codewords[bitIndex >> 3];
          modules[row][col] = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        }
        bitIndex++;
      }
    }
  }
  // Every free module was visited exactly once: codeword bits + remainder bits.
  if (bitIndex !== totalBits + getRemainderBits(version)) {
    throw new Error(`internal error: placed ${bitIndex} bits, expected ${totalBits + getRemainderBits(version)}`);
  }
}
