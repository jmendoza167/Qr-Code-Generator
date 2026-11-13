// Reading a QR symbol from its module matrix: version from the size,
// format and version information, unmasking, the zigzag walk back to
// codewords, de-interleaving, Reed-Solomon correction and the segments.
// The encoder is the oracle: every version, level, mode and mask must come
// back exactly, and damage must be either corrected (and counted) or
// refused, never returned as the wrong text.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readMatrix } from '../src/decode/read-matrix.js';
import { encode, getCapacity } from '../src/core/qr.js';
import { createMatrix, dataModulePositions, formatInfoPositions, versionInfoPositions } from '../src/core/matrix.js';
import { getBlockLayout, getTotalCodewords, getRemainderBits, getSize } from '../src/core/version.js';
import { QrDecodeError, FormatUnreadableError, TooManyErrorsError } from '../src/decode/errors.js';
import { decodeMatrix } from './helpers/decode.js';

const LEVELS = ['L', 'M', 'Q', 'H'];
const MODES = ['numeric', 'alphanumeric', 'byte'];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return (n) => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s % n;
  };
}

/** Text in `mode` that fills about `fraction` of the capacity of version/ecc. */
function sampleText(mode, version, ecc, fraction = 0.8) {
  const capacity = getCapacity(version, ecc, mode);
  const units = Math.max(1, Math.floor(capacity * fraction));
  if (mode === 'numeric') return Array.from({ length: units }, (_, i) => String((i * 7) % 10)).join('');
  if (mode === 'alphanumeric') {
    const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
    return Array.from({ length: units }, (_, i) => charset[(i * 11) % charset.length]).join('');
  }
  // byte: mix of ASCII and multi-byte, cut to fit `units` bytes exactly on a character boundary
  const sample = [...'héllo wörld 日本 🙂 ']; // code points, so the emoji is never cut in half
  let text = '';
  for (let i = 0; ; i++) {
    const next = text + sample[i % sample.length];
    if (new TextEncoder().encode(next).length > units) break;
    text = next;
  }
  return text.length > 0 ? text : 'x';
}

const copyMatrix = (matrix) => matrix.map((row) => row.slice());

describe('the shared zigzag walk (src/core/matrix.js)', () => {
  test('visits every non-function module exactly once, codeword bits first, remainder bits last', () => {
    for (const version of [1, 2, 5, 7, 14, 21, 27, 35, 40]) {
      const template = createMatrix(version);
      const seen = new Set();
      let count = 0;
      for (const [row, col] of dataModulePositions(template)) {
        assert.equal(template.isFunction[row][col], false, `v${version} (${row},${col}) is a function module`);
        assert.ok(!seen.has(row * 1000 + col), `v${version} (${row},${col}) visited twice`);
        seen.add(row * 1000 + col);
        count++;
      }
      assert.equal(count, getTotalCodewords(version) * 8 + getRemainderBits(version), `v${version} count`);
      // Everything not visited is a function module.
      let functionCount = 0;
      for (const row of template.isFunction) for (const f of row) if (f) functionCount++;
      assert.equal(functionCount + count, template.size * template.size);
    }
  });

  test('the walk starts at the bottom-right corner and goes up the rightmost column pair', () => {
    const positions = [...dataModulePositions(createMatrix(1))];
    assert.deepEqual(positions.slice(0, 4), [[20, 20], [20, 19], [19, 20], [19, 19]]);
  });

  test('format and version information positions are exported for the reader', () => {
    assert.equal(formatInfoPositions(21).length, 15);
    assert.deepEqual(formatInfoPositions(21)[0], [[0, 8], [8, 20]]);
    assert.equal(versionInfoPositions(45).length, 18);
    assert.deepEqual(versionInfoPositions(45)[0], [[0, 34], [34, 0]]);
  });
});

