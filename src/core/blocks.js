/**
 * Splitting data codewords into Reed-Solomon blocks and interleaving them
 * into the final codeword sequence (ISO/IEC 18004 section 7.6).
 *
 * Why blocks and interleaving?
 * ----------------------------
 * A Reed-Solomon block can correct up to ecPerBlock / 2 damaged codewords
 * wherever they are inside the block. Real-world damage (a scratch, a coffee
 * stain) tends to be *localised*, so if a block were stored contiguously a
 * single smudge could wipe out more codewords than it can repair. Splitting
 * the data into several blocks and then interleaving them (first codeword
 * of every block, then the second of every block, ...) spreads each block
 * across the whole symbol: a localised defect now damages a little of every
 * block instead of a lot of one block.
 */
import { computeEcc } from './reed-solomon.js';
import { getBlockLayout } from './version.js';
import { buildDataCodewords } from './encoder.js';

/**
 * Cut the data codewords into blocks and compute the ECC of each one.
 * Group 1 blocks (shorter by one codeword) come first, then group 2.
 *
 * @returns {{ data: Uint8Array, ecc: Uint8Array }[]}
 */
export function splitIntoBlocks(dataCodewords, layout) {
  const blocks = [];
  let offset = 0;
  for (const group of [layout.group1, layout.group2]) {
    for (let i = 0; i < group.count; i++) {
      const data = dataCodewords.subarray(offset, offset + group.dataPerBlock);
      blocks.push({ data, ecc: computeEcc(data, layout.ecPerBlock) });
      offset += group.dataPerBlock;
    }
  }
  return blocks;
}

/**
 * Interleave: data codewords column by column across blocks, then EC
 * codewords the same way. Short (group 1) blocks simply have no entry in the
 * last data column, so that column only takes codewords from the long ones.
 *
 * Example 5-Q with blocks D1..D4 (two of 15, two of 16 codewords):
 *   D1[0] D2[0] D3[0] D4[0]  D1[1] D2[1] D3[1] D4[1] ... D3[15] D4[15]
 *   E1[0] E2[0] E3[0] E4[0]  E1[1] ...                  ... E4[17]
 *
 * @returns {Uint8Array} layout.totalCodewords bytes
 */
export function interleaveBlocks(blocks, layout) {
  const out = new Uint8Array(layout.totalCodewords);
  let n = 0;
  const longest = layout.group2.count > 0 ? layout.group2.dataPerBlock : layout.group1.dataPerBlock;
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) {
      if (i < block.data.length) out[n++] = block.data[i];
    }
  }
  for (let i = 0; i < layout.ecPerBlock; i++) {
    for (const block of blocks) out[n++] = block.ecc[i];
  }
  return out;
}

/** Text -> final interleaved codeword sequence for a fixed version/level. */
export function buildCodewords(text, mode, version, ecc) {
  const layout = getBlockLayout(version, ecc);
  const data = buildDataCodewords(text, mode, version, ecc);
  return interleaveBlocks(splitIntoBlocks(data, layout), layout);
}
