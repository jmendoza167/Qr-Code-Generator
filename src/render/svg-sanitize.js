/**
 * Sanitize an SVG logo before inlining it into our own SVG output. Pure JS.
 *
 * An SVG file is a programme as much as a picture: it can carry scripts,
 * event handlers and references to remote resources. Inlining one into the
 * QR code's SVG would hand all of that to whoever opens the file, so we
 * strip:
 *   - <script> elements and on* event attributes,
 *   - <foreignObject> (arbitrary HTML),
 *   - href / xlink:href that are not "#fragment" or "data:image/..." URIs,
 *   - url(...) references that are not "#fragment", and CSS @import.
 * The XML prolog, doctype and comments are dropped too; the root <svg>
 * element is replaced by one we write ourselves (see embedSvgLogo).
 *
 * This is a deliberately simple, regex-based filter aimed at logo files,
 * not a general-purpose HTML sanitizer.
 */

const fmt = (n) => String(Number(n.toFixed(3)));

/**
 * @param {string} markup  the SVG file contents
 * @returns {{ inner: string, viewBox: number[], aspect: number }}
 */
export function sanitizeSvg(markup) {
  if (typeof markup !== 'string') throw new RangeError('The logo is not an SVG document');
  const stripped = markup
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const root = /^<svg\b([^>]*)>([\s\S]*)<\/svg\s*>$/i.exec(stripped);
  if (!root) throw new RangeError('The logo is not an SVG document (no <svg> root element)');
  const rootAttributes = root[1];

  let inner = root[2];
  inner = inner.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<script\b[^>]*\/>/gi, '');
  inner = inner.replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '');
  inner = inner.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  inner = inner.replace(/\s+(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (match, dq, sq) => {
    const value = (dq ?? sq).trim();
    return /^(#|data:image\/)/i.test(value) ? match : '';
  });
  inner = inner.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none');
  inner = inner.replace(/@import[^;]*;?/gi, '');

  const viewBox = readViewBox(rootAttributes);
  return { inner: inner.trim(), viewBox, aspect: viewBox[2] / viewBox[3] };
}

function readViewBox(attributes) {
  const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(attributes);
  if (vb) {
    const parts = vb[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) return parts;
  }
  const width = parseFloat(/\bwidth\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]);
  const height = parseFloat(/\bheight\s*=\s*["']([^"']+)["']/i.exec(attributes)?.[1]);
  if (width > 0 && height > 0) return [0, 0, width, height];
  return [0, 0, 100, 100];
}

/**
 * Sanitize and wrap the logo in a nested <svg> placed at `box` (user units
 * of the outer document), letter-boxed to keep its aspect ratio.
 */
export function embedSvgLogo(markup, box) {
  const { inner, viewBox } = sanitizeSvg(markup);
  return (
    `<svg x="${fmt(box.x)}" y="${fmt(box.y)}" width="${fmt(box.w)}" height="${fmt(box.h)}" ` +
    `viewBox="${viewBox.join(' ')}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`
  );
}
