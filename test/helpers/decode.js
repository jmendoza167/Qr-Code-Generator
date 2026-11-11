// Test helper: turn a module matrix into RGBA pixels and decode it with
// jsQR, an independent decoder. If our encoder is wrong anywhere (tables,
// placement, masking, format bits), jsQR returns null or the wrong text.
import jsQR from 'jsqr';

/**
 * Rasterize a boolean matrix into an RGBA buffer, `scale` pixels per module,
 * with a light quiet zone of `margin` modules on every side.
 */
export function rasterize(matrix, { scale = 4, margin = 4 } = {}) {
  const size = matrix.length;
  const width = (size + 2 * margin) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!matrix[row][col]) continue;
      for (let dy = 0; dy < scale; dy++) {
        const y = (row + margin) * scale + dy;
        for (let dx = 0; dx < scale; dx++) {
          const x = (col + margin) * scale + dx;
          const i = (y * width + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width, height: width };
}

/** Decode a module matrix with jsQR. Returns jsQR's result object or null. */
export function decodeMatrix(matrix, options) {
  const { data, width, height } = rasterize(matrix, options);
  return jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
}

/** Decode an RGBA buffer (e.g. from a PNG) with jsQR. */
export function decodeRgba(data, width, height) {
  return jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height, {
    inversionAttempts: 'dontInvert',
  });
}
