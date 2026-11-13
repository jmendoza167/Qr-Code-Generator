/**
 * From three finder centres to a module matrix.
 *
 * The three centres fix an affine map between module coordinates and
 * pixels: the top-left centre is module (3.5, 3.5), the top-right centre is
 * (dimension - 3.5, 3.5) and the bottom-left (3.5, dimension - 3.5). That
 * handles scale, 90-degree rotations and small skews, but not perspective
 * (camera photos are out of scope for now). Every module is sampled at its
 * centre.
 *
 * The symbol size in modules is estimated from the finder distances and
 * snapped to the nearest valid size (21, 25, ... 177). Before the symbol is
 * decoded, the sampled timing and alignment patterns are compared with the
 * template for that version; a poor match means this is not a QR code at
 * this size, so the caller can try the next estimate or the next triple
 * without ever reading format bits out of random pixels.
 */
import { createMatrix } from '../core/matrix.js';
import { ALIGNMENT_POSITIONS } from '../core/tables.js';
import { getSize, MIN_VERSION, MAX_VERSION } from '../core/version.js';

/** Symbol sizes worth trying for a triple, most likely first (at most two). */
export function candidateDimensions({ modulesAcross }) {
  const nearest = Math.min(MAX_VERSION, Math.max(MIN_VERSION, Math.round((modulesAcross - 17) / 4)));
  const dimensions = [getSize(nearest)];
  const alternative = modulesAcross > getSize(nearest) ? nearest + 1 : nearest - 1;
  if (alternative >= MIN_VERSION && alternative <= MAX_VERSION && Math.abs(modulesAcross - getSize(alternative)) <= 2.5) {
    dimensions.push(getSize(alternative));
  }
  return dimensions;
}

/**
 * Sample the bitmap at every module centre.
 *
 * @param {{ width: number, height: number, bits: Uint8Array }} bitmap
 * @param {{ topLeft: {x: number, y: number}, topRight: {x: number, y: number}, bottomLeft: {x: number, y: number} }} triple
 * @param {number} dimension  modules per side (17 + 4 * version)
 * @returns {Uint8Array[]} modules[row][col], 1 = dark; pixels outside the image read as light
 */
export function sampleGrid(bitmap, { topLeft, topRight, bottomLeft }, dimension) {
  const { width, height, bits } = bitmap;
  const n = dimension - 7;
  const ex = { x: (topRight.x - topLeft.x) / n, y: (topRight.y - topLeft.y) / n }; // one module along a row
  const ey = { x: (bottomLeft.x - topLeft.x) / n, y: (bottomLeft.y - topLeft.y) / n }; // one module down a column
  const origin = { x: topLeft.x - 3.5 * (ex.x + ey.x), y: topLeft.y - 3.5 * (ex.y + ey.y) };
  const modules = [];
  for (let row = 0; row < dimension; row++) {
    const line = new Uint8Array(dimension);
    for (let col = 0; col < dimension; col++) {
      const x = Math.floor(origin.x + (col + 0.5) * ex.x + (row + 0.5) * ey.x);
      const y = Math.floor(origin.y + (col + 0.5) * ex.y + (row + 0.5) * ey.y);
      if (x >= 0 && x < width && y >= 0 && y < height && bits[y * width + x] === 1) line[col] = 1;
    }
    modules.push(line);
  }
  return modules;
}

const templateCache = new Map();

/**
 * The function modules that tell a correctly sized symbol from anything
 * else: the two timing patterns, the core of every alignment pattern, and
 * the dark module. The finder patterns are left out on purpose: the
 * candidate triple already proves they are there, and they would swamp
 * the count. Alignment corners are left out too, because qrgen's circular
 * finder style rounds them off.
 */
function checkedModules(version) {
  let cached = templateCache.get(version);
  if (cached) return cached;
  const template = createMatrix(version);
  const { size } = template;
  const positions = [];
  const add = (r, c) => positions.push([r, c, template.modules[r][c] ? 1 : 0]);
  for (let i = 8; i < size - 8; i++) {
    add(6, i);
    add(i, 6);
  }
  add(size - 8, 8);
  const centres = ALIGNMENT_POSITIONS[version];
  const first = centres[0];
  const last = centres[centres.length - 1];
  for (const r of centres) {
    for (const c of centres) {
      if ((r === first && c === first) || (r === first && c === last) || (r === last && c === first)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr * dr + dc * dc <= 4 && (r + dr !== 6 || c + dc < 8) && (c + dc !== 6 || r + dr < 8)) add(r + dr, c + dc);
        }
      }
    }
  }
  cached = { positions };
  templateCache.set(version, cached);
  return cached;
}

/**
 * Fraction (0..1) of the checked function modules that do not match the
 * template. A real symbol scores near 0, or about 0.1 with a logo over the
 * central alignment pattern; random pixels or a wrong size score near 0.5.
 */
export function functionPatternMismatch(modules) {
  const version = (modules.length - 17) / 4;
  const { positions } = checkedModules(version);
  let wrong = 0;
  for (const [r, c, expected] of positions) if ((modules[r][c] ? 1 : 0) !== expected) wrong++;
  return wrong / positions.length;
}
