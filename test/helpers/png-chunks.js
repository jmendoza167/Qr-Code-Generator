// Test helper: assemble PNG files chunk by chunk, so tests can build
// malformed or unusual files that no real encoder would write.
import { crc32 } from '../../src/render/png.js';

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One chunk: length, type, data, CRC over type + data. */
export function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const out = Buffer.alloc(typeAndData.length + 8);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), typeAndData.length + 4);
  return out;
}

/** The signature followed by the given [type, data] chunks, each with a correct CRC. */
export function buildPng(chunks) {
  return Buffer.concat([PNG_SIGNATURE, ...chunks.map(([type, data]) => chunk(type, data))]);
}

/** IHDR data: width, height, bit depth, colour type, (compression, filter method = 0), interlace. */
export function ihdr(width, height, bitDepth = 8, colorType = 6, interlace = 0) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0);
  b.writeUInt32BE(height, 4);
  b[8] = bitDepth;
  b[9] = colorType;
  b[12] = interlace;
  return b;
}
