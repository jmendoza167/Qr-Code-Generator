/**
 * Minimal PNG decoder (Node only: uses zlib to inflate). Enough to read the
 * logo files people are likely to have: 8-bit grayscale, grayscale+alpha,
 * RGB, RGBA and palette images (1/2/4/8-bit), non-interlaced, optional tRNS.
 *
 * PNG stores each scanline behind a one-byte *filter type* that tells the
 * decoder how the row was predicted from its neighbours (none, left byte,
 * byte above, their average, or the Paeth predictor). Undoing those filters
 * is the only real work here; the rest is unpacking channels to RGBA.
 *
 * The file is untrusted input. A few hundred kilobytes of deflate data can
 * expand to gigabytes (a "decompression bomb"), so the declared size is
 * checked against a cap *before* anything is inflated, and inflating stops
 * at the number of bytes that size calls for.
 */
import { inflateSync } from 'node:zlib';
import { crc32 } from './png.js';
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from './image-limits.js';

export class PngDecodeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PngDecodeError';
  }
}

/** Largest PNG accepted: 4096 x 4096, 16 megapixels in total (shared with the QR decoder). */
export const MAX_PNG_DIMENSION = MAX_IMAGE_DIMENSION;
export const MAX_PNG_PIXELS = MAX_IMAGE_PIXELS;

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * @param {Uint8Array|Buffer} bytes  the PNG file
 * @returns {{ width: number, height: number, data: Uint8Array }} RGBA, 4 bytes per pixel
 */
export function decodePng(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    throw new PngDecodeError('JPEG images are not supported: convert the logo to PNG first');
  }
  if (buf.length < 8 || SIGNATURE.some((b, i) => buf[i] !== b)) {
    throw new PngDecodeError('The logo is not a PNG file (use a PNG, or an SVG when saving as .svg)');
  }

  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const start = pos + 8;
    const end = start + length;
    if (end + 4 > buf.length) throw new PngDecodeError('Truncated PNG file');
    if (crc32(buf.subarray(pos + 4, end)) !== buf.readUInt32BE(end)) {
      throw new PngDecodeError(`Corrupt PNG file (bad CRC in ${type} chunk)`);
    }
    const data = buf.subarray(start, end);
    if (type === 'IHDR') {
      if (header) throw new PngDecodeError('Corrupt PNG file (more than one IHDR chunk)');
      if (data.length !== 13) throw new PngDecodeError('Corrupt PNG file (bad IHDR chunk)');
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos = end + 4;
  }
  if (!header) throw new PngDecodeError('The logo is not a PNG file (missing IHDR)');

  const { width, height, bitDepth, colorType, interlace } = header;
  // Size checks come first, before any memory is allocated for the pixels.
  if (width === 0 || height === 0) {
    throw new PngDecodeError(`The logo PNG has no pixels (its size is ${width}x${height})`);
  }
  if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION || width * height > MAX_PNG_PIXELS) {
    throw new PngDecodeError(
      `The logo PNG is too large (${width}x${height}): the limit is ${MAX_PNG_DIMENSION}x${MAX_PNG_DIMENSION} pixels. Resize it first`,
    );
  }
  if (interlace !== 0) throw new PngDecodeError('Interlaced PNGs are not supported: re-save the logo without interlacing (Adam7)');
  if (bitDepth === 16) throw new PngDecodeError('16-bit PNGs are not supported: re-save the logo as 8-bit');
  const channels = CHANNELS[colorType];
  const depthOk = colorType === 3 ? [1, 2, 4, 8].includes(bitDepth) : bitDepth === 8;
  if (!channels || !depthOk) {
    throw new PngDecodeError(`Unsupported PNG (colour type ${colorType}, bit depth ${bitDepth}): re-save it as 8-bit RGB or RGBA`);
  }
  if (colorType === 3 && !palette) throw new PngDecodeError('Corrupt PNG file (palette image without PLTE)');
  if (idat.length === 0) throw new PngDecodeError('Corrupt PNG file (no image data)');

  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8)); // bytes per pixel, as the filters see it
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  // Exactly what the header promises: one filter byte plus `stride` bytes per
  // row. zlib refuses to produce more, so a bomb is cut off here instead of
  // being inflated in full.
  const expected = height * (stride + 1);
  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
  } catch (err) {
    if (err.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new PngDecodeError(`Corrupt PNG file (the image data is larger than its declared size of ${width}x${height})`);
    }
    throw new PngDecodeError(`Corrupt PNG file (${err.message})`);
  }
  if (raw.length < expected) throw new PngDecodeError('Truncated PNG image data');

  const pixels = unfilter(raw, width, height, stride, bpp);
  return { width, height, data: toRgba(pixels, header, stride, palette, transparency) };
}

/** Undo the per-row filters, returning the rows concatenated without filter bytes. */
function unfilter(raw, width, height, stride, bpp) {
  const out = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride); // the row above (zeros for the first row)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0; // left
      const b = prev[i]; // above
      const c = i >= bpp ? prev[i - bpp] : 0; // above-left
      let value;
      switch (filter) {
        case 0:
          value = src[i];
          break;
        case 1:
          value = src[i] + a;
          break;
        case 2:
          value = src[i] + b;
          break;
        case 3:
          value = src[i] + ((a + b) >> 1);
          break;
        case 4:
          value = src[i] + paeth(a, b, c);
          break;
        default:
          throw new PngDecodeError(`Corrupt PNG file (unknown filter type ${filter})`);
      }
      row[i] = value & 0xff;
    }
    prev = row;
  }
  return out;
}

/** Paeth predictor: whichever of a, b, c is closest to a + b - c. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Expand any supported layout to 8-bit RGBA. */
function toRgba(pixels, { width, height, bitDepth, colorType }, stride, palette, trns) {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r;
      let g;
      let b;
      let a = 255;
      switch (colorType) {
        case 0: // grayscale
          r = g = b = row[x];
          if (trns && trns.length >= 2 && trns.readUInt16BE(0) === r) a = 0;
          break;
        case 2: // RGB
          r = row[x * 3];
          g = row[x * 3 + 1];
          b = row[x * 3 + 2];
          if (trns && trns.length >= 6 && trns.readUInt16BE(0) === r && trns.readUInt16BE(2) === g && trns.readUInt16BE(4) === b) a = 0;
          break;
        case 3: {
          // palette, 1/2/4/8 bits per index, most significant bits first
          const perByte = 8 / bitDepth;
          const byte = row[Math.floor(x / perByte)];
          const shift = 8 - bitDepth * ((x % perByte) + 1);
          const index = (byte >> shift) & ((1 << bitDepth) - 1);
          if (index * 3 + 2 >= palette.length) throw new PngDecodeError('Corrupt PNG file (palette index out of range)');
          r = palette[index * 3];
          g = palette[index * 3 + 1];
          b = palette[index * 3 + 2];
          if (trns && index < trns.length) a = trns[index];
          break;
        }
        case 4: // grayscale + alpha
          r = g = b = row[x * 2];
          a = row[x * 2 + 1];
          break;
        default: // 6: RGBA
          r = row[x * 4];
          g = row[x * 4 + 1];
          b = row[x * 4 + 2];
          a = row[x * 4 + 3];
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return out;
}
