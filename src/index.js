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
