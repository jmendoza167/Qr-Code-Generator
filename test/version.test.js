import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSize,
  getTotalCodewords,
  getRemainderBits,
  getBlockLayout,
  getDataCodewords,
} from '../src/core/version.js';
import { ALIGNMENT_POSITIONS } from '../src/core/tables.js';

describe('symbol geometry', () => {
  test('size is 17 + 4 * version', () => {
    assert.equal(getSize(1), 21);
    assert.equal(getSize(2), 25);
    assert.equal(getSize(7), 45);
    assert.equal(getSize(40), 177);
  });

  test('total codewords per version (ISO/IEC 18004 Table 9)', () => {
    assert.equal(getTotalCodewords(1), 26);
    assert.equal(getTotalCodewords(2), 44);
    assert.equal(getTotalCodewords(3), 70);
    assert.equal(getTotalCodewords(7), 196);
    assert.equal(getTotalCodewords(10), 346);
    assert.equal(getTotalCodewords(14), 581);
    assert.equal(getTotalCodewords(40), 3706);
  });

  test('remainder bits left over after the last codeword (Table 1)', () => {
    const expected = { 1: 0, 2: 7, 6: 7, 7: 0, 13: 0, 14: 3, 20: 3, 21: 4, 27: 4, 28: 3, 34: 3, 35: 0, 40: 0 };
    for (const [version, bits] of Object.entries(expected)) {
      assert.equal(getRemainderBits(Number(version)), bits, `version ${version}`);
    }
  });
});

describe('error correction block layout (Table 9)', () => {
  test('1-M: one block, 16 data + 10 EC', () => {
    assert.deepEqual(getBlockLayout(1, 'M'), {
      ecPerBlock: 10,
      numBlocks: 1,
      totalCodewords: 26,
      dataCodewords: 16,
      group1: { count: 1, dataPerBlock: 16 },
      group2: { count: 0, dataPerBlock: 17 },
    });
  });

  test('5-Q: two groups of different block lengths', () => {
    assert.deepEqual(getBlockLayout(5, 'Q'), {
      ecPerBlock: 18,
      numBlocks: 4,
      totalCodewords: 134,
      dataCodewords: 62,
      group1: { count: 2, dataPerBlock: 15 },
      group2: { count: 2, dataPerBlock: 16 },
    });
  });

  test('40-H: 81 blocks, 20 x 15 + 61 x 16', () => {
    const layout = getBlockLayout(40, 'H');
    assert.equal(layout.ecPerBlock, 30);
    assert.equal(layout.numBlocks, 81);
    assert.equal(layout.dataCodewords, 1276);
    assert.deepEqual(layout.group1, { count: 20, dataPerBlock: 15 });
    assert.deepEqual(layout.group2, { count: 61, dataPerBlock: 16 });
  });

  test('data codewords for every version/level: groups add up', () => {
    for (let v = 1; v <= 40; v++) {
      for (const ecc of ['L', 'M', 'Q', 'H']) {
        const l = getBlockLayout(v, ecc);
        const fromGroups = l.group1.count * l.group1.dataPerBlock + l.group2.count * l.group2.dataPerBlock;
        assert.equal(fromGroups, l.dataCodewords, `${v}-${ecc} groups`);
        assert.equal(l.dataCodewords + l.ecPerBlock * l.numBlocks, l.totalCodewords, `${v}-${ecc} total`);
        assert.equal(getDataCodewords(v, ecc), l.dataCodewords);
        assert.ok(l.ecPerBlock >= 7 && l.ecPerBlock <= 30, `${v}-${ecc} ec per block`);
        assert.ok(l.group2.dataPerBlock === l.group1.dataPerBlock + 1);
      }
    }
  });

  test('number of data codewords matches ISO/IEC 18004 Table 7 for all 160 version/level pairs', () => {
    // [L, M, Q, H] per version; this pins both block tables at once because
    // data = total - ecPerBlock * numBlocks.
    const DATA_CODEWORDS = [
      null,
      [19, 16, 13, 9], [34, 28, 22, 16], [55, 44, 34, 26], [80, 64, 48, 36], [108, 86, 62, 46],
      [136, 108, 76, 60], [156, 124, 88, 66], [194, 154, 110, 86], [232, 182, 132, 100], [274, 216, 154, 122],
      [324, 254, 180, 140], [370, 290, 206, 158], [428, 334, 244, 180], [461, 365, 261, 197], [523, 415, 295, 223],
      [589, 453, 325, 253], [647, 507, 367, 283], [721, 563, 397, 313], [795, 627, 445, 341], [861, 669, 485, 385],
      [932, 714, 512, 406], [1006, 782, 568, 442], [1094, 860, 614, 464], [1174, 914, 664, 514], [1276, 1000, 718, 538],
      [1370, 1062, 754, 596], [1468, 1128, 808, 628], [1531, 1193, 871, 661], [1631, 1267, 911, 701], [1735, 1373, 985, 745],
      [1843, 1455, 1033, 793], [1955, 1541, 1115, 845], [2071, 1631, 1171, 901], [2191, 1725, 1231, 961], [2306, 1812, 1286, 986],
      [2434, 1914, 1354, 1054], [2566, 1992, 1426, 1096], [2702, 2102, 1502, 1142], [2812, 2216, 1582, 1222], [2956, 2334, 1666, 1276],
    ];
    for (let v = 1; v <= 40; v++) {
      ['L', 'M', 'Q', 'H'].forEach((ecc, i) => {
        assert.equal(getDataCodewords(v, ecc), DATA_CODEWORDS[v][i], `${v}-${ecc}`);
      });
    }
  });

  test('higher ECC levels never have more data codewords than lower ones', () => {
    for (let v = 1; v <= 40; v++) {
      const [l, m, q, h] = ['L', 'M', 'Q', 'H'].map((e) => getDataCodewords(v, e));
      assert.ok(l > m && m > q && q > h, `version ${v}: ${l} ${m} ${q} ${h}`);
    }
  });

  test('rejects invalid versions and levels', () => {
    assert.throws(() => getBlockLayout(0, 'M'), RangeError);
    assert.throws(() => getBlockLayout(41, 'M'), RangeError);
    assert.throws(() => getBlockLayout(1, 'X'), RangeError);
  });
});

describe('alignment pattern positions (Annex E)', () => {
  test('known rows of the table', () => {
    assert.deepEqual(ALIGNMENT_POSITIONS[1], []);
    assert.deepEqual(ALIGNMENT_POSITIONS[2], [6, 18]);
    assert.deepEqual(ALIGNMENT_POSITIONS[7], [6, 22, 38]);
    assert.deepEqual(ALIGNMENT_POSITIONS[14], [6, 26, 46, 66]);
    assert.deepEqual(ALIGNMENT_POSITIONS[32], [6, 34, 60, 86, 112, 138]);
    assert.deepEqual(ALIGNMENT_POSITIONS[40], [6, 30, 58, 86, 114, 142, 170]);
  });

  test('every version: first is 6, last is size - 7, count is floor(v / 7) + 2, spacing is even', () => {
    for (let v = 2; v <= 40; v++) {
      const p = ALIGNMENT_POSITIONS[v];
      assert.equal(p.length, Math.floor(v / 7) + 2, `version ${v} count`);
      assert.equal(p[0], 6);
      assert.equal(p[p.length - 1], getSize(v) - 7);
      for (let i = 2; i < p.length; i++) {
        assert.equal(p[i] - p[i - 1], p[2] - p[1], `version ${v} spacing`);
        assert.equal((p[i] - p[i - 1]) % 2, 0);
      }
    }
  });
});
