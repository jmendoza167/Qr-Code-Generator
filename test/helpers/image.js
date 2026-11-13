// Test helpers for the image decoder: real qrgen PNGs turned back into RGBA
// through the real PNG decoder, plus simple image transforms and noise.
import { renderPng } from '../../src/render/png.js';
import { decodePng } from '../../src/render/png-decode.js';

/** encode -> renderPng -> decodePng: the RGBA image a user's file would give. */
export function renderRgba(matrix, options = {}) {
  return decodePng(renderPng(matrix, options));
}

/** Rotate an RGBA image clockwise by `quarterTurns` x 90 degrees. */
export function rotateRgba({ width, height, data }, quarterTurns) {
  let image = { width, height, data: Uint8Array.from(data) };
  for (let t = 0; t < ((quarterTurns % 4) + 4) % 4; t++) {
    const out = new Uint8Array(image.data.length);
    const w = image.height; // rotated width
    const h = image.width;
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        // (x, y) -> (w - 1 - y, x)
        const src = (y * image.width + x) * 4;
        const dst = (x * w + (w - 1 - y)) * 4;
        out[dst] = image.data[src];
        out[dst + 1] = image.data[src + 1];
        out[dst + 2] = image.data[src + 2];
        out[dst + 3] = image.data[src + 3];
      }
    }
    image = { width: w, height: h, data: out };
  }
  return image;
}

/** Mirror an RGBA image left-to-right. */
export function mirrorRgba({ width, height, data }) {
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = (y * width + (width - 1 - x)) * 4;
      out.set(data.subarray(src, src + 4), dst);
    }
  }
  return { width, height, data: out };
}

/** Paste `inner` into `target` at (x, y), in place. */
export function blitRgba(target, inner, x0, y0) {
  for (let y = 0; y < inner.height; y++) {
    const srcStart = y * inner.width * 4;
    target.data.set(inner.data.subarray(srcStart, srcStart + inner.width * 4), ((y0 + y) * target.width + x0) * 4);
  }
  return target;
}

/** Paste `inner` into a copy of `outer` at (x, y). */
export function pasteRgba(outer, inner, x0, y0) {
  return blitRgba({ width: outer.width, height: outer.height, data: Uint8Array.from(outer.data) }, inner, x0, y0);
}

/** A solid RGBA image. */
export function solidRgba(width, height, [r, g, b, a = 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return { width, height, data };
}

/** Deterministic pseudo-random integers in [0, n). */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return (n) => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
}

/** Random black/white pixel noise. */
export function noiseRgba(width, height, seed) {
  const next = rng(seed);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const v = next(2) ? 255 : 0;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width, height, data };
}
