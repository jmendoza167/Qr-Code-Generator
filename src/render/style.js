/**
 * Visual styles shared by the SVG and PNG renderers. Pure JS, no Node APIs,
 * so the website can reuse every bit of it.
 *
 * The renderers never look at the matrix themselves when a style is
 * active: buildShapes() turns the matrix into a list of geometric
 * primitives in *module units* (one module = 1.0, origin at the symbol's
 * top-left corner, margin not included), and the renderers only have to
 * draw rectangles, circles and rounded rectangles. That is what keeps the
 * two outputs identical.
 *
 * Primitives:
 *   { kind: 'rect',        x, y, w, h,          role }
 *   { kind: 'circle',      cx, cy, r,           role }
 *   { kind: 'roundedRect', x, y, w, h, radii,   role }   radii = [tl, tr, br, bl]
 *   { kind: 'ring',        outer, inner,        role }   outer minus inner (finder frame)
 * role is 'data' (fg or gradient) or 'finder' (finder colour, if any).
 */
import { parseColor } from './color.js';
import { ALIGNMENT_POSITIONS } from '../core/tables.js';

export const SHAPES = ['square', 'rounded', 'dots'];
export const FINDER_STYLES = ['square', 'rounded', 'circle'];
export const GRADIENT_DIRECTIONS = ['horizontal', 'vertical', 'diagonal', 'radial'];

/** Radius of a "dots" module (diameter 0.9 leaves a visible gap). */
export const DOT_RADIUS = 0.45;
/** Corner radius of "rounded" modules: half a module, so a lone module is a circle. */
export const CORNER_RADIUS = 0.5;

function oneOf(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new RangeError(`${name} must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`);
  }
  return value;
}

function parseGradient(input, direction) {
  if (input === undefined || input === null || input === '') return null;
  let parts;
  if (typeof input === 'string') parts = input.split(',').map((s) => s.trim());
  else if (Array.isArray(input)) parts = input;
  else if (typeof input === 'object') parts = [input.from, input.to];
  if (!parts || parts.length !== 2) {
    throw new RangeError(`gradient expects two hex colours separated by a comma, like "#ff0000,#0000ff", got ${JSON.stringify(input)}`);
  }
  return {
    from: parseColor(parts[0]).hex,
    to: parseColor(parts[1]).hex,
    direction: oneOf('gradient direction', direction, GRADIENT_DIRECTIONS),
  };
}

/**
 * Validate and normalise style options.
 * `isPlain` is true when the geometry is the classic one (square modules,
 * square finders, single colour): renderers then take their fast paths.
 */
export function normalizeStyle({
  shape = 'square',
  finder = 'square',
  finderColor,
  gradient,
  gradientDir = 'diagonal',
  fg = '#000000',
  bg = '#ffffff',
} = {}) {
  const style = {
    shape: oneOf('shape', shape, SHAPES),
    finder: oneOf('finder style', finder, FINDER_STYLES),
    finderColor: finderColor === undefined || finderColor === null || finderColor === '' ? null : parseColor(finderColor).hex,
    gradient: parseGradient(gradient, gradientDir),
    fg: parseColor(fg).hex,
    bg: parseColor(bg).hex,
  };
  style.isPlain = style.shape === 'square' && style.finder === 'square' && !style.finderColor && !style.gradient;
  return style;
}

/** Is (row, col) inside one of the three 7x7 finder patterns? */
export function isFinderModule(size, row, col) {
  if (size < 21) return false; // not a real symbol (tiny test matrices)
  const near = (v) => v < 7;
  const far = (v) => v >= size - 7;
  return (near(row) && near(col)) || (near(row) && far(col)) || (far(row) && near(col));
}

/**
 * Convert a matrix into drawing primitives for the given style.
 * Primitives never overlap each other, which lets the PNG rasterizer add
 * up per-shape coverage without seams or double counting.
 */
