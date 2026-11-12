/**
 * PNG renderer (Node only: uses the built-in zlib for compression).
 *
 * A PNG file is an 8-byte signature followed by chunks. Each chunk is
 *
 *     length (4 bytes, big-endian) | type (4 ASCII bytes) | data | CRC32 of type + data
 *
 * Two encodings are produced:
 *   - plain black/white (or any two flat colours) with square modules:
 *     1 bit per pixel with a 2-entry palette (IHDR, PLTE, IDAT, IEND). A
 *     177-module version 40 at scale 10 is 1850 x 1850 pixels but only
 *     ~430 KB before deflate, and far less after it. This is v1's output.
 *   - styled (rounded/dots modules, finder styles, gradients, logos):
 *     8-bit RGBA truecolour, rasterized with supersampling so curves are
 *     anti-aliased.
 * Every scanline is prefixed with a filter-type byte; we use filter 0
 * ("none") everywhere because deflate already compresses the repetitive
 * rows extremely well.
 */
import { deflateSync } from 'node:zlib';
import { parseColor, checkRenderOptions } from './color.js';
import { normalizeStyle, buildShapes, shapeBounds, pointInShape, gradientBox, gradientT } from './style.js';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * CRC-32 (IEEE 802.3, the one used by PNG, gzip and zip), table-driven.
 *
 * The table holds, for every possible byte, the result of shifting that
 * byte through the polynomial 0xEDB88320 (0x04C11DB7 bit-reversed, because
 * PNG's CRC processes bits least-significant first). The running CRC starts
 * at all ones and is inverted at the end, as the spec requires.
 */
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/** @param {Uint8Array} bytes @returns {number} unsigned 32-bit CRC */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(typeAndData.length + 8);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4);
  return out;
}

/** IHDR: width, height, bit depth, colour type, compression 0, filter 0, interlace 0. */
function ihdrChunk(width, height, bitDepth, colorType) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  return chunk('IHDR', ihdr);
}

/**
 * @param {boolean[][]} matrix
 * @param {Object} [options]
 * @param {number} [options.scale=10]     pixels per module
 * @param {number} [options.margin=4]     quiet zone in modules
 * @param {string} [options.fg='#000000'] colour of dark modules
 * @param {string} [options.bg='#ffffff'] background colour
 * @param {string} [options.shape]        'square' | 'rounded' | 'dots'
 * @param {string} [options.finder]       'square' | 'rounded' | 'circle'
 * @param {string} [options.finderColor]  separate colour for the finder patterns
 * @param {string|string[]} [options.gradient]  "hex1,hex2" for the dark modules
 * @param {string} [options.gradientDir]  'horizontal' | 'vertical' | 'diagonal' | 'radial'
 * @returns {Buffer} the PNG file contents
 */
export function renderPng(matrix, options = {}) {
  const { scale = 10, margin = 4, fg, bg, shape, finder, finderColor, gradient, gradientDir, logo } = options;
  checkRenderOptions({ scale, margin });
  const style = normalizeStyle({ shape, finder, finderColor, gradient, gradientDir, fg, bg });
  if (logo && !logo.image) {
    throw new RangeError('PNG output needs a PNG logo (SVG logos are only supported in SVG output)');
  }
  if (style.isPlain && !logo) return encodePalette1Bit(matrix, scale, margin, style);
  return encodeRgba(rasterize(matrix, { scale, margin, style, logo }));
}

// ---------------------------------------------------------------------------
// Fast path: 1 bit per pixel, two-colour palette.

