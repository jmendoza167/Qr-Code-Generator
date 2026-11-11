/**
 * Terminal renderer. Browser-safe (pure string output), although it is
 * obviously meant for a monospace terminal.
 *
 * Half-block mode packs two module rows into one text row using the
 * Unicode block characters: ▀ (upper half), ▄ (lower half), █ (full) and a
 * space. Because a terminal cell is roughly twice as tall as it is wide,
 * this keeps the modules close to square.
 *
 * ASCII mode uses "##" and "  " (two characters per module, one text row
 * per module row) for terminals that do not render block characters well.
 *
 * `invert` swaps dark and light. The default draws dark modules with the
 * foreground colour, which is right for light terminal themes; on a dark
 * theme the result is an inverted (light-on-dark) code that most scanners
 * still read, and `invert` fixes it for the ones that do not.
 */
import { checkRenderOptions } from './color.js';

const HALF_BLOCKS = {
  '00': ' ',
  '10': '▀', // top dark
  '01': '▄', // bottom dark
  '11': '█',
};

/**
 * @param {boolean[][]} matrix
 * @param {Object} [options]
 * @param {number} [options.margin=4]   quiet zone in modules
 * @param {boolean} [options.ascii=false]
 * @param {boolean} [options.invert=false]
 * @returns {string} lines joined with "\n", no trailing newline
 */
export function renderTerminal(matrix, { margin = 4, ascii = false, invert = false } = {}) {
  checkRenderOptions({ margin });
  const height = matrix.length;
  const width = matrix[0].length;
  const totalRows = height + 2 * margin;
  const totalCols = width + 2 * margin;

  // Colour of any cell of the padded grid; everything outside the symbol
  // (quiet zone and the odd padding row at the bottom) is light.
  const isDark = (row, col) => {
    const r = row - margin;
    const c = col - margin;
    const inside = r >= 0 && r < height && c >= 0 && c < width;
    return (inside && matrix[r][c]) !== invert;
  };

  const lines = [];
  if (ascii) {
    for (let row = 0; row < totalRows; row++) {
      let line = '';
      for (let col = 0; col < totalCols; col++) line += isDark(row, col) ? '##' : '  ';
      lines.push(line);
    }
  } else {
    for (let row = 0; row < totalRows; row += 2) {
      let line = '';
      for (let col = 0; col < totalCols; col++) {
        const top = isDark(row, col) ? '1' : '0';
        const bottom = isDark(row + 1, col) ? '1' : '0';
        line += HALF_BLOCKS[top + bottom];
      }
      lines.push(line);
    }
  }
  return lines.join('\n');
}
