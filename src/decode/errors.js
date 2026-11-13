/**
 * Typed errors of the decoder. Everything thrown on purpose while reading a
 * symbol extends QrDecodeError, so a caller can tell "this image is not a
 * readable QR code" (expected, user-facing) from a bug (anything else).
 */
export class QrDecodeError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'QrDecodeError';
    Object.assign(this, details);
  }
}

/** No finder patterns, or no consistent set of three, in the image. */
export class NoQrFoundError extends QrDecodeError {
  constructor(message = 'No QR code found in the image', details) {
    super(message, details);
    this.name = 'NoQrFoundError';
  }
}

/** Neither copy of the format (or version) information is within 3 bit errors of a valid value. */
export class FormatUnreadableError extends QrDecodeError {
  constructor(message, details) {
    super(message, details);
    this.name = 'FormatUnreadableError';
  }
}

/** A Reed-Solomon block has more errors than its EC codewords can correct. */
export class TooManyErrorsError extends QrDecodeError {
  constructor(message, details) {
    super(message, details);
    this.name = 'TooManyErrorsError';
  }
}

/** The data is valid but uses a feature this decoder does not support (Kanji, most ECIs, structured append...). */
export class UnsupportedContentError extends QrDecodeError {
  constructor(message, details) {
    super(message, details);
    this.name = 'UnsupportedContentError';
  }
}
