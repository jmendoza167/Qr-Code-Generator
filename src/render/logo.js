/**
 * Logo placement maths. The renderers only receive
 * the result (a box to draw the image in, and a matrix with the modules
 * behind it cleared).
 *
 * Why clearing is safe: at error correction level H a reader can rebuild
 * up to 30% of the codewords. A logo of 30% of the width with one module of
 * padding covers roughly 10% of the modules, well inside that budget. What
 * error correction cannot repair is a missing finder, timing or alignment
 * pattern, so those are never covered: the area shrinks until it is clear
 * of all function modules.
 *
 * One exception: many versions (7-13, 21, 23, 25, 27, 35, 38, 40) have an
 * alignment pattern exactly in the centre of the symbol, where a centred
 * logo must go. Readers only use the alignment pattern nearest the
 * bottom-right corner to correct perspective, never the central ones, so
 * that single pattern may be covered; the plan says so in its notes.
 */
import { createMatrix } from '../core/matrix.js';
import { getSize } from '../core/version.js';
import { ALIGNMENT_POSITIONS } from '../core/tables.js';
import { encode } from '../core/qr.js';

export const DEFAULT_LOGO_SIZE = 20; // percent of the symbol width
export const MAX_LOGO_SIZE = 30;
export const DEFAULT_LOGO_PADDING = 1; // modules

/** Thrown when even a one-module logo would cover a function pattern. */
export class NoRoomForLogoError extends RangeError {
  constructor(message) {
    super(message);
    this.name = 'NoRoomForLogoError';
  }
}

const round4 = (v) => Math.round(v * 10000) / 10000;

/**
 * Coordinate (row = col) of the alignment pattern that covers the symbol's
 * centre module, or null when the centre is free. Exactly centred in
 * versions 7-13, 21, 23, 25, 27, 35 and 38; offset by two modules (so the
 * centre module sits on the pattern's edge) in 22, 24, 26, 37 and 40.
 */
export function centreAlignmentPattern(version) {
  const centre = (getSize(version) - 1) / 2;
  return ALIGNMENT_POSITIONS[version].find((p) => Math.abs(p - centre) <= 2) ?? null;
}

export function hasCentreAlignmentPattern(version) {
  return centreAlignmentPattern(version) !== null;
}

/**
 * Function modules a logo must never cover: everything createMatrix()
 * reserves, minus the 5x5 alignment pattern on the centre (if any).
 */
export function protectedModules(version) {
  const { isFunction } = createMatrix(version);
  const p = centreAlignmentPattern(version);
  if (p !== null) {
    for (let r = p - 2; r <= p + 2; r++) {
      for (let c = p - 2; c <= p + 2; c++) isFunction[r][c] = false;
    }
  }
  return isFunction;
}

/**
 * Plan where a logo goes on a given symbol.
 *
 * @param {boolean[][]} matrix       the encoded symbol (size 17 + 4 * version)
 * @param {Object} [options]
 * @param {number} [options.sizePercent=20]  size of the logo's larger side, in % of the symbol width (max 30)
 * @param {number} [options.padding=1]       clear modules around the logo
 * @param {number} [options.aspect=1]        image width / height, kept intact
 * @returns {{
 *   box: { x: number, y: number, w: number, h: number },     where to draw the image, module units
 *   area: { row: number, col: number, rows: number, cols: number }, modules cleared (whole modules)
 *   matrix: boolean[][],                                     copy with the area cleared
 *   sizePercent: number,                                     effective size after any reduction
 *   warnings: string[],                                      e.g. the logo had to shrink
 *   notes: string[]                                          e.g. the centre alignment pattern is covered
 * }}
 * @throws {NoRoomForLogoError} when a centred logo cannot avoid the protected patterns
 */