describe('readMatrix: round trips through the encoder', () => {
  test('every version 1..40, every level and every mode (mask forced to spread over all eight)', () => {
    for (let version = 1; version <= 40; version++) {
      for (const [i, ecc] of LEVELS.entries()) {
        for (const [j, mode] of MODES.entries()) {
          const text = sampleText(mode, version, ecc);
          const mask = (version + i + j) % 8;
          const qr = encode(text, { version, ecc, mask });
          assert.equal(qr.mode, mode, `v${version}-${ecc} ${mode}: sample text is not ${mode}`);
          const result = readMatrix(qr.matrix);
          assert.equal(result.text, text, `v${version}-${ecc} ${mode}`);
          assert.equal(result.version, version);
          assert.equal(result.ecc, ecc);
          assert.equal(result.mask, mask);
          assert.equal(result.errorsCorrected, 0);
          assert.equal(result.formatBitErrors, 0);
          assert.equal(result.versionBitErrors, version >= 7 ? 0 : null);
          assert.deepEqual(result.segments, [{ mode, count: mode === 'byte' ? new TextEncoder().encode(text).length : text.length }]);
        }
      }
    }
  });

  test('all eight masks on a spread of versions and levels', () => {
    for (const version of [1, 2, 3, 6, 7, 10, 14, 21, 26, 27, 35, 40]) {
      for (const ecc of LEVELS) {
        for (let mask = 0; mask < 8; mask++) {
          const text = sampleText('alphanumeric', version, ecc, 0.5);
          const result = readMatrix(encode(text, { version, ecc, mask }).matrix);
          assert.equal(result.text, text, `v${version}-${ecc} mask ${mask}`);
          assert.equal(result.mask, mask);
        }
      }
    }
  });

  test('the automatically chosen mask (the normal encoder path) and tiny and full symbols', () => {
    for (const text of ['1', 'A', 'a', '0'.repeat(7089), 'A'.repeat(4296), 'z'.repeat(2953)]) {
      const qr = encode(text, { ecc: 'L' });
      const result = readMatrix(qr.matrix);
      assert.equal(result.text, text);
      assert.equal(result.mask, qr.mask);
      assert.equal(result.version, qr.version);
    }
  });

  test('the result shape', () => {
    const qr = encode('HELLO WORLD', { ecc: 'Q' });
    const result = readMatrix(qr.matrix);
    assert.deepEqual(result, {
      text: 'HELLO WORLD',
      version: qr.version,
      ecc: 'Q',
      mask: qr.mask,
      errorsCorrected: 0,
      formatBitErrors: 0,
      versionBitErrors: null,
      segments: [{ mode: 'alphanumeric', count: 11 }],
      encoding: null,
      eci: null,
    });
  });

  test('control characters and escape sequences survive a full matrix round trip', () => {
    const hostile = '\u001b[2J\u001b]0;title\u0007\r\n‮\u0000tail';
    const result = readMatrix(encode(hostile).matrix);
    assert.equal(result.text, hostile);
    assert.equal(result.encoding, 'utf-8');
  });

  test('agrees with jsQR on the same matrices', () => {
    for (const version of [1, 4, 9, 15, 25, 40]) {
      for (const ecc of LEVELS) {
        const text = sampleText('byte', version, ecc, 0.6);
        const matrix = encode(text, { version, ecc }).matrix;
        const ours = readMatrix(matrix);
        const reference = decodeMatrix(matrix);
        assert.ok(reference, `jsQR could not read v${version}-${ecc}`);
        assert.equal(ours.text, reference.data, `v${version}-${ecc}`);
        assert.equal(ours.version, reference.version);
      }
    }
  });

  test('accepts 0/1 rows (Uint8Array) as well as booleans', () => {
    const qr = encode('123456', { ecc: 'M' });
    const numeric = qr.matrix.map((row) => Uint8Array.from(row, (v) => (v ? 1 : 0)));
    assert.equal(readMatrix(numeric).text, '123456');
  });
});

/**
 * Where each interleaved codeword comes from: an array of {block, index}
 * following the encoder's interleaving (data columns across blocks, then
 * EC columns), independently re-derived here from the block layout.
 */
function interleaveMap(layout) {
  const lengths = [];
  for (let i = 0; i < layout.group1.count; i++) lengths.push(layout.group1.dataPerBlock);
  for (let i = 0; i < layout.group2.count; i++) lengths.push(layout.group2.dataPerBlock);
  const map = [];
  const longest = Math.max(...lengths);
  for (let i = 0; i < longest; i++) {
    for (let b = 0; b < lengths.length; b++) if (i < lengths[b]) map.push({ block: b, index: i });
  }
  for (let i = 0; i < layout.ecPerBlock; i++) {
    for (let b = 0; b < lengths.length; b++) map.push({ block: b, index: lengths[b] + i });
  }
  return map;
}

/** Flip one bit of the given interleaved codewords in a copy of the symbol. */
function damageCodewords(matrix, version, codewordIndexes, next) {
  const copy = copyMatrix(matrix);
  const positions = [...dataModulePositions(createMatrix(version))];
  for (const codeword of codewordIndexes) {
    const [row, col] = positions[codeword * 8 + next(8)];
    copy[row][col] = !copy[row][col];
  }
  return copy;
}

