import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMatrix, placeData, drawFormatInfo } from '../src/core/matrix.js';
import { getRawDataModules, getSize, getTotalCodewords, getRemainderBits } from '../src/core/version.js';
import { formatBits } from '../src/core/format.js';

function countNonFunction(m) {
  let n = 0;
  for (const row of m.isFunction) for (const f of row) if (!f) n++;
  return n;
}

function countDark(m) {
  let n = 0;
  for (const row of m.modules) for (const d of row) if (d) n++;
  return n;
}

describe('function patterns', () => {
  test('finder patterns: 7x7 with a light ring, plus a light separator', () => {
    const m = createMatrix(1);
    // top-left finder, row 0 is fully dark, (1,1) is in the light ring, (3,3) is the centre
    for (let c = 0; c < 7; c++) assert.equal(m.modules[0][c], true);
    assert.equal(m.modules[1][1], false);
    assert.equal(m.modules[2][2], true);
    assert.equal(m.modules[3][3], true);
    assert.equal(m.modules[4][4], true);
    assert.equal(m.modules[5][5], false);
    assert.equal(m.modules[6][6], true);
    // separators are light and reserved
    for (let i = 0; i < 8; i++) {
      assert.equal(m.modules[7][i], false);
      assert.equal(m.isFunction[7][i], true);
      assert.equal(m.modules[i][7], false);
      assert.equal(m.isFunction[i][7], true);
    }
    // the other two finders
    assert.equal(m.modules[0][20], true);
    assert.equal(m.modules[1][19], false);
    assert.equal(m.modules[20][0], true);
    assert.equal(m.modules[19][1], false);
    assert.equal(m.modules[13][7], false); // separator above the bottom-left finder
    assert.equal(m.isFunction[13][7], true);
  });

  test('timing patterns alternate dark/light along row 6 and column 6, starting dark', () => {
    const m = createMatrix(2);
    for (let i = 8; i < 25 - 8; i++) {
      assert.equal(m.modules[6][i], i % 2 === 0, `row 6, col ${i}`);
      assert.equal(m.modules[i][6], i % 2 === 0, `col 6, row ${i}`);
      assert.equal(m.isFunction[6][i], true);
      assert.equal(m.isFunction[i][6], true);
    }
  });

  test('the dark module at (4 * version + 9, 8) is always dark and reserved', () => {
    for (const v of [1, 2, 7, 40]) {
      const m = createMatrix(v);
      assert.equal(m.modules[4 * v + 9][8], true);
      assert.equal(m.isFunction[4 * v + 9][8], true);
    }
  });

  test('version 1 has no alignment pattern, version 2 has one centred at (18, 18)', () => {
    const m1 = createMatrix(1);
    assert.equal(m1.isFunction[18][18], false);
    const m2 = createMatrix(2);
    assert.equal(m2.modules[18][18], true);
    assert.equal(m2.modules[17][17], false);
    assert.equal(m2.modules[17][18], false);
    assert.equal(m2.modules[16][16], true);
    assert.equal(m2.modules[16][20], true);
    assert.equal(m2.modules[20][16], true);
    for (let r = 16; r <= 20; r++) for (let c = 16; c <= 20; c++) assert.equal(m2.isFunction[r][c], true);
  });

  test('version 7: alignment patterns at all grid points except the three finder corners', () => {
    const m = createMatrix(7);
    const centres = [6, 22, 38];
    for (const r of centres) {
      for (const c of centres) {
        const isFinderCorner = (r === 6 && c === 6) || (r === 6 && c === 38) || (r === 38 && c === 6);
        if (isFinderCorner) continue;
        assert.equal(m.modules[r][c], true, `centre (${r},${c})`);
        assert.equal(m.modules[r - 1][c], false, `ring (${r - 1},${c})`);
        assert.equal(m.modules[r - 2][c - 2], true, `corner (${r - 2},${c - 2})`);
      }
    }
    // An alignment pattern on the timing row still keeps the timing modules consistent.
    assert.equal(m.modules[6][20], true); // ring corner of pattern at (6,22) = also an even timing column
  });

  test('format information areas are reserved around all three finders', () => {
    const m = createMatrix(1);
    for (let i = 0; i <= 8; i++) {
      assert.equal(m.isFunction[8][i], true, `row 8 col ${i}`);
      assert.equal(m.isFunction[i][8], true, `col 8 row ${i}`);
    }
    for (let i = 13; i < 21; i++) {
      assert.equal(m.isFunction[8][i], true, `row 8 col ${i}`);
      assert.equal(m.isFunction[i][8], true, `col 8 row ${i}`);
    }
    // ...and the module right next to the reserved strip is free for data
    assert.equal(m.isFunction[9][9], false);
    assert.equal(m.isFunction[8][12], false);
  });

  test('version information (v >= 7) is drawn in two 6x3 blocks, with known bits for version 7', () => {
    const m6 = createMatrix(6);
    assert.equal(m6.isFunction[0][41 - 11], false);
    const m = createMatrix(7); // size 45, bits 0x07C94 = 00 0111 1100 1001 0100
    for (let r = 0; r < 6; r++) {
      for (let c = 34; c < 37; c++) {
        assert.equal(m.isFunction[r][c], true, `top-right (${r},${c})`);
        assert.equal(m.isFunction[c][r], true, `bottom-left (${c},${r})`);
        // the two copies are transposes of each other
        assert.equal(m.modules[r][c], m.modules[c][r]);
      }
    }
    // bit i lives at row floor(i/3), col size-11 + i%3 (top-right copy)
    const bits = 0x07c94;
    for (let i = 0; i < 18; i++) {
      assert.equal(m.modules[Math.floor(i / 3)][34 + (i % 3)], ((bits >>> i) & 1) === 1, `bit ${i}`);
    }
  });

  test('number of free (non-function) modules equals the raw data module count for all 40 versions', () => {
    for (let v = 1; v <= 40; v++) {
      const m = createMatrix(v);
      assert.equal(m.size, getSize(v));
      assert.equal(m.modules.length, m.size);
      assert.equal(countNonFunction(m), getRawDataModules(v), `version ${v}`);
    }
  });

  test('function modules are never dark outside reserved areas before placement', () => {
    const m = createMatrix(3);
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) {
        if (!m.isFunction[r][c]) assert.equal(m.modules[r][c], false);
      }
    }
  });
});

