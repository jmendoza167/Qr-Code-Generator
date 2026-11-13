/**
 * Locating finder patterns (the three big squares) in a bitmap.
 *
 * A finder pattern is 7 modules wide: dark, light, dark x3, light, dark. Any
 * line through its centre crosses runs in the ratio 1:1:3:1:1, whatever the
 * scale. The search scans every row for five alternating runs in that
 * ratio, then confirms each hit by scanning the column through its centre
 * and a row through the refined centre. Hits that land on the same spot are
 * merged, so a pattern crossed by several scan rows becomes one candidate
 * with a higher count.
 *
 * Bounds: the row scan is one pass over the pixels. Each confirmation walks
 * at most a few times the centre run, so a row full of hits still costs
 * O(width). The candidate list is capped, and only the best candidates are
 * combined into triples, so a field of finder-like squares cannot blow up
 * the work.
 */
export const MAX_CANDIDATES = 64;
const MAX_TRIPLE_SOURCES = 16;

/** Do five run lengths look like 1:1:3:1:1 (within half a module each)? */
function matchesRatio(c) {
  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (total < 7) return false;
  const module = total / 7;
  const maxVariance = module / 2;
  return (
    Math.abs(module - c[0]) < maxVariance &&
    Math.abs(module - c[1]) < maxVariance &&
    Math.abs(3 * module - c[2]) < 3 * maxVariance &&
    Math.abs(module - c[3]) < maxVariance &&
    Math.abs(module - c[4]) < maxVariance
  );
}

/** Centre of the middle run, given where the last run ended. */
function centerFromEnd(c, end) {
  return end - c[4] - c[3] - c[2] / 2;
}

/**
 * Walk from (x, startY) up and down through dark-light-dark-light-dark and
 * check the ratio. `maxCount` (the horizontal centre run) bounds every walk.
 * Returns the refined centre y, or null.
 */
function crossCheckVertical({ width, height, bits }, x, startY, maxCount, originalTotal) {
  const dark = (y) => bits[y * width + x] === 1;
  const limit = maxCount * 2;
  const c = [0, 0, 0, 0, 0];
  let y = startY;
  while (y >= 0 && dark(y) && c[2] <= limit) {
    c[2]++;
    y--;
  }
  if (y < 0 || c[2] > limit) return null;
  while (y >= 0 && !dark(y) && c[1] <= maxCount) {
    c[1]++;
    y--;
  }
  if (y < 0 || c[1] > maxCount) return null;
  while (y >= 0 && dark(y) && c[0] <= maxCount) {
    c[0]++;
    y--;
  }
  if (c[0] > maxCount) return null;

  y = startY + 1;
  while (y < height && dark(y) && c[2] <= limit) {
    c[2]++;
    y++;
  }
  if (y === height || c[2] > limit) return null;
  while (y < height && !dark(y) && c[3] < maxCount) {
    c[3]++;
    y++;
  }
  if (y === height || c[3] >= maxCount) return null;
  while (y < height && dark(y) && c[4] < maxCount) {
    c[4]++;
    y++;
  }
  if (c[4] >= maxCount) return null;

  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (5 * Math.abs(total - originalTotal) >= 2 * originalTotal) return null;
  return matchesRatio(c) ? centerFromEnd(c, y) : null;
}

/** Same as crossCheckVertical, along the row `y`. Returns the refined centre x, or null. */
function crossCheckHorizontal({ width, bits }, startX, y, maxCount, originalTotal) {
  const row = y * width;
  const dark = (x) => bits[row + x] === 1;
  const limit = maxCount * 2;
  const c = [0, 0, 0, 0, 0];
  let x = startX;
  while (x >= 0 && dark(x) && c[2] <= limit) {
    c[2]++;
    x--;
  }
  if (x < 0 || c[2] > limit) return null;
  while (x >= 0 && !dark(x) && c[1] <= maxCount) {
    c[1]++;
    x--;
  }
  if (x < 0 || c[1] > maxCount) return null;
  while (x >= 0 && dark(x) && c[0] <= maxCount) {
    c[0]++;
    x--;
  }
  if (c[0] > maxCount) return null;

  x = startX + 1;
  while (x < width && dark(x) && c[2] <= limit) {
    c[2]++;
    x++;
  }
  if (x === width || c[2] > limit) return null;
  while (x < width && !dark(x) && c[3] < maxCount) {
    c[3]++;
    x++;
  }
  if (x === width || c[3] >= maxCount) return null;
  while (x < width && dark(x) && c[4] < maxCount) {
    c[4]++;
    x++;
  }
  if (c[4] >= maxCount) return null;

  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (5 * Math.abs(total - originalTotal) >= 2 * originalTotal) return null;
  return matchesRatio(c) ? centerFromEnd(c, x) : null;
}

/**
 * @typedef {Object} FinderCandidate
 * @property {number} x           centre, in pixels (pixel i spans [i, i + 1))
 * @property {number} y
 * @property {number} moduleSize  estimated pixels per module
 * @property {number} count       how many scan rows confirmed this centre
 */

/**
 * Find finder pattern candidates in a bitmap.
 *
 * @param {{ width: number, height: number, bits: Uint8Array }} bitmap
 * @returns {FinderCandidate[]} sorted by count (most confirmed first), at most MAX_CANDIDATES
 */