describe('readMatrix: error correction', () => {
  test('t damaged codewords in every block are corrected and counted exactly', () => {
    for (const version of [1, 2, 5, 7, 10, 13, 20, 27, 34, 40]) {
      for (const ecc of LEVELS) {
        const text = sampleText('byte', version, ecc, 0.7);
        const qr = encode(text, { version, ecc });
        const layout = getBlockLayout(version, ecc);
        const t = Math.floor(layout.ecPerBlock / 2);
        const map = interleaveMap(layout);
        const next = rng(version * 100 + ecc.charCodeAt(0));
        const chosen = [];
        for (let b = 0; b < layout.numBlocks; b++) {
          const candidates = map.map((m, i) => (m.block === b ? i : -1)).filter((i) => i >= 0);
          const picked = new Set();
          while (picked.size < t) picked.add(candidates[next(candidates.length)]);
          chosen.push(...picked);
        }
        const result = readMatrix(damageCodewords(qr.matrix, version, chosen, next));
        assert.equal(result.text, text, `v${version}-${ecc}`);
        assert.equal(result.errorsCorrected, t * layout.numBlocks, `v${version}-${ecc}`);
      }
    }
  });

  test('t + 1 damaged codewords in one block are refused with TooManyErrorsError', () => {
    for (const version of [1, 3, 8, 19, 40]) {
      for (const ecc of LEVELS) {
        const qr = encode(sampleText('numeric', version, ecc), { version, ecc });
        const layout = getBlockLayout(version, ecc);
        const t = Math.floor(layout.ecPerBlock / 2);
        const map = interleaveMap(layout);
        const lastBlock = layout.numBlocks - 1;
        const candidates = map.map((m, i) => (m.block === lastBlock ? i : -1)).filter((i) => i >= 0);
        const next = rng(version * 7 + ecc.charCodeAt(0));
        const picked = new Set();
        while (picked.size < t + 1) picked.add(candidates[next(candidates.length)]);
        assert.throws(() => readMatrix(damageCodewords(qr.matrix, version, [...picked], next)), TooManyErrorsError, `v${version}-${ecc}`);
      }
    }
  });

  test('random module damage is either corrected exactly or refused, never returned wrong', () => {
    let corrected = 0;
    let refused = 0;
    for (const version of [1, 2, 4, 6, 9, 12]) {
      for (const ecc of LEVELS) {
        const text = sampleText('alphanumeric', version, ecc, 0.9);
        const qr = encode(text, { version, ecc });
        const template = createMatrix(version);
        const size = getSize(version);
        for (let seed = 1; seed <= 6; seed++) {
          const next = rng(seed * 1000 + version * 10 + ecc.charCodeAt(0));
          const flips = 1 + next(size); // from a single module up to one module per row
          const copy = copyMatrix(qr.matrix);
          let flipped = 0;
          for (let guard = 0; flipped < flips && guard < 10000; guard++) {
            const row = next(size);
            const col = next(size);
            if (template.isFunction[row][col]) continue;
            copy[row][col] = !copy[row][col];
            flipped++;
          }
          try {
            const result = readMatrix(copy);
            assert.equal(result.text, text, `v${version}-${ecc} seed ${seed}: wrong text returned`);
            assert.ok(result.errorsCorrected >= 1 && result.errorsCorrected <= flips, `v${version}-${ecc} seed ${seed}: corrected ${result.errorsCorrected} of ${flips} flips`);
            corrected++;
          } catch (err) {
            assert.ok(err instanceof TooManyErrorsError, `v${version}-${ecc} seed ${seed}: ${err.name}: ${err.message}`);
            refused++;
          }
        }
      }
    }
    assert.ok(corrected > 0 && refused > 0, `corrected ${corrected}, refused ${refused}: both outcomes should occur`);
  });
});

/** Flip the listed bits of one copy (0 or 1) of the format information. */
function damageFormat(matrix, copyIndex, bits) {
  const copy = copyMatrix(matrix);
  const positions = formatInfoPositions(matrix.length);
  for (const bit of bits) {
    const [row, col] = positions[bit][copyIndex];
    copy[row][col] = !copy[row][col];
  }
  return copy;
}

