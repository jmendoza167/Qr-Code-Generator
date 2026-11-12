import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSvg } from '../src/render/svg.js';
import { encode } from '../src/core/qr.js';
import { isFinderModule } from '../src/render/style.js';

const qr = encode('styled svg');
const darkOutsideFinders = qr.matrix.flatMap((row, r) => row.filter((d, c) => d && !isFinderModule(qr.size, r, c))).length;

describe('renderSvg with styles', () => {
  test('explicit default style options produce exactly the plain output', () => {
    const plain = renderSvg(qr.matrix, { scale: 5, margin: 3 });
    const styled = renderSvg(qr.matrix, { scale: 5, margin: 3, shape: 'square', finder: 'square', gradientDir: 'radial' });
    assert.equal(styled, plain);
    assert.match(plain, /crispEdges/);
  });

  test('dots: one circle (two arcs) per dark module outside the finders', () => {
    const svg = renderSvg(qr.matrix, { shape: 'dots' });
    const arcs = svg.match(/a0\.45 0\.45 0 1 0/g) ?? [];
    assert.equal(arcs.length, darkOutsideFinders * 2);
    assert.doesNotMatch(svg, /crispEdges/); // curves must be anti-aliased
    assert.match(svg, /viewBox="0 0 29 29"/);
    assert.match(svg, /<rect width="29" height="29" fill="#ffffff"\/>/);
  });

  test('rounded: paths with quarter-circle arcs of radius 0.5', () => {
    const svg = renderSvg(qr.matrix, { shape: 'rounded' });
    assert.match(svg, /a0\.5 0\.5 0 0 1/);
  });

  test('finder styles draw a separate evenodd path for the three finders', () => {
    for (const finder of ['square', 'rounded', 'circle']) {
      const svg = renderSvg(qr.matrix, { finder, finderColor: '#ff0000' });
      assert.match(svg, /<path fill="#ff0000" fill-rule="evenodd" d="/, finder);
      assert.match(svg, /<path fill="#000000" d="/);
    }
    const circle = renderSvg(qr.matrix, { finder: 'circle' });
    assert.match(circle, /a3\.5 3\.5 0 1 0/);
    assert.match(circle, /a1\.5 1\.5 0 1 0/);
  });

  test('--finder-color alone keeps square geometry but splits finders out of the data path', () => {
    const svg = renderSvg(qr.matrix, { finderColor: '#336699' });
    assert.match(svg, /<path fill="#336699" fill-rule="evenodd" d="M4 4h7v7h-7zM5 5h5v5h-5z/);
    assert.match(svg, /M6 6h3v3h-3z/);
  });

  test('coordinates include the margin', () => {
    const svg = renderSvg(qr.matrix, { shape: 'dots', margin: 2 });
    // top-left finder is drawn as rings starting at the margin offset
    assert.match(svg, /M2 2h7v7h-7z/);
  });

  test('linear gradient: defs with two stops, data and finders filled with url(#...)', () => {
    const svg = renderSvg(qr.matrix, { gradient: '#ff0000,#0000ff', gradientDir: 'horizontal' });
    assert.match(svg, /<linearGradient id="qr-gradient" gradientUnits="userSpaceOnUse" x1="4" y1="4" x2="25" y2="4">/);
    assert.match(svg, /<stop offset="0" stop-color="#ff0000"\/>/);
    assert.match(svg, /<stop offset="1" stop-color="#0000ff"\/>/);
    assert.match(svg, /<path fill="url\(#qr-gradient\)" d="/);
    assert.match(svg, /<path fill="url\(#qr-gradient\)" fill-rule="evenodd" d="/);
  });

  test('vertical and diagonal gradient vectors; radial gradient reaches the corners', () => {
    assert.match(renderSvg(qr.matrix, { gradient: '#000,#fff', gradientDir: 'vertical' }), /x1="4" y1="4" x2="4" y2="25"/);
    assert.match(renderSvg(qr.matrix, { gradient: '#000,#fff', gradientDir: 'diagonal' }), /x1="4" y1="4" x2="25" y2="25"/);
    assert.match(
      renderSvg(qr.matrix, { gradient: '#000,#fff', gradientDir: 'radial' }),
      /<radialGradient id="qr-gradient" gradientUnits="userSpaceOnUse" cx="14.5" cy="14.5" r="14.849">/,
    );
  });

  test('finder colour wins over the gradient for the finders only', () => {
    const svg = renderSvg(qr.matrix, { gradient: '#ff0000,#0000ff', finderColor: '#00ff00' });
    assert.match(svg, /<path fill="url\(#qr-gradient\)" d="/);
    assert.match(svg, /<path fill="#00ff00" fill-rule="evenodd" d="/);
  });

  test('invalid style options throw', () => {
    assert.throws(() => renderSvg(qr.matrix, { shape: 'triangle' }), RangeError);
    assert.throws(() => renderSvg(qr.matrix, { gradient: 'red,blue' }), RangeError);
  });
});
