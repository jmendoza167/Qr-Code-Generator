import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderTerminal } from '../src/render/terminal.js';
import { encode } from '../src/core/qr.js';

const T = true;
const F = false;

describe('renderTerminal: half blocks', () => {
  test('one text row shows two module rows: ▀ top, ▄ bottom, █ both, space neither', () => {
    assert.equal(renderTerminal([[T, F, T, F], [F, T, T, F]], { margin: 0 }), '▀▄█ ');
  });

  test('an odd number of rows pads the last line with a light row', () => {
    assert.equal(renderTerminal([[T], [T], [T]], { margin: 0 }), '█\n▀');
  });

  test('the quiet zone surrounds the symbol with light modules', () => {
    // 1x1 dark module with a 1-module margin -> 3x3 grid -> 2 lines
    assert.equal(renderTerminal([[T]], { margin: 1 }), ' ▄ \n   ');
  });

  test('invert swaps dark and light, including the quiet zone', () => {
    assert.equal(renderTerminal([[T, F], [F, T]], { margin: 0, invert: true }), '▄▀');
    assert.equal(renderTerminal([[T]], { margin: 1, invert: true }), '█▀█\n███');
  });

  test('default margin is 4 and every line has the same width', () => {
    const qr = encode('hi');
    const out = renderTerminal(qr.matrix);
    const lines = out.split('\n');
    assert.equal(lines.length, Math.ceil((qr.size + 8) / 2));
    for (const line of lines) assert.equal([...line].length, qr.size + 8);
  });
});

describe('renderTerminal: ASCII fallback', () => {
  test('uses "##" for dark and two spaces for light, one text row per module row', () => {
    assert.equal(renderTerminal([[T, F], [F, T]], { margin: 0, ascii: true }), '##  \n  ##');
  });

  test('respects margin and invert', () => {
    assert.equal(renderTerminal([[T]], { margin: 1, ascii: true }), '      \n  ##  \n      ');
    assert.equal(renderTerminal([[T]], { margin: 0, ascii: true, invert: true }), '  ');
  });
});

describe('renderTerminal: validation', () => {
  test('rejects a negative margin', () => {
    assert.throws(() => renderTerminal([[T]], { margin: -1 }), RangeError);
  });
});
