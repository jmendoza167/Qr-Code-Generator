/**
 * Decode a QR code from an RGBA image. The pipeline:
 *
 *   image ──binarize──▶ bitmap (and its inverse, for light-on-dark symbols)
 *         ──findFinderPatterns + rankTriples──▶ candidate symbols
 *         ──candidateDimensions + sampleGrid──▶ module matrix
 *         ──functionPatternMismatch──▶ "is this really a symbol?"
 *         ──readMatrix──▶ text + metadata
 *
 * Everything is bounded: the image size is capped before any buffer is
 * allocated, at most MAX_TRIPLES candidate symbols are tried per polarity,
 * each with at most a few sizes, and every stage below is linear in the
 * image or the symbol.
 *
 * Error policy: if no candidate ever looks like a symbol, NoQrFoundError.
 * If one does (its finder, timing and alignment patterns match) but cannot
 * be read, the error from that attempt is reported: FormatUnreadableError,
 * TooManyErrorsError or UnsupportedContentError. Nothing is ever returned
 * unless every Reed-Solomon block verified.
 */
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from '../render/image-limits.js';
import { getSize } from '../core/version.js';
import { binarize, invertBitmap } from './binarize.js';
import { findFinderPatterns, rankTriples } from './finder.js';
import { candidateDimensions, sampleGrid, functionPatternMismatch } from './grid.js';
import { readMatrix } from './read-matrix.js';
import { QrDecodeError, NoQrFoundError } from './errors.js';

const MAX_TRIPLES = 4;
const MAX_DIMENSIONS_PER_TRIPLE = 3;
/** Above this fraction of wrong timing/alignment modules the sample is not a symbol (noise scores ~0.5). */
const MAX_STRUCTURE_MISMATCH = 0.25;

/** Reject anything that is not a sanely sized RGBA image before touching its pixels. */
export function validateImage(image) {
  if (image === null || typeof image !== 'object') throw new TypeError('image must be an object { width, height, data }');
  const { width, height, data } = image;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray)) throw new TypeError('image.data must be a Uint8Array of RGBA bytes');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`image width and height must be positive integers, got ${width}x${height}`);
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    throw new RangeError(`The image is too large (${width}x${height}): the limit is ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} pixels`);
  }
  if (data.length !== width * height * 4) {
    throw new RangeError(`image.data has ${data.length} bytes, expected ${width * height * 4} for ${width}x${height} RGBA`);
  }
}

/**
 * @typedef {import('./read-matrix.js').DecodedQr & {
 *   inverted: boolean,
 *   location: {
 *     topLeft: {x: number, y: number}, topRight: {x: number, y: number}, bottomLeft: {x: number, y: number},
 *     moduleSize: number, dimension: number
 *   }
 * }} DecodedQrImage
 */

/**
 * @param {{ width: number, height: number, data: Uint8Array|Uint8ClampedArray }} image  RGBA pixels
 * @returns {DecodedQrImage}
 * @throws {NoQrFoundError|FormatUnreadableError|TooManyErrorsError|UnsupportedContentError}
 * @throws {TypeError|RangeError} for an invalid or oversized image object
 */
export function decodeQr(image) {
  validateImage(image);
  const bitmap = binarize(image);
  let symbolError = null; // first error from something that looked like a symbol

  for (const inverted of [false, true]) {
    const bits = inverted ? invertBitmap(bitmap) : bitmap;
    const triples = rankTriples(findFinderPatterns(bits)).slice(0, MAX_TRIPLES);
    for (const triple of triples) {
      const dimensions = candidateDimensions(triple);
      for (let i = 0; i < dimensions.length && i < MAX_DIMENSIONS_PER_TRIPLE; i++) {
        const dimension = dimensions[i];
        const modules = sampleGrid(bits, triple, dimension);
        if (functionPatternMismatch(modules) > MAX_STRUCTURE_MISMATCH) continue;
        try {
          const result = readMatrix(modules);
          return {
            ...result,
            inverted,
            location: {
              topLeft: { x: triple.topLeft.x, y: triple.topLeft.y },
              topRight: { x: triple.topRight.x, y: triple.topRight.y },
              bottomLeft: { x: triple.bottomLeft.x, y: triple.bottomLeft.y },
              moduleSize: triple.moduleSize,
              dimension,
            },
          };
        } catch (err) {
          if (!(err instanceof QrDecodeError)) throw err;
          // The version information disagreed with the size estimate: trust it once.
          if (err.infoVersion !== undefined) {
            const size = getSize(err.infoVersion);
            if (!dimensions.includes(size)) dimensions.push(size);
          }
          symbolError ??= err;
        }
      }
    }
  }

  if (symbolError) throw symbolError;
  throw new NoQrFoundError();
}
