/**
 * PNG renderer (Node only: uses the built-in zlib for compression).
 *
 * A PNG file is an 8-byte signature followed by chunks. Each chunk is
 *
 *     length (4 bytes, big-endian) | type (4 ASCII bytes) | data | CRC32 of type + data
 *
 * We write the minimum: IHDR (header), PLTE (a 2-colour palette), IDAT
 * (the compressed pixels) and IEND. Pixels are stored as 1 bit each
 * (colour type 3 = indexed, bit depth 1), so a 177-module version 40 at
 * scale 10 is 1850 x 1850 pixels but only ~430 KB before deflate, and far
 * less after it. Every scanline is prefixed with a filter-type byte; we use
 * filter 0 ("none") everywhere because deflate already compresses the
 * repetitive rows extremely well.
 */
import { deflateSync } from 'node:zlib';
import { parseColor, checkRenderOptions } from './color.js';

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

/**
 * @param {boolean[][]} matrix
 * @param {Object} [options]
 * @param {number} [options.scale=10]     pixels per module
 * @param {number} [options.margin=4]     quiet zone in modules
 * @param {string} [options.fg='#000000'] colour of dark modules
 * @param {string} [options.bg='#ffffff'] background colour
 * @returns {Buffer} the PNG file contents
 */
export function renderPng(matrix, { scale = 10, margin = 4, fg = '#000000', bg = '#ffffff' } = {}) {
  checkRenderOptions({ scale, margin });
  const foreground = parseColor(fg);
  const background = parseColor(bg);
  const height = matrix.length;
  const width = matrix[0].length;
  const pixelWidth = (width + 2 * margin) * scale;
  const pixelHeight = (height + 2 * margin) * scale;

  // IHDR: width, height, bit depth 1, colour type 3 (palette), then
  // compression method 0, filter method 0, interlace 0.
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(pixelWidth, 0);
  ihdr.writeUInt32BE(pixelHeight, 4);
  ihdr[8] = 1;
  ihdr[9] = 3;

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
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