describe('data placement (zigzag, section 7.7.3)', () => {
  test('all-ones codewords darken exactly 8 * codewords modules; remainder bits stay light', () => {
    for (const v of [1, 2, 14, 21, 40]) {
      const m = createMatrix(v);
      const darkBefore = countDark(m);
      placeData(m, new Uint8Array(getTotalCodewords(v)).fill(0xff));
      assert.equal(countDark(m) - darkBefore, getTotalCodewords(v) * 8, `version ${v}`);
      // Remainder bits are the modules left light among the free ones.
      assert.equal(countNonFunction(m) - getTotalCodewords(v) * 8, getRemainderBits(v));
    }
  });

  test('the first bits go to the bottom-right corner: right col first, then left, moving up', () => {
    const size = 21;
    const expectOnlyDarkAt = (codewords, row, col) => {
      const m = createMatrix(1);
      placeData(m, codewords);
      for (let r = 9; r < size; r++) {
        for (let c = 9; c < size; c++) {
          assert.equal(m.modules[r][c], r === row && c === col, `(${r},${c})`);
        }
      }
    };
    const cw = (...bytes) => Uint8Array.from({ length: 26 }, (_, i) => bytes[i] ?? 0);
    expectOnlyDarkAt(cw(0b10000000), size - 1, size - 1); // bit 0
    expectOnlyDarkAt(cw(0b01000000), size - 1, size - 2); // bit 1
    expectOnlyDarkAt(cw(0b00100000), size - 2, size - 1); // bit 2
    expectOnlyDarkAt(cw(0b00010000), size - 2, size - 2); // bit 3
  });

  test('after the first column pair is filled upward, the next pair is filled downward', () => {
    const m = createMatrix(1);
    // Column pair (20,19) has 21 - 9 = 12 free rows -> 24 bits. Bit 24 starts pair (18,17) at the top (row 9).
    const bits = new Uint8Array(26);
    bits[3] = 0b10000000; // bit index 24
    placeData(m, bits);
    assert.equal(m.modules[9][18], true);
    assert.equal(m.modules[20][18], false);
  });

  test('placement never touches function modules and skips the timing column', () => {
    const m = createMatrix(3);
    const snapshot = m.modules.map((r) => r.slice());
    placeData(m, new Uint8Array(getTotalCodewords(3)).fill(0xff));
    for (let r = 0; r < m.size; r++) {
      for (let c = 0; c < m.size; c++) {
        if (m.isFunction[r][c]) assert.equal(m.modules[r][c], snapshot[r][c], `(${r},${c})`);
      }
    }
    for (let r = 8; r < m.size - 8; r++) assert.equal(m.modules[r][6], r % 2 === 0);
  });

  test('rejects the wrong number of codewords', () => {
    assert.throws(() => placeData(createMatrix(1), new Uint8Array(25)), RangeError);
  });
});

describe('format information placement (section 7.9, Figure 25)', () => {
  test('bit i is written in both copies in the standard positions', () => {
    const m = createMatrix(1);
    drawFormatInfo(m, 'L', 5);
    const bits = formatBits('L', 5);
    const bit = (i) => ((bits >>> i) & 1) === 1;
    const size = 21;
    // copy 1, around the top-left finder
    for (let i = 0; i <= 5; i++) assert.equal(m.modules[i][8], bit(i), `bit ${i}`);
    assert.equal(m.modules[7][8], bit(6));
    assert.equal(m.modules[8][8], bit(7));
    assert.equal(m.modules[8][7], bit(8));
    for (let i = 9; i <= 14; i++) assert.equal(m.modules[8][14 - i], bit(i), `bit ${i}`);
    // copy 2, split between the top-right and bottom-left finders
    for (let i = 0; i <= 7; i++) assert.equal(m.modules[8][size - 1 - i], bit(i), `bit ${i} copy 2`);
    for (let i = 8; i <= 14; i++) assert.equal(m.modules[size - 15 + i][8], bit(i), `bit ${i} copy 2`);
    assert.equal(m.modules[size - 8][8], true); // the dark module never changes
  });
});
