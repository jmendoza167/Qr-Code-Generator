/**
 * Thrown when the input does not fit in the largest allowed symbol
 * (version 40 by default, or a forced/maximum version if one was given).
 * It extends RangeError so callers that do not know about it still get a
 * sensible error type.
 */
export class DataTooLongError extends RangeError {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DataTooLongError';
    Object.assign(this, details);
  }
}
