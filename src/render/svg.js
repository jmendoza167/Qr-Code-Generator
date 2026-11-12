/**
 * SVG renderer. Pure string output, no Node APIs, so the website can reuse
 * it as-is.
 *
 * The viewBox is in module units (one module = one unit) and the margin is
 * baked into the coordinates, so `scale` only decides the nominal pixel
 * size in the width/height attributes.
 *
 * Two code paths:
 *   - plain (square modules, square finders, one colour): all dark modules
 *     in a single <path> of merged horizontal runs, rendered with crisp
 *     edges. This output is byte-for-byte what v1 produced.
 *   - styled: primitives from style.js, drawn as one data path and one
 *     finder path (even-odd so the finder frames have holes), with an
 *     optional gradient definition.
 */
import { parseColor, checkRenderOptions } from './color.js';
import { normalizeStyle, buildShapes, gradientBox } from './style.js';
import { encodeBase64 } from './base64.js';
import { embedSvgLogo } from './svg-sanitize.js';

/** Format a coordinate: at most 3 decimals, no trailing zeros. */
const fmt = (n) => String(Number(n.toFixed(3)));

/**
 * @param {boolean[][]} matrix
 * @param {Object} [options]
 * @param {number} [options.scale=10]    pixels per module (width/height attributes)
 * @param {number} [options.margin=4]    quiet zone in modules
 * @param {string} [options.fg='#000000'] colour of dark modules
 * @param {string} [options.bg='#ffffff'] background colour
 * @param {string} [options.shape]       'square' | 'rounded' | 'dots'
 * @param {string} [options.finder]      'square' | 'rounded' | 'circle'
 * @param {string} [options.finderColor] separate colour for the finder patterns
 * @param {string|string[]} [options.gradient]  "hex1,hex2" for the dark modules
 * @param {string} [options.gradientDir] 'horizontal' | 'vertical' | 'diagonal' | 'radial'
 * @returns {string}
 */
export function renderSvg(matrix, options = {}) {
  const { scale = 10, margin = 4, fg, bg, shape, finder, finderColor, gradient, gradientDir, logo } = options;
  checkRenderOptions({ scale, margin });
  const style = normalizeStyle({ shape, finder, finderColor, gradient, gradientDir, fg, bg });
  if (logo && !logo.png && !logo.svg) throw new RangeError('logo needs either png bytes or svg markup');
  return style.isPlain && !logo
    ? renderPlain(matrix, scale, margin, style)
    : renderStyled(matrix, scale, margin, style, logo);
}

/**
 * Markup for the logo: an optional background rect over the cleared area,
 * then the image (PNG bytes as a data URI, or sanitized inline SVG).
 * `box` and `area` come from planLogo() and are in module units.
 */
