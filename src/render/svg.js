/**
 * SVG renderer. Pure string output, no Node APIs, so the website can reuse
 * it as-is.
 *
 * The viewBox is in module units (one module = one unit) and the margin is
 * baked into the coordinates, so `scale` only decides the nominal pixel
 * size in the width/height attributes. All dark modules go into a single
 * <path>; horizontal runs are merged into one "M x y h<run> v1 h-<run> z"
 * command each, which keeps files small for large symbols.
 */
import { parseColor, checkRenderOptions } from './color.js';

/**
 * @param {boolean[][]} matrix
 * @param {Object} [options]
 * @param {number} [options.scale=10]    pixels per module (width/height attributes)
 * @param {number} [options.margin=4]    quiet zone in modules
 * @param {string} [options.fg='#000000'] colour of dark modules
 * @param {string} [options.bg='#ffffff'] background colour
 * @returns {string}
 */
export function renderSvg(matrix, { scale = 10, margin = 4, fg = '#000000', bg = '#ffffff' } = {}) {
  checkRenderOptions({ scale, margin });
  const foreground = parseColor(fg).hex;
  const background = parseColor(bg).hex;
  const height = matrix.length;
  const width = matrix[0].length;
  const totalRows = height + 2 * margin;
  const totalCols = width + 2 * margin;

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

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalCols * scale}" height="${totalRows * scale}" viewBox="0 0 ${totalCols} ${totalRows}" shape-rendering="crispEdges">`,
    `  <rect width="${totalCols}" height="${totalRows}" fill="${background}"/>`,
    `  <path fill="${foreground}" d="${commands.join('')}"/>`,
    `</svg>`,
    ``,
  ].join('\n');
}
