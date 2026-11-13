// Turning corrected data codewords back into text: mode indicators,
// character counts, numeric / alphanumeric / byte segments, ECI, the
// terminator. The encoder's buildDataCodewords is the oracle for anything
// qrgen itself writes; hand-built bit streams cover what it never writes
// (several segments, ECI, Kanji, malformed counts).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSegments } from '../src/decode/segments.js';
import { buildDataCodewords } from '../src/core/encoder.js';
import { BitBuffer } from '../src/core/bits.js';
import { QrDecodeError, UnsupportedContentError } from '../src/decode/errors.js';

/** Bytes of a hand-built stream, zero-padded to `length` bytes (or to the next byte). */
function bytesOf(bits, length) {
  const bytes = bits.toBytes();
  if (length === undefined) return bytes;
  const out = new Uint8Array(length);
  out.set(bytes);
  return out;
}

const VERSIONS = [1, 9, 10, 26, 27, 40]; // the character count width changes at 10 and 27

describe('decodeSegments: what the encoder writes', () => {
  const samples = {
    numeric: ['0', '12', '123', '1234', '01234567', '9'.repeat(100), '0'.repeat(7089)],
    alphanumeric: ['A', 'AB', 'ABC', 'HELLO WORLD', '$%*+-./:', 'A'.repeat(4296)],
    byte: ['a', 'hello', 'héllo wörld', '日本語', '🙂', 'x'.repeat(2953), ''],
  };

  for (const [mode, texts] of Object.entries(samples)) {
    test(`${mode} mode round-trips on versions ${VERSIONS.join(', ')}`, () => {
      for (const text of texts) {
        for (const version of VERSIONS) {
          let codewords;
          try {
            codewords = buildDataCodewords(text, mode, version, 'L');
          } catch {
            continue; // does not fit this version
          }
          const result = decodeSegments(codewords, version);
          assert.equal(result.text, text, `${mode} v${version} ${JSON.stringify(text.slice(0, 20))}`);
          assert.deepEqual(result.segments, [{ mode, count: mode === 'byte' ? new TextEncoder().encode(text).length : text.length }]);
          assert.equal(result.eci, null);
          assert.equal(result.encoding, mode === 'byte' ? 'utf-8' : null);
        }
      }
    });
  }

  test('an empty byte-mode symbol decodes to the empty string, and the empty segment is reported', () => {
    const codewords = buildDataCodewords('', 'byte', 1, 'L');
    assert.deepEqual(decodeSegments(codewords, 1), { text: '', segments: [{ mode: 'byte', count: 0 }], encoding: 'utf-8', eci: null });
  });

  test('the full result shape', () => {
    const result = decodeSegments(buildDataCodewords('HELLO', 'alphanumeric', 1, 'M'), 1);
    assert.deepEqual(result, { text: 'HELLO', segments: [{ mode: 'alphanumeric', count: 5 }], encoding: null, eci: null });
  });

  test('a symbol filled to the last bit (no room for a terminator) still decodes', () => {
    // 1-L byte mode holds 17 bytes: 4 + 8 + 17*8 = 148 bits of 152, so the
    // terminator is 4 bits. 1-L numeric holds 41 digits: 4 + 10 + 13*10 + 7 = 151 bits, 1 bit of terminator.
    assert.equal(decodeSegments(buildDataCodewords('1'.repeat(41), 'numeric', 1, 'L'), 1).text, '1'.repeat(41));
    assert.equal(decodeSegments(buildDataCodewords('x'.repeat(17), 'byte', 1, 'L'), 1).text, 'x'.repeat(17));
  });
});

describe('decodeSegments: control characters and escape sequences come back raw', () => {
  test('ESC, CR, LF, NUL, DEL and bidi overrides decode to exactly those characters', () => {
    // The decoded text is untrusted: whoever prints it must escape it. The
    // decoder itself must not drop, replace or "clean" anything.
    const hostile = '\u001b[31mRED\u001b[0m\r\n\u0000\u007f‮REVERSED‬⁦A⁩\u0007bell\u009b1m';
    const codewords = buildDataCodewords(hostile, 'byte', 5, 'L');
    const result = decodeSegments(codewords, 5);
    assert.equal(result.text, hostile);
    assert.deepEqual([...result.text].map((c) => c.codePointAt(0)), [...hostile].map((c) => c.codePointAt(0)));
    assert.equal(result.encoding, 'utf-8');
  });

  test('raw control bytes in a Latin-1 stream are preserved too', () => {
    const bits = new BitBuffer();
    bits.append(0b0100, 4);
    bits.append(4, 8);
    for (const byte of [0x1b, 0x5b, 0x9b, 0x0d]) bits.append(byte, 8);
    const result = decodeSegments(bytesOf(bits, 19), 1);
    assert.equal(result.text, '\u001b[\u009b\r');
    assert.equal(result.encoding, 'latin-1');
  });
});

