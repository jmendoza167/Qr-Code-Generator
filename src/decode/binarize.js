/**
 * RGBA pixels -> one bit per pixel (1 = dark).
 *
 * A single global threshold fails on gradients, coloured symbols and uneven
 * lighting, so the threshold is chosen locally: the image is cut into 8x8
 * blocks, each block gets a "black point" from its own min/max, and every
 * pixel is compared with the average black point of the 5x5 blocks around
 * it. (This is the hybrid binarizer approach ZXing popularised.) Blocks
 * with almost no contrast, e.g. inside a large dark or light area, borrow
 * the black point of their neighbours so they do not turn into noise.
 *
 * Images under 40 pixels on a side are too small for blocks and use a
 * global midpoint threshold instead.
 *
 * Alpha is composited over white first: a transparent background is white
 * for every viewer, and a QR code on it must read the same way.
 */
const BLOCK = 8;
const MIN_DYNAMIC_RANGE = 24;
const MIN_HYBRID_SIZE = 40;

/** Perceived brightness 0..255 of every pixel, transparency blended with white. */
function luminance({ width, height, data }) {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    let y = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    const a = data[p + 3];
    if (a < 255) y = (y * a + 255 * (255 - a)) / 255;
    out[i] = y + 0.5;
  }
  return out;
}

function range(lum) {
  let min = 255;
  let max = 0;
  for (const v of lum) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

function globalThreshold(lum, bits) {
  const { min, max } = range(lum);
  const threshold = (min + max) >> 1;
  for (let i = 0; i < lum.length; i++) if (lum[i] <= threshold) bits[i] = 1;
}

function hybridThreshold(lum, bits, width, height) {
  const subWidth = Math.ceil(width / BLOCK);
  const subHeight = Math.ceil(height / BLOCK);
  // Blocks at the right/bottom edge are shifted inwards so every block is a full 8x8.
  const offsetX = (bx) => Math.min(bx * BLOCK, width - BLOCK);
  const offsetY = (by) => Math.min(by * BLOCK, height - BLOCK);

  const blackPoints = new Float64Array(subWidth * subHeight);
  for (let by = 0; by < subHeight; by++) {
    for (let bx = 0; bx < subWidth; bx++) {
      const x0 = offsetX(bx);
      const y0 = offsetY(by);
      let sum = 0;
      let min = 255;
      let max = 0;
      for (let y = y0; y < y0 + BLOCK; y++) {
        for (let x = x0; x < x0 + BLOCK; x++) {
          const v = lum[y * width + x];
          sum += v;
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      let average = sum / (BLOCK * BLOCK);
      if (max - min <= MIN_DYNAMIC_RANGE) {
        // Flat block: assume it is background unless the blocks above and to
        // the left say the surroundings are darker than this block's minimum.
        average = min / 2;
        if (by > 0 && bx > 0) {
          const neighbours =
            (blackPoints[(by - 1) * subWidth + bx] + 2 * blackPoints[by * subWidth + bx - 1] + blackPoints[(by - 1) * subWidth + bx - 1]) / 4;
          if (min < neighbours) average = neighbours;
        }
      }
      blackPoints[by * subWidth + bx] = average;
    }
  }

  for (let by = 0; by < subHeight; by++) {
    const top = Math.min(Math.max(by, 2), subHeight - 3);
    for (let bx = 0; bx < subWidth; bx++) {
      const left = Math.min(Math.max(bx, 2), subWidth - 3);
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) sum += blackPoints[(top + dy) * subWidth + left + dx];
      }
      const threshold = sum / 25;
      const x0 = offsetX(bx);
      const y0 = offsetY(by);
      for (let y = y0; y < y0 + BLOCK; y++) {
        for (let x = x0; x < x0 + BLOCK; x++) {
          const i = y * width + x;
          if (lum[i] <= threshold) bits[i] = 1;
        }
      }
    }
  }
}

/**
 * @param {{ width: number, height: number, data: Uint8Array|Uint8ClampedArray }} image  RGBA, 4 bytes per pixel
 * @returns {{ width: number, height: number, bits: Uint8Array }} bits[y * width + x] is 1 for a dark pixel
 */
export function binarize(image) {
  const { width, height } = image;
  const lum = luminance(image);
  const bits = new Uint8Array(width * height);
  const { min, max } = range(lum);
  if (max - min <= MIN_DYNAMIC_RANGE) return { width, height, bits }; // flat image: nothing is dark
  if (width < MIN_HYBRID_SIZE || height < MIN_HYBRID_SIZE) globalThreshold(lum, bits);
  else hybridThreshold(lum, bits, width, height);
  return { width, height, bits };
}

/** The same bitmap with dark and light swapped (for light-on-dark symbols). */
export function invertBitmap({ width, height, bits }) {
  const inverted = new Uint8Array(bits.length);
  for (let i = 0; i < bits.length; i++) inverted[i] = bits[i] ^ 1;
  return { width, height, bits: inverted };
}