export function buildShapes(matrix, style) {
  const height = matrix.length;
  const width = matrix[0].length;
  const size = height;
  const alignmentCentres = size >= 21 && (size - 17) % 4 === 0 ? getAlignmentCentres(size) : [];
  const inAlignment = (r, c) => alignmentCentres.some(([ar, ac]) => Math.abs(r - ar) <= 2 && Math.abs(c - ac) <= 2);
  const dark = (r, c) =>
    r >= 0 && r < height && c >= 0 && c < width && matrix[r][c] && !isFinderModule(size, r, c) && !inAlignment(r, c);
  const shapes = [];

  for (let r = 0; r < height; r++) {
    let c = 0;
    while (c < width) {
      if (!dark(r, c)) {
        c++;
        continue;
      }
      let end = c;
      while (end + 1 < width && dark(r, end + 1)) end++;
      pushRun(shapes, matrix, style.shape, dark, r, c, end);
      c = end + 1;
    }
  }

  // Alignment patterns are kept solid (in the finder style, data colour):
  // scanners locate them to correct perspective, and a 5x5 pattern made of
  // loose dots is easy to miss.
  for (const [r, c] of alignmentCentres) pushConcentric(shapes, style.finder, r - 2, c - 2, 5, 'data');

  if (size >= 21) {
    for (const [r0, c0] of [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ]) {
      pushConcentric(shapes, style.finder, r0, c0, 7, 'finder');
    }
  }
  return shapes;
}

/** Centres (row, col) of the alignment patterns of a symbol of this size. */
export function getAlignmentCentres(size) {
  const version = (size - 17) / 4;
  const positions = ALIGNMENT_POSITIONS[version] ?? [];
  const first = positions[0];
  const last = positions[positions.length - 1];
  const centres = [];
  for (const r of positions) {
    for (const c of positions) {
      const overlapsFinder = (r === first && c === first) || (r === first && c === last) || (r === last && c === first);
      if (!overlapsFinder) centres.push([r, c]);
    }
  }
  return centres;
}

/** Emit the primitives for one horizontal run of dark data modules. */
function pushRun(shapes, matrix, shape, dark, r, start, end) {
  if (shape === 'square') {
    shapes.push({ kind: 'rect', x: start, y: r, w: end - start + 1, h: 1, role: 'data' });
    return;
  }
  if (shape === 'dots') {
    for (let c = start; c <= end; c++) shapes.push({ kind: 'circle', cx: c + 0.5, cy: r + 0.5, r: DOT_RADIUS, role: 'data' });
    return;
  }
  // rounded: a corner is rounded only when it is a convex corner of the
  // connected group, i.e. both neighbours that touch that corner are light.
  // Modules in the middle of a run have dark left and right neighbours, so
  // they can never be rounded; they are merged into one plain rect.
  let pending = null; // run of fully square modules being merged
  const flush = () => {
    if (pending) shapes.push(pending);
    pending = null;
  };
  for (let c = start; c <= end; c++) {
    const up = dark(r - 1, c);
    const down = dark(r + 1, c);
    const left = dark(r, c - 1);
    const right = dark(r, c + 1);
    const R = CORNER_RADIUS;
    const radii = [!up && !left ? R : 0, !up && !right ? R : 0, !down && !right ? R : 0, !down && !left ? R : 0];
    if (radii.some((v) => v > 0)) {
      flush();
      shapes.push({ kind: 'roundedRect', x: c, y: r, w: 1, h: 1, radii, role: 'data' });
    } else if (pending) {
      pending.w++;
    } else {
      pending = { kind: 'rect', x: c, y: r, w: 1, h: 1, role: 'data' };
    }
  }
  flush();
}

/**
 * A concentric pattern of `size` modules (7 for finders, 5 for alignment
 * patterns): an outer frame one module thick (a ring around the hole), and
 * a centre square `size - 4` wide. Drawn in the finder style.
 */
function pushConcentric(shapes, finderStyle, r0, c0, size, role) {
  const box = (inset, s) => ({ x: c0 + inset, y: r0 + inset, w: s, h: s });
  const half = size / 2;
  let outer;
  let inner;
  let centre;
  if (finderStyle === 'square') {
    outer = { kind: 'rect', ...box(0, size) };
    inner = { kind: 'rect', ...box(1, size - 2) };
    centre = { kind: 'rect', ...box(2, size - 4) };
  } else if (finderStyle === 'rounded') {
    // Radii scale with the square so the three shapes look concentric.
    const rounded = (inset, s) => ({ kind: 'roundedRect', ...box(inset, s), radii: new Array(4).fill((s * 2) / 7) });
    outer = rounded(0, size);
    inner = rounded(1, size - 2);
    centre = rounded(2, size - 4);
  } else {
    const circle = (r) => ({ kind: 'circle', cx: c0 + half, cy: r0 + half, r });
    outer = circle(half);
    inner = circle(half - 1);
    centre = circle(half - 2);
  }
  shapes.push({ kind: 'ring', outer, inner, role });
  shapes.push({ ...centre, role });
}