function encodePalette1Bit(matrix, scale, margin, style) {
  const foreground = parseColor(style.fg);
  const background = parseColor(style.bg);
  const height = matrix.length;
  const width = matrix[0].length;
  const pixelWidth = (width + 2 * margin) * scale;
  const pixelHeight = (height + 2 * margin) * scale;

  // PLTE: palette index 0 = background, 1 = foreground.
  const plte = Buffer.from([background.r, background.g, background.b, foreground.r, foreground.g, foreground.b]);

  // Raw image: one filter byte + ceil(width / 8) bytes per scanline, 1 bit
  // per pixel, most significant bit first. A scanline is built once per
  // module row and copied `scale` times.
  const bytesPerRow = 1 + Math.ceil(pixelWidth / 8);
  const raw = Buffer.alloc(bytesPerRow * pixelHeight);
  for (let row = 0; row < height; row++) {
    const line = Buffer.alloc(bytesPerRow); // filter byte 0, bits default to 0 = background
    for (let col = 0; col < width; col++) {
      if (!matrix[row][col]) continue;
      const x0 = (col + margin) * scale;
      for (let x = x0; x < x0 + scale; x++) line[1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
    const y0 = (row + margin) * scale;
    for (let y = y0; y < y0 + scale; y++) line.copy(raw, y * bytesPerRow);
  }

  return Buffer.concat([
    SIGNATURE,
    ihdrChunk(pixelWidth, pixelHeight, 1, 3),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Styled path: RGBA raster.

/** Samples per axis per pixel for anti-aliasing (16 samples per pixel). */
const SUPERSAMPLE = 4;

/**
 * Rasterize a matrix with a style into an RGBA buffer.
 *
 * Coverage is accumulated per pixel by counting how many of the
 * SUPERSAMPLE x SUPERSAMPLE sample points fall inside a primitive.
 * Primitives from style.js never overlap, so adding their counts gives the
 * exact union and adjacent modules join without seams. Axis-aligned rects
 * sit on whole pixels (integer scale) and take an exact fast path.
 *
 * @returns {{ width: number, height: number, data: Uint8Array }} RGBA, 4 bytes per pixel
 */
export function rasterize(matrix, { scale, margin, style, logo }) {
  const size = matrix.length;
  const width = (matrix[0].length + 2 * margin) * scale;
  const height = (size + 2 * margin) * scale;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  const coverage = new Uint8Array(width * height); // 0..samples
  const role = new Uint8Array(width * height); // 0 none, 1 data, 2 finder

  for (const shape of buildShapes(matrix, style)) {
    const roleId = shape.role === 'finder' ? 2 : 1;
    const b = shapeBounds(shape);
    const x0 = Math.max(0, Math.floor((b.x + margin) * scale));
    const y0 = Math.max(0, Math.floor((b.y + margin) * scale));
    const x1 = Math.min(width, Math.ceil((b.x + b.w + margin) * scale));
    const y1 = Math.min(height, Math.ceil((b.y + b.h + margin) * scale));

    if (shape.kind === 'rect') {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          coverage[y * width + x] = samples;
          role[y * width + x] = roleId;
        }
      }
      continue;
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let hits = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy++) {
          const my = (y + (sy + 0.5) / SUPERSAMPLE) / scale - margin;
          for (let sx = 0; sx < SUPERSAMPLE; sx++) {
            const mx = (x + (sx + 0.5) / SUPERSAMPLE) / scale - margin;
            if (pointInShape(shape, mx, my)) hits++;
          }
        }
        if (hits === 0) continue;
        const i = y * width + x;
        coverage[i] = Math.min(samples, coverage[i] + hits);
        role[i] = roleId;
      }
    }
  }

  // Composite: background, then the dark colour weighted by coverage.
  const data = new Uint8Array(width * height * 4);
  const bg = parseColor(style.bg);
  const fg = parseColor(style.fg);
  const finderColor = style.finderColor ? parseColor(style.finderColor) : null;
  const gradient = style.gradient
    ? { from: parseColor(style.gradient.from), to: parseColor(style.gradient.to), box: gradientBox(size, margin) }
    : null;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const a = coverage[i] / samples;
      let colour = bg;
      if (a > 0) {
        if (role[i] === 2 && finderColor) colour = finderColor;
        else if (gradient) {
          const t = gradientT(style.gradient.direction, (x + 0.5) / scale, (y + 0.5) / scale, gradient.box);
          colour = {
            r: gradient.from.r + (gradient.to.r - gradient.from.r) * t,
            g: gradient.from.g + (gradient.to.g - gradient.from.g) * t,
            b: gradient.from.b + (gradient.to.b - gradient.from.b) * t,
          };
        } else colour = fg;
      }
      const o = i * 4;
      data[o] = Math.round(bg.r + (colour.r - bg.r) * a);
      data[o + 1] = Math.round(bg.g + (colour.g - bg.g) * a);
      data[o + 2] = Math.round(bg.b + (colour.b - bg.b) * a);
      data[o + 3] = 255;
    }
  }
  if (logo) compositeLogo({ width, height, data }, logo, scale, margin);
  return { width, height, data };
}

