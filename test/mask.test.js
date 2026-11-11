import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASK_PATTERNS,
  applyMask,
  penaltyRuns,
  penaltyBlocks,
  penaltyFinderLike,
  penaltyBalance,
  computePenalty,
  chooseMask,
} from '../src/core/mask.js';
import { createMatrix, placeData, drawFormatInfo } from '../src/core/matrix.js';
import { buildCodewords } from '../src/core/blocks.js';

const grid = (rows) => rows.map((r) => [...r].map((ch) => ch === '1'));

describe('mask patterns (Table 10)', () => {
  test('each formula flips the expected modules', () => {
    assert.equal(MASK_PATTERNS[0](0, 0), true);
    assert.equal(MASK_PATTERNS[0](0, 1), false);
    assert.equal(MASK_PATTERNS[1](0, 5), true);
    assert.equal(MASK_PATTERNS[1](1, 0), false);
    assert.equal(MASK_PATTERNS[2](4, 3), true);
    assert.equal(MASK_PATTERNS[2](4, 4), false);
    assert.equal(MASK_PATTERNS[3](1, 2), true);
    assert.equal(MASK_PATTERNS[3](1, 1), false);
    assert.equal(MASK_PATTERNS[4](0, 2), true);
    assert.equal(MASK_PATTERNS[4](2, 0), false);
    assert.equal(MASK_PATTERNS[5](0, 7), true);
    assert.equal(MASK_PATTERNS[5](1, 1), false);
    assert.equal(MASK_PATTERNS[6](1, 1), true); // (1 + 1) % 2 == 0
    assert.equal(MASK_PATTERNS[6](1, 3), false); // (1 + 0) % 2 == 1
    assert.equal(MASK_PATTERNS[7](0, 1), false); // (1 + 0) % 2 == 1
    assert.equal(MASK_PATTERNS[7](1, 3), true); // (0 + 0) % 2 == 0
  });

  test('mask 0 is a checkerboard over the first row', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map((c) => MASK_PATTERNS[0](0, c)), [true, false, true, false, true, false]);
  });
});

describe('applyMask', () => {
  function placedMatrix() {
    const m = createMatrix(1);
    placeData(m, buildCodewords('01234567', 'numeric', 1, 'M'));
    return m;
  }

  test('applying the same mask twice restores the original', () => {
    const m = placedMatrix();
    const before = m.modules.map((r) => r.slice());
    applyMask(m, 3);
    assert.notDeepEqual(m.modules, before);
    applyMask(m, 3);
    assert.deepEqual(m.modules, before);
  });

  test('never changes function modules', () => {
    const m = placedMatrix();
    const before = m.modules.map((r) => r.slice());
    applyMask(m, 0);
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) {
        if (m.isFunction[r][c]) assert.equal(m.modules[r][c], before[r][c]);
      }
    }
  });

  test('flips exactly the data modules the pattern selects', () => {
    const m = placedMatrix();
    const before = m.modules.map((r) => r.slice());
    applyMask(m, 1);
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) {
        if (m.isFunction[r][c]) continue;
        assert.equal(m.modules[r][c], before[r][c] !== MASK_PATTERNS[1](r, c), `(${r},${c})`);
      }
    }
  });
});

describe('penalty rules (section 7.8.3)', () => {
  test('rule 1: runs of 5+ same-colour modules cost 3 + (length - 5), in rows and columns', () => {
    assert.equal(penaltyRuns(grid(['11111'])), 3);
    assert.equal(penaltyRuns(grid(['1111111'])), 5);
    assert.equal(penaltyRuns(grid(['11110'])), 0);
    assert.equal(penaltyRuns(grid(['00000'])), 3); // light runs count too
    assert.equal(penaltyRuns(grid(['1', '1', '1', '1', '1', '1'])), 4); // a column of 6
    assert.equal(penaltyRuns(grid(['1111100000'])), 6); // two runs in one row
  });

  test('rule 2: every 2x2 block of one colour costs 3 (overlapping blocks all count)', () => {
    assert.equal(penaltyBlocks(grid(['11', '11'])), 3);
    assert.equal(penaltyBlocks(grid(['00', '00'])), 3);
    assert.equal(penaltyBlocks(grid(['111', '111'])), 6);
    assert.equal(penaltyBlocks(grid(['111', '111', '111'])), 12);
    assert.equal(penaltyBlocks(grid(['10', '01'])), 0);
  });

  test('rule 3: finder-like 1011101 with 4 light modules on either side costs 40', () => {
    assert.equal(penaltyFinderLike(grid(['10111010000'])), 40);
    assert.equal(penaltyFinderLike(grid(['00001011101'])), 40);
    assert.equal(penaltyFinderLike(grid(['000010111010000'])), 80); // both sides
    assert.equal(penaltyFinderLike(grid(['1011101'])), 0); // no light flank
    assert.equal(penaltyFinderLike(grid(['10111011000'])), 0);
    // vertical
    assert.equal(penaltyFinderLike(grid(['1', '0', '1', '1', '1', '0', '1', '0', '0', '0', '0'])), 40);
  });

  test('rule 4: dark-module proportion, 10 points per 5% step away from 50%', () => {
    assert.equal(penaltyBalance(grid(['10', '01'])), 0); // exactly 50%
    assert.equal(penaltyBalance(grid(['1111111111', '0000000000'])), 0);
    assert.equal(penaltyBalance(grid(['1110000000'])), 30); // 30% -> 4 steps of 5% away, k = 3
    assert.equal(penaltyBalance(grid(['1111111111'])), 90); // 100%
  });

  test('computePenalty is the sum of the four rules', () => {
    const g = grid(['11111', '11111']);
    assert.equal(computePenalty(g), penaltyRuns(g) + penaltyBlocks(g) + penaltyFinderLike(g) + penaltyBalance(g));
  });
});

describe('chooseMask', () => {
  test('picks the mask with the lowest penalty and leaves it applied with its format info', () => {
    const codewords = buildCodewords('HELLO WORLD', 'alphanumeric', 1, 'M');

    // Score all eight masks by hand.
    const scores = [];
    for (let mask = 0; mask < 8; mask++) {
      const m = createMatrix(1);
      placeData(m, codewords);
      applyMask(m, mask);
      drawFormatInfo(m, 'M', mask);
      scores.push(computePenalty(m.modules));
    }
    const best = Math.min(...scores);

    const m = createMatrix(1);
    placeData(m, codewords);
    const result = chooseMask(m, 'M');
    assert.equal(result.penalty, best);
    assert.equal(scores[result.mask], best);
    assert.ok(result.mask >= 0 && result.mask < 8);

    // The matrix now equals "mask applied + format info drawn" for that mask.
    const expected = createMatrix(1);
    placeData(expected, codewords);
    applyMask(expected, result.mask);
    drawFormatInfo(expected, 'M', result.mask);
    assert.deepEqual(m.modules, expected.modules);
  });

  test('can be forced to a specific mask', () => {
    const m = createMatrix(1);
    placeData(m, buildCodewords('HELLO WORLD', 'alphanumeric', 1, 'M'));
    const result = chooseMask(m, 'M', 6);
    assert.equal(result.mask, 6);
  });
});