export function findFinderPatterns(bitmap) {
  const { width, height, bits } = bitmap;
  const candidates = [];
  const counts = [0, 0, 0, 0, 0];

  const handle = (y, endX) => {
    const total = counts[0] + counts[1] + counts[2] + counts[3] + counts[4];
    const centerX = centerFromEnd(counts, endX);
    const centerY = crossCheckVertical(bitmap, Math.floor(centerX), y, counts[2], total);
    if (centerY === null) return;
    const refinedX = crossCheckHorizontal(bitmap, Math.floor(centerX), Math.floor(centerY), counts[2], total);
    if (refinedX === null) return;
    const moduleSize = total / 7;
    for (const c of candidates) {
      const near = Math.abs(c.x - refinedX) <= c.moduleSize && Math.abs(c.y - centerY) <= c.moduleSize;
      const sizeDiff = Math.abs(c.moduleSize - moduleSize);
      if (near && (sizeDiff <= 1 || sizeDiff <= c.moduleSize)) {
        const n = c.count + 1;
        c.x = (c.x * c.count + refinedX) / n;
        c.y = (c.y * c.count + centerY) / n;
        c.moduleSize = (c.moduleSize * c.count + moduleSize) / n;
        c.count = n;
        return;
      }
    }
    if (candidates.length < MAX_CANDIDATES) candidates.push({ x: refinedX, y: centerY, moduleSize, count: 1 });
  };

  for (let y = 0; y < height; y++) {
    counts.fill(0);
    let state = 0;
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (bits[row + x] === 1) {
        if (state & 1) state++; // light -> dark
        counts[state]++;
      } else if ((state & 1) === 0) {
        // dark -> light
        if (state === 4) {
          if (matchesRatio(counts)) handle(y, x);
          counts[0] = counts[2];
          counts[1] = counts[3];
          counts[2] = counts[4];
          counts[3] = 1;
          counts[4] = 0;
          state = 3;
        } else {
          state++;
          counts[state]++;
        }
      } else {
        counts[state]++;
      }
    }
    if (state === 4 && matchesRatio(counts)) handle(y, width);
  }

  return candidates.sort((a, b) => b.count - a.count || b.moduleSize - a.moduleSize);
}

/**
 * @typedef {Object} FinderTriple
 * @property {FinderCandidate} topLeft
 * @property {FinderCandidate} topRight
 * @property {FinderCandidate} bottomLeft
 * @property {number} moduleSize     mean of the three estimates
 * @property {number} modulesAcross  estimated symbol width in modules (before snapping to a version)
 * @property {number} score          lower is better
 * @property {boolean} confident     a clean right-isosceles triangle of confirmed candidates that fits a version
 */

/**
 * Combine candidates into plausible symbols: three centres forming a right
 * isosceles triangle with a right angle at the top-left pattern, similar
 * module sizes, and a side length that corresponds to some version. Only
 * the best MAX_TRIPLE_SOURCES candidates are combined (at most 560 triples).
 *
 * @param {FinderCandidate[]} candidates  as returned by findFinderPatterns
 * @returns {FinderTriple[]} best first
 */
export function rankTriples(candidates) {
  const top = candidates.slice(0, MAX_TRIPLE_SOURCES);
  const triples = [];
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      for (let k = j + 1; k < top.length; k++) {
        const triple = evaluateTriple(top[i], top[j], top[k]);
        if (triple) triples.push(triple);
      }
    }
  }
  return triples.sort((a, b) => a.score - b.score);
}

function evaluateTriple(a, b, c) {
  const sizes = [a.moduleSize, b.moduleSize, c.moduleSize];
  if (Math.max(...sizes) > 1.6 * Math.min(...sizes)) return null;

  // The top-left pattern is the vertex with the angle closest to 90 degrees.
  let best = null;
  for (const [p, q, r] of [
    [a, b, c],
    [b, a, c],
    [c, a, b],
  ]) {
    const v1 = { x: q.x - p.x, y: q.y - p.y };
    const v2 = { x: r.x - p.x, y: r.y - p.y };
    const l1 = Math.hypot(v1.x, v1.y);
    const l2 = Math.hypot(v2.x, v2.y);
    if (l1 === 0 || l2 === 0) return null;
    const cos = Math.abs((v1.x * v2.x + v1.y * v2.y) / (l1 * l2));
    if (best === null || cos < best.cos) best = { p, q, r, v1, v2, l1, l2, cos };
  }
  if (best.cos > 0.25) return null;

  const { p, q, r, v1, v2, l1, l2, cos } = best;
  const mismatch = Math.abs(l1 - l2) / Math.max(l1, l2);
  if (mismatch > 0.25) return null;

  const moduleSize = (sizes[0] + sizes[1] + sizes[2]) / 3;
  const modulesAcross = (l1 + l2) / 2 / moduleSize + 7;
  if (modulesAcross < 17 || modulesAcross > 181) return null;
  const version = Math.min(40, Math.max(1, Math.round((modulesAcross - 17) / 4)));
  const deviation = Math.abs(modulesAcross - (17 + 4 * version));
  const minCount = Math.min(a.count, b.count, c.count);

  // Orientation: in image coordinates (y down) an unmirrored symbol has a
  // positive cross product from top-left->top-right to top-left->bottom-left.
  const cross = v1.x * v2.y - v1.y * v2.x;
  const [topRight, bottomLeft] = cross > 0 ? [q, r] : [r, q];
  const score = cos * 10 + mismatch * 10 + deviation / 2 + 1 / a.count + 1 / b.count + 1 / c.count;
  const confident = cos < 0.1 && mismatch < 0.1 && deviation < 2 && minCount >= 2;
  return { topLeft: p, topRight, bottomLeft, moduleSize, modulesAcross, score, confident };
}
