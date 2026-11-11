/**
 * Tiny colour parser shared by the SVG and PNG renderers. Browser-safe.
 * Accepts "#rrggbb", "#rgb", "rrggbb" or "rgb" in any case.
 *
 * @returns {{ r: number, g: number, b: number, hex: string }} hex is normalised to "#rrggbb"
 */
export function parseColor(input) {
  const match = typeof input === 'string' && /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!match) {
    throw new RangeError(`Expected a hex colour like #rrggbb or #rgb, got ${JSON.stringify(input)}`);
  }
  let digits = match[1].toLowerCase();
  if (digits.length === 3) digits = [...digits].map((d) => d + d).join('');
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
    hex: `#${digits}`,
  };
}

/** Validation shared by every renderer. */
export function checkRenderOptions({ scale, margin }) {
  if (scale !== undefined && (!Number.isInteger(scale) || scale < 1)) {
    throw new RangeError(`scale must be a positive integer, got ${scale}`);
  }
  if (margin !== undefined && (!Number.isInteger(margin) || margin < 0)) {
    throw new RangeError(`margin must be a non-negative integer, got ${margin}`);
  }
}