describe('readMatrix: format and version information', () => {
  const qr = encode('format information', { ecc: 'H', mask: 5 });

  test('up to 3 wrong bits in one copy are corrected and reported', () => {
    for (const copyIndex of [0, 1]) {
      for (const bits of [[0], [14], [3, 9], [1, 7, 12]]) {
        const result = readMatrix(damageFormat(qr.matrix, copyIndex, bits));
        assert.equal(result.text, 'format information');
        assert.equal(result.mask, 5);
        assert.equal(result.ecc, 'H');
        // The other copy is intact, so the best reading has no errors.
        assert.equal(result.formatBitErrors, 0, `copy ${copyIndex} bits ${bits}`);
      }
    }
  });

  test('the same 3 wrong bits in both copies are still corrected, and the error count is 3', () => {
    const damaged = damageFormat(damageFormat(qr.matrix, 0, [2, 5, 11]), 1, [2, 5, 11]);
    const result = readMatrix(damaged);
    assert.equal(result.text, 'format information');
    assert.equal(result.formatBitErrors, 3);
  });

  test('one copy destroyed does not matter; both destroyed is FormatUnreadableError', () => {
    const all = Array.from({ length: 15 }, (_, i) => i);
    for (const copyIndex of [0, 1]) {
      const result = readMatrix(damageFormat(qr.matrix, copyIndex, all.filter((i) => i % 2 === 0)));
      assert.equal(result.text, 'format information');
    }
    const both = damageFormat(damageFormat(qr.matrix, 0, all.filter((i) => i % 2 === 0)), 1, all.filter((i) => i % 3 !== 1));
    assert.throws(() => readMatrix(both), FormatUnreadableError);
  });

  test('version information: damage is reported, both copies destroyed is FormatUnreadableError', () => {
    const big = encode(sampleText('byte', 12, 'M'), { version: 12, ecc: 'M' });
    const positions = versionInfoPositions(big.size);
    const flipVersion = (matrix, copyIndex, bits) => {
      const copy = copyMatrix(matrix);
      for (const bit of bits) {
        const [row, col] = positions[bit][copyIndex];
        copy[row][col] = !copy[row][col];
      }
      return copy;
    };
    assert.equal(readMatrix(flipVersion(big.matrix, 0, [0, 8, 17])).versionBitErrors, 0, 'other copy intact');
    const bothDamaged = flipVersion(flipVersion(big.matrix, 0, [4, 9]), 1, [4, 9]);
    const result = readMatrix(bothDamaged);
    assert.equal(result.versionBitErrors, 2);
    assert.equal(result.version, 12);
    const many = Array.from({ length: 18 }, (_, i) => i).filter((i) => i % 2 === 0);
    assert.throws(
      () => readMatrix(flipVersion(flipVersion(big.matrix, 0, many), 1, many)),
      (err) => err instanceof FormatUnreadableError && /version information/i.test(err.message),
    );
  });

  test('version information that decodes to a different version than the size is refused', () => {
    // Overwrite v12's version bits with v13's in both copies.
    const big = encode(sampleText('byte', 12, 'M'), { version: 12, ecc: 'M' });
    const other = createMatrix(13);
    const copy = copyMatrix(big.matrix);
    for (const [bitPositions, source] of [[versionInfoPositions(big.size), versionInfoPositions(other.size)]]) {
      for (let bit = 0; bit < 18; bit++) {
        for (const c of [0, 1]) {
          const [sr, sc] = source[bit][c];
          const [dr, dc] = bitPositions[bit][c];
          copy[dr][dc] = other.modules[sr][sc];
        }
      }
    }
    assert.throws(() => readMatrix(copy), (err) => err instanceof FormatUnreadableError && /version information/i.test(err.message));
  });
});

describe('readMatrix: invalid and hostile matrices', () => {
  test('sizes that are not 17 + 4v, non-square or empty input are QrDecodeErrors', () => {
    for (const size of [0, 1, 16, 20, 22, 178, 181]) {
      const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
      assert.throws(() => readMatrix(matrix), QrDecodeError, `size ${size}`);
    }
    assert.throws(() => readMatrix([[false, true], [true]]), QrDecodeError);
    assert.throws(() => readMatrix('nope'), QrDecodeError);
    assert.throws(() => readMatrix(null), QrDecodeError);
  });

  test('all-light, all-dark and random matrices of every size fail cleanly and quickly', () => {
    const started = performance.now();
    for (let version = 1; version <= 40; version++) {
      const size = getSize(version);
      const light = Array.from({ length: size }, () => new Array(size).fill(false));
      const dark = Array.from({ length: size }, () => new Array(size).fill(true));
      assert.throws(() => readMatrix(light), QrDecodeError, `v${version} light`);
      assert.throws(() => readMatrix(dark), QrDecodeError, `v${version} dark`);
      for (let seed = 1; seed <= 3; seed++) {
        const next = rng(version * 31 + seed);
        const noise = Array.from({ length: size }, () => Array.from({ length: size }, () => next(2) === 1));
        assert.throws(() => readMatrix(noise), QrDecodeError, `v${version} noise ${seed}`);
      }
    }
    assert.ok(performance.now() - started < 5000);
  });

  test('a valid symbol whose data area is replaced by noise is refused, not decoded', () => {
    const qr = encode('real data', { ecc: 'L' });
    const template = createMatrix(qr.version);
    for (let seed = 1; seed <= 10; seed++) {
      const next = rng(seed);
      const copy = copyMatrix(qr.matrix);
      for (let r = 0; r < qr.size; r++) for (let c = 0; c < qr.size; c++) if (!template.isFunction[r][c]) copy[r][c] = next(2) === 1;
      assert.throws(() => readMatrix(copy), TooManyErrorsError, `seed ${seed}`);
    }
  });
});
