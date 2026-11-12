// Test helper: build small PNG images with pngjs (an independent encoder)
// to feed our own decoder and logo compositor.
import pngjs from 'pngjs';

const { PNG } = pngjs;

/**
 * An RGBA image: a filled circle of `color` on a transparent background,
 * plus a diagonal dark stripe so scaling bugs show up. Returns the pngjs
 * object (width, height, data) so tests can compare pixels.
 */
export function makeLogoImage(width, height, color = [220, 30, 30]) {
  const png = new PNG({ width, height });
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) / 2 - 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inside = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r;
      if (inside) {
        const stripe = Math.abs(x - y) < width / 10;
        png.data[i] = stripe ? 20 : color[0];
        png.data[i + 1] = stripe ? 20 : color[1];
        png.data[i + 2] = stripe ? 20 : color[2];
        png.data[i + 3] = 255;
      } else {
        png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
        png.data[i + 3] = 0;
      }
    }
  }
  return png;
}

/** Encode a pngjs image with the given options (colorType, bitDepth, filterType...). */
export function encodeWithPngjs(png, options = {}) {
  return PNG.sync.write(png, options);
}

/** Pseudo-random but deterministic RGBA pixels. */
export function makeNoiseImage(width, height, { opaque = false } = {}) {
  const png = new PNG({ width, height });
  let seed = 12345;
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed & 0xff;
  };
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = next();
    png.data[i + 1] = next();
    png.data[i + 2] = next();
    png.data[i + 3] = opaque ? 255 : next();
  }
  return png;
}
