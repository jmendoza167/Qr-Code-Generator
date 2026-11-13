// Reed-Solomon error CORRECTION for one block: syndromes, Berlekamp-Massey,
// Chien search and Forney, on top of the encoder's GF(256). The encoder's
// computeEcc is the oracle: a block it produced, damaged in up to t = ec/2
// positions, must come back byte for byte, and anything worse must be
// refused rather than "corrected" into something else.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { correctBlock } from '../src/decode/rs-decode.js';
import { computeEcc } from '../src/core/reed-solomon.js';
import { QrDecodeError, TooManyErrorsError } from '../src/decode/errors.js';

/** Deterministic pseudo-random integers in [0, n). */
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

/** A full block (data followed by its EC codewords) with pseudo-random data. */
function makeBlock(dataLength, ecCount, seed) {
  const next = rng(seed);
  const data = Uint8Array.from({ length: dataLength }, () => next(256));
  const block = new Uint8Array(dataLength + ecCount);
  block.set(data);
  block.set(computeEcc(data, ecCount), dataLength);
  return block;
}

/** Corrupt `count` distinct positions of a copy of `block` with values that differ from the original. */
function damage(block, count, seed) {
  const next = rng(seed);
  const copy = Uint8Array.from(block);
  const positions = new Set();
  while (positions.size < count) positions.add(next(block.length));
  for (const p of positions) copy[p] ^= 1 + next(255);
  return { copy, positions: [...positions].sort((a, b) => a - b) };
}

// (data codewords, EC codewords) of real blocks: 1-L, 1-M, 1-Q, 1-H, 5-Q, 10-H, 40-L, 40-H.
const LAYOUTS = [
  [19, 7],
  [16, 10],
  [13, 13],
  [9, 17],
  [15, 18],
  [15, 28],
  [119, 30],
  [16, 30],
];

describe('correctBlock: clean and correctable blocks', () => {
  test('a clean block comes back unchanged with 0 corrections', () => {
    for (const [dataLength, ecCount] of LAYOUTS) {
      const block = makeBlock(dataLength, ecCount, 1);
      const result = correctBlock(block, ecCount);
      assert.deepEqual(result.codewords, block);
      assert.equal(result.corrected, 0);
      assert.notEqual(result.codewords, block, 'returns a copy, never the caller\'s buffer');
    }
  });

  test('every single position, data or EC, is correctable on its own', () => {
    const [dataLength, ecCount] = [16, 10];
    const block = makeBlock(dataLength, ecCount, 2);
    for (let p = 0; p < block.length; p++) {
      for (const xor of [0x01, 0x80, 0xff, 0x5a]) {
        const copy = Uint8Array.from(block);
        copy[p] ^= xor;
        const result = correctBlock(copy, ecCount);
        assert.deepEqual(result.codewords, block, `position ${p} xor ${xor}`);
        assert.equal(result.corrected, 1, `position ${p} xor ${xor}`);
      }
    }
  });

  test('up to t = floor(ec / 2) errors at random positions are corrected, and the count is exact', () => {
    for (const [dataLength, ecCount] of LAYOUTS) {
      const t = Math.floor(ecCount / 2);
      for (let errors = 1; errors <= t; errors++) {
        for (let seed = 1; seed <= 12; seed++) {
          const block = makeBlock(dataLength, ecCount, seed * 7919);
          const { copy } = damage(block, errors, seed * 104729 + errors);
          const result = correctBlock(copy, ecCount);
          assert.deepEqual(result.codewords, block, `${dataLength}+${ecCount}: ${errors} errors, seed ${seed}`);
          assert.equal(result.corrected, errors, `${dataLength}+${ecCount}: ${errors} errors, seed ${seed}`);
        }
      }
    }
  });

  test('a burst of t consecutive errors at the start, middle and end of the block', () => {
    for (const [dataLength, ecCount] of LAYOUTS) {
      const t = Math.floor(ecCount / 2);
      const block = makeBlock(dataLength, ecCount, 99);
      for (const start of [0, Math.floor(block.length / 2), block.length - t]) {
        const copy = Uint8Array.from(block);
        for (let i = 0; i < t; i++) copy[start + i] ^= 0xa5;
        const result = correctBlock(copy, ecCount);
        assert.deepEqual(result.codewords, block, `${dataLength}+${ecCount} burst at ${start}`);
        assert.equal(result.corrected, t);
      }
    }
  });

  test('the input is not modified', () => {
    const block = makeBlock(19, 7, 5);
    const { copy } = damage(block, 3, 6);
    const snapshot = Uint8Array.from(copy);
    correctBlock(copy, 7);
    assert.deepEqual(copy, snapshot);
  });
});

describe('correctBlock: too many errors', () => {
  test('t + 1 errors and more are refused with TooManyErrorsError, never mis-corrected', () => {
    // With more than t errors a Reed-Solomon decoder can in principle land on
    // a different valid codeword. The seeds below are fixed, and any
    // mis-correction they produce is a real finding, not noise.
    for (const [dataLength, ecCount] of LAYOUTS) {
      const t = Math.floor(ecCount / 2);
      for (const errors of [t + 1, t + 2, 2 * t, Math.min(dataLength + ecCount, 3 * t), dataLength + ecCount]) {
        for (let seed = 1; seed <= 8; seed++) {
          const block = makeBlock(dataLength, ecCount, seed * 31);
          const { copy } = damage(block, errors, seed * 37 + errors);
          assert.throws(
            () => correctBlock(copy, ecCount),
            (err) => {
              assert.ok(err instanceof TooManyErrorsError, `${dataLength}+${ecCount}: ${errors} errors, seed ${seed}: ${err.name}: ${err.message}`);
              assert.ok(err instanceof QrDecodeError);
              assert.match(err.message, /too many errors/i);
              return true;
            },
            `${dataLength}+${ecCount}: ${errors} errors, seed ${seed} was not refused`,
          );
        }
      }
    }
  });

  test('a block that is all zeros except the EC part is refused, not returned', () => {
    const block = makeBlock(19, 7, 11);
    const copy = Uint8Array.from(block);
    copy.fill(0, 0, 19);
    assert.throws(() => correctBlock(copy, 7), TooManyErrorsError);
  });

  test('random bytes are refused', () => {
    const next = rng(4242);
    for (let i = 0; i < 20; i++) {
      const junk = Uint8Array.from({ length: 26 }, () => next(256));
      assert.throws(() => correctBlock(junk, 7), TooManyErrorsError, `junk ${i}`);
    }
  });
});

describe('correctBlock: argument checks', () => {
  test('the EC count must leave room for at least one data codeword', () => {
    assert.throws(() => correctBlock(new Uint8Array(7), 7), RangeError);
    assert.throws(() => correctBlock(new Uint8Array(10), 0), RangeError);
    assert.throws(() => correctBlock(new Uint8Array(10), -1), RangeError);
    assert.throws(() => correctBlock(new Uint8Array(10), 2.5), RangeError);
  });

  test('the error list says which positions were corrected', () => {
    const block = makeBlock(16, 10, 77);
    const { copy, positions } = damage(block, 4, 78);
    const result = correctBlock(copy, 10);
    assert.deepEqual(result.positions, positions);
  });
});
