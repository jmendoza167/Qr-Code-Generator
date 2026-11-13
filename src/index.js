/**
 * Node entry point: the engine plus all renderers.
 *
 * In a browser bundle import the browser-safe pieces directly instead:
 *   import { encode } from '@jmendoza167/qrgen/core';
 *   import { renderSvg } from '@jmendoza167/qrgen/render/svg';
 */
export { encode, DataTooLongError, detectMode, getCapacity, MIN_VERSION, MAX_VERSION } from './core/qr.js';
export { renderTerminal } from './render/terminal.js';
export { renderSvg } from './render/svg.js';
export { renderPng } from './render/png.js';
export { buildWifiPayload } from './presets/wifi.js';
export { buildVCard } from './presets/vcard.js';
export { normalizeStyle, checkContrast } from './render/style.js';
export { planLogo, encodeWithLogo } from './render/logo.js';
export { sanitizeSvg } from './render/svg-sanitize.js';
export { decodePng, PngDecodeError } from './render/png-decode.js';
export {
  decodeQr,
  readMatrix,
  QrDecodeError,
  NoQrFoundError,
  FormatUnreadableError,
  TooManyErrorsError,
  UnsupportedContentError,
} from './decode/index.js';
export { decodeQrPng } from './decode/from-png.js';