function logoMarkup(logo, margin) {
  const lines = [];
  if (logo.bg) {
    const { row, col, rows, cols } = logo.area;
    lines.push(`  <rect x="${col + margin}" y="${row + margin}" width="${cols}" height="${rows}" fill="${parseColor(logo.bg).hex}"/>`);
  }
  const box = { x: logo.box.x + margin, y: logo.box.y + margin, w: logo.box.w, h: logo.box.h };
  if (logo.png) {
    lines.push(
      `  <image href="data:image/png;base64,${encodeBase64(logo.png)}" x="${fmt(box.x)}" y="${fmt(box.y)}" ` +
        `width="${fmt(box.w)}" height="${fmt(box.h)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  } else {
    lines.push(`  ${embedSvgLogo(logo.svg, box)}`);
  }
  return lines;
}

function header(matrix, scale, margin, crisp) {
  const height = matrix.length;
  const width = matrix[0].length;
  const totalRows = height + 2 * margin;
  const totalCols = width + 2 * margin;
  const rendering = crisp ? ' shape-rendering="crispEdges"' : '';
  return {
    open: `<svg xmlns="http://www.w3.org/2000/svg" width="${totalCols * scale}" height="${totalRows * scale}" viewBox="0 0 ${totalCols} ${totalRows}"${rendering}>`,
    background: (fill) => `  <rect width="${totalCols}" height="${totalRows}" fill="${fill}"/>`,
  };
}

function renderPlain(matrix, scale, margin, style) {
  const height = matrix.length;
  const width = matrix[0].length;
  const commands = [];
  for (let row = 0; row < height; row++) {
    let col = 0;
    while (col < width) {
      if (!matrix[row][col]) {
        col++;
        continue;
      }
      let run = 1;
      while (col + run < width && matrix[row][col + run]) run++;
      commands.push(`M${col + margin} ${row + margin}h${run}v1h-${run}z`);
      col += run;
    }
  }
  const { open, background } = header(matrix, scale, margin, true);
  return [open, background(style.bg), `  <path fill="${style.fg}" d="${commands.join('')}"/>`, `</svg>`, ``].join('\n');
}

function renderStyled(matrix, scale, margin, style, logo) {
  const shapes = buildShapes(matrix, style);
  const dataPath = shapes
    .filter((s) => s.role === 'data')
    .map((s) => shapePath(s, margin))
    .join('');
  const finderPath = shapes
    .filter((s) => s.role === 'finder')
    .map((s) => shapePath(s, margin))
    .join('');

  const dataFill = style.gradient ? 'url(#qr-gradient)' : style.fg;
  const finderFill = style.finderColor ?? dataFill;
  const crisp = style.shape === 'square' && style.finder === 'square';
  const { open, background } = header(matrix, scale, margin, crisp);

  const lines = [open];
  if (style.gradient) lines.push(gradientDefs(style.gradient, gradientBox(matrix.length, margin)));
  lines.push(background(style.bg));
  lines.push(`  <path fill="${dataFill}" d="${dataPath}"/>`);
  if (finderPath) lines.push(`  <path fill="${finderFill}" fill-rule="evenodd" d="${finderPath}"/>`);
  if (logo) lines.push(...logoMarkup(logo, margin));
  lines.push(`</svg>`, ``);
  return lines.join('\n');
}

/** <defs> with a linear or radial gradient in user-space (module) units. */
function gradientDefs(gradient, box) {
  const stops = `<stop offset="0" stop-color="${gradient.from}"/><stop offset="1" stop-color="${gradient.to}"/>`;
  const x2 = box.x + box.w;
  const y2 = box.y + box.h;
  let element;
  switch (gradient.direction) {
    case 'horizontal':
      element = `<linearGradient id="qr-gradient" gradientUnits="userSpaceOnUse" x1="${fmt(box.x)}" y1="${fmt(box.y)}" x2="${fmt(x2)}" y2="${fmt(box.y)}">`;
      break;
    case 'vertical':
      element = `<linearGradient id="qr-gradient" gradientUnits="userSpaceOnUse" x1="${fmt(box.x)}" y1="${fmt(box.y)}" x2="${fmt(box.x)}" y2="${fmt(y2)}">`;
      break;
    case 'diagonal':
      element = `<linearGradient id="qr-gradient" gradientUnits="userSpaceOnUse" x1="${fmt(box.x)}" y1="${fmt(box.y)}" x2="${fmt(x2)}" y2="${fmt(y2)}">`;
      break;
    default: {
      const r = Math.hypot(box.w, box.h) / 2; // reaches the corners
      element = `<radialGradient id="qr-gradient" gradientUnits="userSpaceOnUse" cx="${fmt(box.x + box.w / 2)}" cy="${fmt(box.y + box.h / 2)}" r="${fmt(r)}">`;
    }
  }
  const closing = gradient.direction === 'radial' ? '</radialGradient>' : '</linearGradient>';
  return `  <defs>${element}${stops}${closing}</defs>`;
}

/** SVG path data for one primitive, offset by the margin. */
export function shapePath(shape, offset) {
  switch (shape.kind) {
    case 'rect':
      return `M${fmt(shape.x + offset)} ${fmt(shape.y + offset)}h${fmt(shape.w)}v${fmt(shape.h)}h-${fmt(shape.w)}z`;
    case 'circle': {
      const { cx, cy, r } = shape;
      return `M${fmt(cx - r + offset)} ${fmt(cy + offset)}a${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0a${fmt(r)} ${fmt(r)} 0 1 0 -${fmt(2 * r)} 0z`;
    }
    case 'roundedRect': {
      const [tl, tr, br, bl] = shape.radii;
      const x = shape.x + offset;
      const y = shape.y + offset;
      const { w, h } = shape;
      const h_ = (d) => (d === 0 ? '' : `h${fmt(d)}`);
      const v_ = (d) => (d === 0 ? '' : `v${fmt(d)}`);
      const arc = (r, dx, dy) => (r === 0 ? '' : `a${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(dx)} ${fmt(dy)}`);
      return (
        `M${fmt(x + tl)} ${fmt(y)}` +
        h_(w - tl - tr) +
        arc(tr, tr, tr) +
        v_(h - tr - br) +
        arc(br, -br, br) +
        h_(-(w - br - bl)) +
        arc(bl, -bl, -bl) +
        v_(-(h - bl - tl)) +
        arc(tl, tl, -tl) +
        'z'
      );
    }
    case 'ring':
      return shapePath(shape.outer, offset) + shapePath(shape.inner, offset);
    default:
      throw new RangeError(`unknown shape kind ${shape.kind}`);
  }
}

export { parseColor };
