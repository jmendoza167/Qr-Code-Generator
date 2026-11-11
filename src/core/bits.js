/**
 * A growable sequence of bits. QR data is built as a bit stream (mode
 * indicator, character count, data, terminator, padding) and only packed
 * into 8-bit codewords at the very end, so a dedicated little container
 * keeps the encoder readable.
 */
export class BitBuffer {
  /** @type {number[]} each entry is 0 or 1 */
  #bits = [];

  /** Append the `length` low bits of `value`, most significant bit first. */
  append(value, length) {
    if (!Number.isInteger(length) || length < 0 || length > 32) {
      throw new RangeError(`bit length must be 0..32, got ${length}`);
    }
    if (length < 32 && value >>> length !== 0) {
      throw new RangeError(`value ${value} does not fit in ${length} bits`);
    }
    for (let i = length - 1; i >= 0; i--) this.#bits.push((value >>> i) & 1);
  }

  get length() {
    return this.#bits.length;
  }

  /** The bit at position i (0 = first appended). */
  at(i) {
    return this.#bits[i];
  }

  /** Pack into bytes, MSB first; the final byte is zero-padded on the right. */
  toBytes() {
    const bytes = new Uint8Array(Math.ceil(this.#bits.length / 8));
    for (let i = 0; i < this.#bits.length; i++) {
      bytes[i >> 3] |= this.#bits[i] << (7 - (i & 7));
    }
    return bytes;
  }

  /** The bits as a string of 0s and 1s (handy for tests and debugging). */
  toString() {
    return this.#bits.join('');
  }
}