describe('decodeSegments: streams the encoder never writes', () => {
  test('several segments in a row, in order', () => {
    const bits = new BitBuffer();
    bits.append(0b0001, 4); // numeric "123"
    bits.append(3, 10);
    bits.append(123, 10);
    bits.append(0b0010, 4); // alphanumeric "AB"
    bits.append(2, 9);
    bits.append(10 * 45 + 11, 11);
    bits.append(0b0100, 4); // byte "é" (UTF-8: C3 A9)
    bits.append(2, 8);
    bits.append(0xc3, 8);
    bits.append(0xa9, 8);
    bits.append(0, 4); // terminator
    const result = decodeSegments(bytesOf(bits, 19), 1);
    assert.deepEqual(result, {
      text: '123ABé',
      segments: [
        { mode: 'numeric', count: 3 },
        { mode: 'alphanumeric', count: 2 },
        { mode: 'byte', count: 2 },
      ],
      encoding: 'utf-8',
      eci: null,
    });
  });

  test('padding after the terminator is ignored, whatever it contains', () => {
    const bits = new BitBuffer();
    bits.append(0b0001, 4);
    bits.append(1, 10);
    bits.append(7, 4);
    bits.append(0, 4);
    const bytes = bytesOf(bits, 19);
    bytes.fill(0x11, 3); // 0b0001_0001: looks like numeric mode indicators
    assert.equal(decodeSegments(bytes, 1).text, '7');
  });

  test('bytes that are not valid UTF-8 decode as Latin-1 and say so', () => {
    const bits = new BitBuffer();
    bits.append(0b0100, 4);
    bits.append(3, 8);
    for (const byte of [0xe9, 0x41, 0xff]) bits.append(byte, 8); // "éA" + 0xFF in Latin-1
    const result = decodeSegments(bytesOf(bits, 19), 1);
    assert.equal(result.text, 'éAÿ');
    assert.equal(result.encoding, 'latin-1');
  });

  test('one invalid byte segment makes every byte segment Latin-1 (one text, one encoding)', () => {
    const bits = new BitBuffer();
    bits.append(0b0100, 4);
    bits.append(2, 8);
    bits.append(0xc3, 8);
    bits.append(0xa9, 8); // valid UTF-8 "é"
    bits.append(0b0100, 4);
    bits.append(1, 8);
    bits.append(0xe9, 8); // not valid UTF-8 on its own
    const result = decodeSegments(bytesOf(bits, 19), 1);
    assert.equal(result.text, 'Ã©é');
    assert.equal(result.encoding, 'latin-1');
  });

  test('ECI 26 (UTF-8) is accepted and reported', () => {
    const bits = new BitBuffer();
    bits.append(0b0111, 4);
    bits.append(26, 8); // one-byte designator: 0xxxxxxx
    bits.append(0b0100, 4);
    bits.append(2, 8);
    bits.append(0xc3, 8);
    bits.append(0xa9, 8);
    const result = decodeSegments(bytesOf(bits, 19), 1);
    assert.equal(result.text, 'é');
    assert.equal(result.eci, 26);
    assert.equal(result.encoding, 'utf-8');
  });

  test('other ECI designators (1, 2 and 3-byte forms) raise UnsupportedContentError and are named', () => {
    const cases = [
      [[3], 8], // ISO-8859-1, one byte
      [[0b10000000 | (1000 >> 8), 1000 & 0xff], 8], // 1000, two bytes: 10xxxxxx xxxxxxxx
      [[0b11000000 | (900000 >> 16), (900000 >> 8) & 0xff, 900000 & 0xff], 8], // 900000, three bytes
    ];
    for (const [designatorBytes] of cases) {
      const bits = new BitBuffer();
      bits.append(0b0111, 4);
      for (const b of designatorBytes) bits.append(b, 8);
      bits.append(0b0100, 4);
      bits.append(1, 8);
      bits.append(0x41, 8);
      assert.throws(
        () => decodeSegments(bytesOf(bits, 19), 1),
        (err) => {
          assert.ok(err instanceof UnsupportedContentError, `${designatorBytes}: ${err.name}: ${err.message}`);
          assert.ok(err instanceof QrDecodeError);
          assert.match(err.message, /ECI/);
          return true;
        },
      );
    }
    // The designator is reported on the error so an inspector can show it.
    assert.throws(() => decodeSegments(bytesOf((() => { const b = new BitBuffer(); b.append(0b0111, 4); b.append(3, 8); return b; })(), 19), 1), (err) => err.eci === 3);
  });

  test('Kanji mode raises UnsupportedContentError', () => {
    const bits = new BitBuffer();
    bits.append(0b1000, 4);
    bits.append(1, 8);
    bits.append(0x1234, 13);
    assert.throws(() => decodeSegments(bytesOf(bits, 19), 1), (err) => err instanceof UnsupportedContentError && /kanji/i.test(err.message));
  });

  test('structured append, FNC1 and reserved mode indicators raise UnsupportedContentError', () => {
    for (const indicator of [0b0011, 0b0101, 0b1001, 0b0110, 0b1010, 0b1011, 0b1100, 0b1101, 0b1110, 0b1111]) {
      const bits = new BitBuffer();
      bits.append(indicator, 4);
      bits.append(0xff, 8);
      assert.throws(
        () => decodeSegments(bytesOf(bits, 19), 1),
        (err) => err instanceof UnsupportedContentError && new RegExp(indicator.toString(2).padStart(4, '0')).test(err.message),
        `indicator ${indicator.toString(2)}`,
      );
    }
  });
});

