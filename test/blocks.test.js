import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoBlocks, interleaveBlocks, buildCodewords } from '../src/core/blocks.js';
import { computeEcc } from '../src/core/reed-solomon.js';
import { getBlockLayout } from '../src/core/version.js';

describe('block splitting and interleaving (ISO/IEC 18004 section 7.6)', () => {
  // 5-Q: 2 blocks of 15 data codewords, then 2 blocks of 16; 18 EC codewords each.
  const layout = getBlockLayout(5, 'Q');
  const data = Uint8Array.from({ length: 62 }, (_, i) => i);

  test('splits group 1 (short) blocks before group 2 (long) blocks', () => {
    const blocks = splitIntoBlocks(data, layout);
    assert.equal(blocks.length, 4);
    assert.deepEqual(blocks.map((b) => b.data.length), [15, 15, 16, 16]);
    assert.deepEqual([...blocks[0].data], [...data.slice(0, 15)]);
    assert.deepEqual([...blocks[2].data], [...data.slice(30, 46)]);
    assert.deepEqual([...blocks[3].data], [...data.slice(46, 62)]);
    for (const b of blocks) {
      assert.equal(b.ecc.length, 18);
      assert.deepEqual([...b.ecc], [...computeEcc(b.data, 18)]);
    }
  });

  test('interleaves column by column: first codeword of every block, then second, ...', () => {
    const blocks = splitIntoBlocks(data, layout);
    const out = interleaveBlocks(blocks, layout);
    assert.equal(out.length, 134);
    // data part
    assert.deepEqual([...out.slice(0, 4)], [0, 15, 30, 46]);
    assert.deepEqual([...out.slice(4, 8)], [1, 16, 31, 47]);
    // the 16th codeword exists only in the two long blocks
    assert.deepEqual([...out.slice(60, 62)], [45, 61]);
    // ecc part, same scheme
    const ecc = blocks.map((b) => b.ecc);
    assert.deepEqual([...out.slice(62, 66)], [ecc[0][0], ecc[1][0], ecc[2][0], ecc[3][0]]);
    assert.deepEqual([...out.slice(130, 134)], [ecc[0][17], ecc[1][17], ecc[2][17], ecc[3][17]]);
  });

  test('single block (1-M) is just data followed by ECC', () => {
    const cw = buildCodewords('01234567', 'numeric', 1, 'M');
    assert.deepEqual(
      [...cw],
      [
        0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11,
        0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55,
      ],
    );
  });

  test('buildCodewords returns the total codeword count for any version/level', () => {
    assert.equal(buildCodewords('a', 'byte', 5, 'Q').length, 134);
    assert.equal(buildCodewords('a', 'byte', 40, 'H').length, 3706);
  });
});
