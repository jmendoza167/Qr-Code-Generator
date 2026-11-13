/**
 * Size caps shared by everything that takes an untrusted raster image: the
 * PNG decoder (before it inflates anything) and the QR decoder (before it
 * allocates per-pixel buffers). Pure constants, safe for the browser.
 */

/** Largest image accepted: 4096 x 4096, 16 megapixels in total. */
export const MAX_IMAGE_DIMENSION = 4096;
export const MAX_IMAGE_PIXELS = MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION;