/** Point-in-primitive test in module units (used by the PNG rasterizer). */
export function pointInShape(shape, x, y) {
  switch (shape.kind) {
    case 'rect':
      return x >= shape.x && x < shape.x + shape.w && y >= shape.y && y < shape.y + shape.h;
    case 'circle': {
      const dx = x - shape.cx;
      const dy = y - shape.cy;
      return dx * dx + dy * dy <= shape.r * shape.r;
    }
    case 'roundedRect': {
      if (!(x >= shape.x && x < shape.x + shape.w && y >= shape.y && y < shape.y + shape.h)) return false;
      const [tl, tr, br, bl] = shape.radii;
      const lx = x - shape.x;
      const ly = y - shape.y;
      const rx = shape.x + shape.w - x;
      const ry = shape.y + shape.h - y;
      // Inside the square; only the four corner regions can be outside.
      const outsideCorner = (r, cx, cy) => r > 0 && cx < r && cy < r && (r - cx) ** 2 + (r - cy) ** 2 > r * r;
      return !(outsideCorner(tl, lx, ly) || outsideCorner(tr, rx, ly) || outsideCorner(br, rx, ry) || outsideCorner(bl, lx, ry));
    }
    case 'ring':
      return pointInShape(shape.outer, x, y) && !pointInShape(shape.inner, x, y);
    default:
      throw new RangeError(`unknown shape kind ${shape.kind}`);
  }
}

/** Bounding box { x, y, w, h } of a primitive in module units. */
export function shapeBounds(shape) {
  switch (shape.kind) {
    case 'rect':
    case 'roundedRect':
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case 'circle':
      return { x: shape.cx - shape.r, y: shape.cy - shape.r, w: 2 * shape.r, h: 2 * shape.r };
    case 'ring':
      return shapeBounds(shape.outer);
    default:
      throw new RangeError(`unknown shape kind ${shape.kind}`);
  }
}

// ---------------------------------------------------------------------------
// Colour helpers: gradients and contrast.

/** The box a gradient spans: the symbol itself, margin excluded. */
export function gradientBox(size, margin) {
  return { x: margin, y: margin, w: size, h: size };
}

/** Position 0..1 along the gradient for a point (module units). */
export function gradientT(direction, x, y, box) {
  let t;
  switch (direction) {
    case 'horizontal':
      t = (x - box.x) / box.w;
      break;
    case 'vertical':
      t = (y - box.y) / box.h;
      break;
    case 'diagonal':
      t = (x - box.x + (y - box.y)) / (box.w + box.h);
      break;
    case 'radial': {
      const dx = x - (box.x + box.w / 2);
      const dy = y - (box.y + box.h / 2);
      t = Math.hypot(dx, dy) / (Math.hypot(box.w, box.h) / 2);
      break;
    }
    default:
      throw new RangeError(`unknown gradient direction ${direction}`);
  }
  return Math.min(1, Math.max(0, t));
}

/** Linear interpolation between the two stops. */
export function gradientColor(gradient, t) {
  const a = parseColor(gradient.from);
  const b = parseColor(gradient.to);
  const mix = (p, q) => Math.round(p + (q - p) * t);
  return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b) };
}

/** Relative luminance as defined by WCAG 2. */
export function relativeLuminance(hex) {
  const { r, g, b } = parseColor(hex);
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Below this ratio scanners start to struggle. */
export const MIN_CONTRAST = 3;

/**
 * Human-readable warnings (never errors) about colour choices: too little
 * contrast, or "dark" colours that are lighter than the background, which
 * produces an inverted code that some scanners refuse.
 */
export function checkContrast(style) {
  const darks = style.gradient
    ? [
        ['gradient start colour', style.gradient.from],
        ['gradient end colour', style.gradient.to],
      ]
    : [['foreground colour', style.fg]];
  if (style.finderColor) darks.push(['finder colour', style.finderColor]);

  const warnings = [];
  const bgLum = relativeLuminance(style.bg);
  for (const [label, hex] of darks) {
    if (relativeLuminance(hex) > bgLum) {
      warnings.push(
        `The ${label} ${hex} is lighter than the background ${style.bg}: the code is inverted and some scanners refuse those`,
      );
    }
    const ratio = contrastRatio(hex, style.bg);
    if (ratio < MIN_CONTRAST) {
      warnings.push(
        `Low contrast between the ${label} ${hex} and the background ${style.bg} (${ratio.toFixed(1)}:1); scanners may fail. Aim for 4:1 or more`,
      );
    }
  }
  return warnings;
}
