import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSvg } from '../src/render/svg.js';
import { encode } from '../src/core/qr.js';

const T = true;
const F = false;

describe('renderSvg', () => {
  test('a single dark module, no margin, scale 10', () => {
    const svg = renderSvg([[T]], { margin: 0, scale: 10 });
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), svg);
    assert.ok(svg.trimEnd().endsWith('</svg>'));
    assert.match(svg, /width="10" height="10"/);
    assert.match(svg, /viewBox="0 0 1 1"/);
    assert.match(svg, /<rect width="1" height="1" fill="#ffffff"\/>/);
    assert.match(svg, /<path fill="#000000" d="M0 0h1v1h-1z"\/>/);
  });

  test('horizontal runs of dark modules are merged into one path command', () => {
    const svg = renderSvg([[T, T], [F, T]], { margin: 0 });
    assert.match(svg, /d="M0 0h2v1h-2zM1 1h1v1h-1z"/);
  });

  test('margin shifts the drawing and grows the canvas; scale only affects width/height', () => {
    const svg = renderSvg([[T]], { margin: 4, scale: 3 });
    assert.match(svg, /width="27" height="27"/);
    assert.match(svg, /viewBox="0 0 9 9"/);
    assert.match(svg, /d="M4 4h1v1h-1z"/);
  });

  test('colours are normalised to #rrggbb', () => {
    const svg = renderSvg([[T]], { fg: 'F00', bg: '#0f0' });
    assert.match(svg, /<rect [^>]*fill="#00ff00"/);
    assert.match(svg, /<path fill="#ff0000"/);
  });

  test('uses crisp edges so modules never blur', () => {
    assert.match(renderSvg([[T]]), /shape-rendering="crispEdges"/);
  });

  test('a real QR code: one path command per run, nothing outside the canvas', () => {
    const qr = encode('svg test');
    const svg = renderSvg(qr.matrix, { margin: 2, scale: 1 });
    const commands = svg.match(/M(\d+) (\d+)h(\d+)v1h-\3z/g);
    assert.ok(commands.length > 50);
    for (const cmd of commands) {
      const [, x, y, w] = cmd.match(/M(\d+) (\d+)h(\d+)/).map(Number);
      assert.ok(x >= 2 && y >= 2 && x + w <= qr.size + 2 && y < qr.size + 2, cmd);
    }
  });

  test('validation', () => {
    assert.throws(() => renderSvg([[T]], { scale: 0 }), RangeError);
    assert.throws(() => renderSvg([[T]], { margin: -1 }), RangeError);
    assert.throws(() => renderSvg([[T]], { fg: 'blue' }), RangeError);
  });
});