/**
 * Draw the logo onto the finished QR raster.
 *
 * The logo's `box` is in module units (from planLogo). Each destination
 * pixel is filled by averaging several bilinear samples of the source image
 * (more samples when shrinking a large image, so it does not alias), with
 * premultiplied alpha, then alpha-blended over the canvas. An optional
 * `bg` colour is painted first over the whole cleared `area`.
 */
function compositeLogo(canvas, logo, scale, margin) {
  const { width, data } = canvas;
  if (logo.bg) {
    const bg = parseColor(logo.bg);
    const { row, col, rows, cols } = logo.area;
    for (let y = (row + margin) * scale; y < (row + rows + margin) * scale; y++) {
      for (let x = (col + margin) * scale; x < (col + cols + margin) * scale; x++) {
        const o = (y * width + x) * 4;
        data[o] = bg.r;
        data[o + 1] = bg.g;
        data[o + 2] = bg.b;
      }
    }
  }

  const img = logo.image;
  const dx0 = (logo.box.x + margin) * scale;
  const dy0 = (logo.box.y + margin) * scale;
  const dw = logo.box.w * scale;
  const dh = logo.box.h * scale;
  const ratio = Math.max(img.width / dw, img.height / dh);
  const ss = Math.min(16, Math.max(3, Math.ceil(ratio * 2))); // samples per axis per pixel

  for (let y = Math.floor(dy0); y < Math.ceil(dy0 + dh); y++) {
    for (let x = Math.floor(dx0); x < Math.ceil(dx0 + dw); x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        const v = (y + (sy + 0.5) / ss - dy0) / dh; // 0..1 across the box
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss - dx0) / dw;
          if (u < 0 || u >= 1 || v < 0 || v >= 1) continue; // outside the box: transparent
          const s = sampleBilinear(img, u * img.width - 0.5, v * img.height - 0.5);
          r += s[0];
          g += s[1];
          b += s[2];
          a += s[3];
        }
      }
      const n = ss * ss;
      a /= n; // premultiplied sums -> averages
      if (a <= 0) continue;
      const o = (y * width + x) * 4;
      data[o] = Math.round(r / n + data[o] * (1 - a));
      data[o + 1] = Math.round(g / n + data[o + 1] * (1 - a));
      data[o + 2] = Math.round(b / n + data[o + 2] * (1 - a));
      data[o + 3] = 255;
    }
  }
}

/** Bilinear sample of an RGBA image at (x, y) pixels; returns premultiplied [r, g, b, a] with a in 0..1. */
function sampleBilinear(img, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0, 0];
  const tap = (px, py, weight) => {
    if (weight === 0 || px < 0 || py < 0 || px >= img.width || py >= img.height) return; // transparent outside
    const o = (py * img.width + px) * 4;
    const alpha = (img.data[o + 3] / 255) * weight;
    out[0] += img.data[o] * alpha;
    out[1] += img.data[o + 1] * alpha;
    out[2] += img.data[o + 2] * alpha;
    out[3] += alpha;
  };
  tap(x0, y0, (1 - fx) * (1 - fy));
  tap(x0 + 1, y0, fx * (1 - fy));
  tap(x0, y0 + 1, (1 - fx) * fy);
  tap(x0 + 1, y0 + 1, fx * fy);
  return out;
}

/** Encode an RGBA buffer as an 8-bit truecolour-with-alpha PNG. */
export function encodeRgba({ width, height, data }) {
  const bytesPerRow = 1 + width * 4;
  const raw = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    // filter byte 0, then the row's pixels
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * bytesPerRow + 1);
  }
  return Buffer.concat([
    SIGNATURE,
    ihdrChunk(width, height, 8, 6),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
