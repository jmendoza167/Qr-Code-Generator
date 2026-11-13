/**
 * Convenience for Node callers: PNG file bytes -> decoded QR code. This is
 * the one decoder module that is not browser-safe, because the PNG decoder
 * uses zlib; in a browser, draw the image on a canvas and pass its
 * ImageData to decodeQr instead.
 */
import { decodePng } from '../render/png-decode.js';
import { decodeQr } from './decode.js';

/**
 * @param {Uint8Array|Buffer} bytes  a PNG file
 * @returns {import('./decode.js').DecodedQrImage}
 * @throws {PngDecodeError} if the bytes are not a supported PNG
 * @throws {QrDecodeError} (and subclasses) if the image holds no readable QR code
 */
export function decodeQrPng(bytes) {
  return decodeQr(decodePng(bytes));
}
