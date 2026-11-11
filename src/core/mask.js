/**
 * Masking (ISO/IEC 18004 section 7.8).
 *
 * Why mask at all?
 * ----------------
 * Raw data can produce large blank areas, long stripes, or shapes that look
 * like finder patterns, all of which confuse scanners. So the data modules
 * are XORed with one of eight fixed checkerboard-like patterns. The encoder
 * tries all eight, scores each result with four penalty rules, and keeps the
 * lowest score. The chosen pattern number is stored in the format
 * information so the reader can undo it. Function patterns are never masked.
 */
import { drawFormatInfo } from './matrix.js';

/**
 * The eight mask patterns (Table 10). Each returns true when the data module
 * at (row, col) must be flipped. The `i` and `j` of the spec are row and col.
 */
export const MASK_PATTERNS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function assertMask(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) {
    throw new RangeError(`mask pattern must be 0..7, got ${mask}`);
  }
}

/**
 * XOR the data modules with a mask pattern, in place. XOR is its own
 * inverse, so applying the same mask twice restores the original.
 */
export function applyMask(matrix, mask) {
  assertMask(mask);
  const pattern = MASK_PATTERNS[mask];
  const { size, modules, isFunction } = matrix;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r][c] && pattern(r, c)) modules[r][c] = !modules[r][c];
    }
  }
}

// Penalty weights from the standard.
const N1 = 3;
const N2 = 3;
const N3 = 40;
const N4 = 10;

/** Every row, then every column, as plain arrays of booleans. */
function* lines(modules) {
  const height = modules.length;
  const width = modules[0].length;
  for (const row of modules) yield row;
  for (let c = 0; c < width; c++) {
    const col = new Array(height);
    for (let r = 0; r < height; r++) col[r] = modules[r][c];
    yield col;
  }
}

/**
 * Rule 1: a run of 5 or more same-colour modules in a row or column costs
 * N1 + (length - 5). Long runs look like timing patterns or blank space.
 */
export function penaltyRuns(modules) {
  let penalty = 0;
  for (const line of lines(modules)) {
    let runLength = 1;
    for (let i = 1; i <= line.length; i++) {
      if (i < line.length && line[i] === line[i - 1]) {
        runLength++;
      } else {
        if (runLength >= 5) penalty += N1 + (runLength - 5);
        runLength = 1;
      }
    }
  }
  return penalty;
}

/** Rule 2: each 2x2 block of one colour costs N2. Overlapping blocks all count. */
export function penaltyBlocks(modules) {
  let penalty = 0;
  for (let r = 0; r + 1 < modules.length; r++) {
    for (let c = 0; c + 1 < modules[r].length; c++) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) penalty += N2;
    }
  }
  return penalty;
}

/**
 * Rule 3: the sequence dark-light-dark-dark-dark-light-dark (the 1:1:3:1:1
 * ratio of a finder pattern) with four light modules on either side costs
 * N3. Such a shape could fool a reader into locating a finder in the data.
 */
const FINDER_LIKE_A = [true, false, true, true, true, false, true, false, false, false, false];
const FINDER_LIKE_B = [false, false, false, false, true, false, true, true, true, false, true];

export function penaltyFinderLike(modules) {
  let penalty = 0;
  for (const line of lines(modules)) {
    for (let i = 0; i + 11 <= line.length; i++) {
      let matchesA = true;
      let matchesB = true;
      for (let k = 0; k < 11 && (matchesA || matchesB); k++) {
        if (line[i + k] !== FINDER_LIKE_A[k]) matchesA = false;
        if (line[i + k] !== FINDER_LIKE_B[k]) matchesB = false;
      }
      if (matchesA) penalty += N3;
      if (matchesB) penalty += N3;
    }
  }
  return penalty;
}

/**
 * Rule 4: dark modules should be about half of the symbol. For every full
 * 5% step the proportion is away from 50%, add N4. "k" below is the
 * smallest integer such that the proportion lies within 50 +/- 5(k + 1)%.
 */
export function penaltyBalance(modules) {
  let dark = 0;
  let total = 0;
  for (const row of modules) {
    for (const v of row) {
      total++;
      if (v) dark++;
    }
  }
  const k = Math.max(0, Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1);
  return N4 * k;
}

export function computePenalty(modules) {
  return penaltyRuns(modules) + penaltyBlocks(modules) + penaltyFinderLike(modules) + penaltyBalance(modules);
}

/**
 * Try all eight masks on a matrix that already has its data placed, keep
 * the one with the lowest penalty, and leave the matrix masked with the
 * matching format information written. Ties go to the lower mask number.
 *
 * The format bits are drawn before scoring because they are part of the
 * symbol being judged. Undoing a mask is just applying it again.
 *
 * @param {number} [forcedMask] skip the search and use this pattern
 * @returns {{ mask: number, penalty: number }}
 */
export function chooseMask(matrix, ecc, forcedMask) {
  if (forcedMask !== undefined) {
    assertMask(forcedMask);
    applyMask(matrix, forcedMask);
    drawFormatInfo(matrix, ecc, forcedMask);
    return { mask: forcedMask, penalty: computePenalty(matrix.modules) };
  }
  let best = { mask: -1, penalty: Infinity };
  for (let mask = 0; mask < 8; mask++) {
    applyMask(matrix, mask);
    drawFormatInfo(matrix, ecc, mask);
    const penalty = computePenalty(matrix.modules);
    if (penalty < best.penalty) best = { mask, penalty };
    applyMask(matrix, mask); // undo
  }
  applyMask(matrix, best.mask);
  drawFormatInfo(matrix, ecc, best.mask);
  return best;
}