export function planLogo(matrix, { sizePercent = DEFAULT_LOGO_SIZE, padding = DEFAULT_LOGO_PADDING, aspect = 1 } = {}) {
  if (!(typeof sizePercent === 'number' && sizePercent > 0 && sizePercent <= MAX_LOGO_SIZE)) {
    throw new RangeError(`logo size must be between 1 and ${MAX_LOGO_SIZE} percent of the code width, got ${sizePercent}`);
  }
  if (!Number.isInteger(padding) || padding < 0) throw new RangeError(`logo padding must be a whole number of modules >= 0, got ${padding}`);
  if (!(typeof aspect === 'number' && Number.isFinite(aspect) && aspect > 0)) throw new RangeError(`logo aspect ratio must be a positive number, got ${aspect}`);

  const size = matrix.length;
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) throw new RangeError('matrix is not a QR symbol');
  const isProtected = protectedModules(version);

  // Candidate sizes for the larger side: the request, then whole modules downwards.
  const requested = (size * sizePercent) / 100;
  const candidates = [requested];
  for (let n = Math.floor(requested - 1e-9); n >= 1; n--) candidates.push(n);

  for (const longSide of candidates) {
    const w = aspect >= 1 ? longSide : longSide * aspect;
    const h = aspect >= 1 ? longSide / aspect : longSide;
    const area = centredArea(size, w, h, padding);
    if (!area || overlapsFunction(area, isProtected)) continue;

    const effective = round4((longSide / size) * 100);
    const warnings = [];
    if (longSide < requested - 1e-9) {
      warnings.push(
        `Logo reduced from ${sizePercent}% to ${Math.round(effective * 10) / 10}% of the code width so it does not cover the finder, alignment or timing patterns`,
      );
    }
    const notes = [];
    if (hasCentreAlignmentPattern(version)) {
      notes.push(
        `The logo covers the alignment pattern at the centre of this version ${version} symbol; readers do not use that one, but test-scan before printing`,
      );
    }
    return {
      box: { x: round4(size / 2 - w / 2), y: round4(size / 2 - h / 2), w: round4(w), h: round4(h) },
      area,
      matrix: clearArea(matrix, area),
      sizePercent: effective,
      warnings,
      notes,
    };
  }
  throw new NoRoomForLogoError(`There is no room for a centred logo in a version ${version} symbol`);
}

/**
 * The whole-module rectangle that contains a w x h box plus padding,
 * centred on the middle module. Symbols are odd-sized, so the rectangle is
 * made odd-sized too; that is what keeps it exactly centred.
 */
function centredArea(size, w, h, padding) {
  let cols = Math.ceil(w - 1e-9) + 2 * padding;
  let rows = Math.ceil(h - 1e-9) + 2 * padding;
  if (cols % 2 === 0) cols++;
  if (rows % 2 === 0) rows++;
  if (cols > size || rows > size) return null;
  return { row: (size - rows) / 2, col: (size - cols) / 2, rows, cols };
}

function overlapsFunction(area, isFunction) {
  for (let r = area.row; r < area.row + area.rows; r++) {
    for (let c = area.col; c < area.col + area.cols; c++) {
      if (isFunction[r][c]) return true;
    }
  }
  return false;
}

/** Copy of the matrix with every module of the area set to light. */
export function clearArea(matrix, area) {
  return matrix.map((row, r) =>
    row.map((dark, c) => {
      const inside = r >= area.row && r < area.row + area.rows && c >= area.col && c < area.col + area.cols;
      return inside ? false : dark;
    }),
  );
}

/**
 * Encode text at level H and plan a logo, moving to a larger version when
 * the natural one would force the logo to shrink (small symbols: the free
 * centre of a version 1 symbol is only 3x3 modules). Tries up to
 * `maxExtraVersions` larger symbols and keeps the best fit.
 *
 * @returns {{ qr: import('../core/qr.js').QrCode, plan: ReturnType<typeof planLogo>, notes: string[] }}
 */
export function encodeWithLogo(text, { sizePercent, padding, aspect, maxExtraVersions = 4, ...encodeOptions } = {}) {
  const options = { ...encodeOptions, ecc: 'H' };
  const base = encode(text, options);
  let best = null;
  const last = Math.min(40, base.version + maxExtraVersions);
  for (let version = base.version; version <= last; version++) {
    const qr = version === base.version ? base : encode(text, { ...options, version });
    let plan;
    try {
      plan = planLogo(qr.matrix, { sizePercent, padding, aspect });
    } catch (err) {
      if (err instanceof NoRoomForLogoError) continue;
      throw err;
    }
    if (plan.warnings.length === 0) {
      best = { qr, plan };
      break;
    }
    if (!best || plan.sizePercent > best.plan.sizePercent) best = { qr, plan };
  }
  if (!best) throw new NoRoomForLogoError('There is no room for a logo in this code');
  const notes = [];
  if (best.qr.version !== base.version) {
    notes.push(`Using version ${best.qr.version} instead of ${base.version} to make room for the logo`);
  }
  notes.push(...best.plan.notes);
  return { ...best, notes };
}
