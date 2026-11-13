/**
 * From corrected data codewords back to text (the reverse of
 * src/core/encoder.js): a sequence of segments, each a 4-bit mode
 * indicator, a character count and the data, ended by a terminator or by
 * running out of bits.
 *
 * Supported: numeric, alphanumeric, byte, and the ECI header for UTF-8
 * (ECI 26). Bytes are decoded as UTF-8, which is what qrgen writes and what
 * every modern reader assumes; if they are not valid UTF-8 the whole byte
 * content is read as ISO-8859-1 instead and the result says so, so an
 * inspector can flag the fallback. Kanji, other ECIs, structured append and
 * FNC1 are reported as unsupported rather than guessed at.
 *
 * The decoded text is returned exactly as encoded, control characters and
 * all. It is untrusted input; whoever prints it must escape it.
 */
import { ALPHANUMERIC_CHARSET } from '../core/tables.js';
import { getCharCountBits, getDataBitLength } from '../core/mode.js';
import { assertVersion } from '../core/version.js';
import { QrDecodeError, UnsupportedContentError } from './errors.js';

const MODE_NAMES = { 1: 'numeric', 2: 'alphanumeric', 4: 'byte', 7: 'eci', 8: 'kanji' };
const UNSUPPORTED_MODES = {
  3: 'structured append',
  5: 'FNC1 (first position)',
  8: 'Kanji',
  9: 'FNC1 (second position)',
};
const ECI_UTF8 = 26;

/** Reads bits most significant first; refuses to read past the end. */
class BitReader {
  #bytes;
  #position = 0;

  constructor(bytes) {
    this.#bytes = bytes;
  }

  get available() {
    return this.#bytes.length * 8 - this.#position;
  }

  read(count) {
    if (count > this.available) throw new QrDecodeError('Malformed data: a segment runs past the end of the data codewords');
    let value = 0;
    for (let i = 0; i < count; i++) {
      const bit = (this.#bytes[this.#position >> 3] >> (7 - (this.#position & 7))) & 1;
      value = value * 2 + bit; // not <<: counts may reach 16 bits, values stay small
      this.#position++;
    }
    return value;
  }
}

function readCount(reader, mode, version) {
  const count = reader.read(getCharCountBits(mode, version));
  if (getDataBitLength(mode, count) > reader.available) {
    throw new QrDecodeError(`Malformed data: a ${mode} segment declares ${count} characters but the data ends first`);
  }
  return count;
}

function readNumeric(reader, count) {
  let text = '';
  for (let remaining = count; remaining > 0; remaining -= 3) {
    const digits = Math.min(3, remaining);
    const value = reader.read(digits * 3 + 1);
    if (value >= 10 ** digits) throw new QrDecodeError(`Malformed data: numeric group value ${value} has more than ${digits} digits`);
    text += String(value).padStart(digits, '0');
  }
  return text;
}

function readAlphanumeric(reader, count) {
  let text = '';
  for (let remaining = count; remaining > 0; remaining -= 2) {
    if (remaining >= 2) {
      const value = reader.read(11);
      if (value >= 45 * 45) throw new QrDecodeError(`Malformed data: alphanumeric pair value ${value} is out of range`);
      text += ALPHANUMERIC_CHARSET[Math.floor(value / 45)] + ALPHANUMERIC_CHARSET[value % 45];
    } else {
      const value = reader.read(6);
      if (value >= 45) throw new QrDecodeError(`Malformed data: alphanumeric value ${value} is out of range`);
      text += ALPHANUMERIC_CHARSET[value];
    }
  }
  return text;
}

/** ECI designator: 1, 2 or 3 bytes, the leading bits say which (0xxxxxxx, 10xxxxxx, 110xxxxx). */
function readEci(reader) {
  const first = reader.read(8);
  if ((first & 0x80) === 0) return first;
  if ((first & 0xc0) === 0x80) return ((first & 0x3f) << 8) | reader.read(8);
  if ((first & 0xe0) === 0xc0) return ((first & 0x1f) << 16) | reader.read(16);
  throw new QrDecodeError('Malformed data: invalid ECI designator');
}

function decodeUtf8(bytes) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}

function decodeLatin1(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/**
 * @param {Uint8Array} codewords  the data codewords (after error correction, before any padding is stripped)
 * @param {number} version        symbol version, which sets the character count widths
 * @returns {{ text: string, segments: {mode: string, count: number}[], encoding: 'utf-8'|'latin-1'|null, eci: number|null }}
 *   `encoding` is how the byte segments were read (null when there were none);
 *   `eci` is the ECI designator if the data carried one.
 * @throws {QrDecodeError} for a malformed stream, {UnsupportedContentError} for unsupported features
 */
export function decodeSegments(codewords, version) {
  if (!(codewords instanceof Uint8Array)) throw new TypeError('codewords must be a Uint8Array');
  assertVersion(version);
  const reader = new BitReader(codewords);
  const segments = [];
  const parts = []; // strings, or Uint8Arrays for byte segments (decoded together at the end)
  let eci = null;

  // Every iteration consumes at least the 4 indicator bits, so this ends.
  while (reader.available >= 4) {
    const indicator = reader.read(4);
    if (indicator === 0) break; // terminator
    const mode = MODE_NAMES[indicator];
    if (mode === 'eci') {
      const designator = readEci(reader);
      if (designator !== ECI_UTF8) {
        throw new UnsupportedContentError(`ECI ${designator} is not supported (only ECI 26, UTF-8)`, { eci: designator });
      }
      eci = designator;
      continue;
    }
    if (mode === undefined || mode === 'kanji') {
      const name = UNSUPPORTED_MODES[indicator] ?? 'reserved';
      throw new UnsupportedContentError(`Mode indicator ${indicator.toString(2).padStart(4, '0')} (${name}) is not supported`, {
        modeIndicator: indicator,
      });
    }
    const count = readCount(reader, mode, version);
    segments.push({ mode, count });
    if (mode === 'numeric') parts.push(readNumeric(reader, count));
    else if (mode === 'alphanumeric') parts.push(readAlphanumeric(reader, count));
    else {
      const bytes = new Uint8Array(count);
      for (let i = 0; i < count; i++) bytes[i] = reader.read(8);
      parts.push(bytes);
    }
  }

  const byteParts = parts.filter((p) => typeof p !== 'string');
  let encoding = null;
  if (byteParts.length > 0) {
    encoding = 'utf-8';
    try {
      for (const bytes of byteParts) decodeUtf8(bytes);
    } catch {
      encoding = 'latin-1';
    }
  }
  const decode = encoding === 'latin-1' ? decodeLatin1 : decodeUtf8;
  const text = parts.map((p) => (typeof p === 'string' ? p : decode(p))).join('');
  return { text, segments, encoding, eci };
}