describe('decodeSegments: malformed streams are refused with QrDecodeError', () => {
  const malformed = (bits, version = 1, length = 19) =>
    assert.throws(
      () => decodeSegments(bytesOf(bits, length), version),
      (err) => err instanceof QrDecodeError && !(err instanceof UnsupportedContentError),
    );

  test('a character count larger than the remaining data', () => {
    for (const [indicator, countBits] of [[0b0001, 10], [0b0010, 9], [0b0100, 8]]) {
      const bits = new BitBuffer();
      bits.append(indicator, 4);
      bits.append((1 << countBits) - 1, countBits);
      malformed(bits);
    }
  });

  test('numeric groups above 999 / 99 / 9 and alphanumeric values above 44', () => {
    const numeric3 = new BitBuffer();
    numeric3.append(0b0001, 4);
    numeric3.append(3, 10);
    numeric3.append(1000, 10);
    malformed(numeric3);
    const numeric2 = new BitBuffer();
    numeric2.append(0b0001, 4);
    numeric2.append(2, 10);
    numeric2.append(100, 7);
    malformed(numeric2);
    const numeric1 = new BitBuffer();
    numeric1.append(0b0001, 4);
    numeric1.append(1, 10);
    numeric1.append(10, 4);
    malformed(numeric1);
    const pair = new BitBuffer();
    pair.append(0b0010, 4);
    pair.append(2, 9);
    pair.append(2025, 11);
    malformed(pair);
    const single = new BitBuffer();
    single.append(0b0010, 4);
    single.append(1, 9);
    single.append(45, 6);
    malformed(single);
  });

  test('an ECI header cut off by the end of the data', () => {
    const bits = new BitBuffer();
    bits.append(0b0111, 4);
    bits.append(0b11000000, 8); // announces two more bytes that are not there
    malformed(bits, 1, 2);
  });

  test('the version must be valid and the codewords a byte array', () => {
    assert.throws(() => decodeSegments(new Uint8Array(19), 0), RangeError);
    assert.throws(() => decodeSegments(new Uint8Array(19), 41), RangeError);
    assert.throws(() => decodeSegments('not bytes', 1), TypeError);
  });

  test('a stream of nothing but 1-bits ends quickly (bounded loop)', () => {
    const bytes = new Uint8Array(2956).fill(0xff); // 40-L data codewords
    const started = performance.now();
    assert.throws(() => decodeSegments(bytes, 40), QrDecodeError);
    assert.ok(performance.now() - started < 200);
  });
});
