/**
 * The browser-safe decoder API. Pass RGBA pixels (e.g. a canvas ImageData)
 * to decodeQr, or a module matrix to readMatrix. For PNG files in Node, see
 * decodeQrPng in src/decode/from-png.js (exported from the package root).
 */
export { decodeQr, validateImage } from './decode.js';
export { readMatrix } from './read-matrix.js';
export { QrDecodeError, NoQrFoundError, FormatUnreadableError, TooManyErrorsError, UnsupportedContentError } from './errors.js';
