import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor } from '../src/render/color.js';

describe('parseColor', () => {
  test('accepts #rrggbb and #rgb, with or without the hash, any case', () => {
    assert.deepEqual(parseColor('#ff8000'), { r: 255, g: 128, b: 0, hex: '#ff8000' });
    assert.deepEqual(parseColor('FF8000'), { r: 255, g: 128, b: 0, hex: '#ff8000' });
    assert.deepEqual(parseColor('#abc'), { r: 0xaa, g: 0xbb, b: 0xcc, hex: '#aabbcc' });
    assert.deepEqual(parseColor('000'), { r: 0, g: 0, b: 0, hex: '#000000' });
  });

  test('rejects anything else with a helpful message', () => {
    for (const bad of ['', '#12', '#12345', 'red', '#gggggg', '#1234567', 12]) {
      assert.throws(() => parseColor(bad), /hex colou?r/i, `input ${JSON.stringify(bad)}`);
    }
  });
});
