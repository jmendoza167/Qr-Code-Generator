import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg, embedSvgLogo } from '../src/render/svg-sanitize.js';

const LOGO = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- a comment -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 50" width="200" height="100" onload="alert(1)">
  <script>alert('x')</script>
  <script type="text/javascript" src="https://evil.example/x.js"></script>
  <style>@import url("https://evil.example/a.css"); .a { fill: red; }</style>
  <circle cx="25" cy="25" r="20" fill="#f00" onclick="steal()" />
  <rect x="50" y="10" width="40" height="30" style="fill:url(https://evil.example/p.png);stroke:#000"/>
  <image href="https://evil.example/track.gif" width="1" height="1"/>
  <image xlink:href="data:image/png;base64,AAAA" width="10" height="10"/>
  <use href="#part"/>
  <a href="javascript:alert(1)"><text x="5" y="45">hi</text></a>
  <foreignObject width="10" height="10"><div>html</div></foreignObject>
</svg>`;

describe('sanitizeSvg', () => {
  const result = sanitizeSvg(LOGO);

  test('keeps the drawing and the aspect ratio from the viewBox', () => {
    assert.match(result.inner, /<circle cx="25" cy="25" r="20" fill="#f00"\s*\/>/);
    assert.match(result.inner, /<rect x="50" y="10" width="40" height="30"/);
    assert.match(result.inner, /<text x="5" y="45">hi<\/text>/);
    assert.deepEqual(result.viewBox, [0, 0, 100, 50]);
    assert.equal(result.aspect, 2);
  });

  test('removes scripts, event handlers and foreignObject', () => {
    assert.doesNotMatch(result.inner, /<script/i);
    assert.doesNotMatch(result.inner, /alert/);
    assert.doesNotMatch(result.inner, /\bon\w+=/i);
    assert.doesNotMatch(result.inner, /foreignObject/i);
    assert.doesNotMatch(result.inner, /<div>/);
  });

  test('removes external references but keeps data: URIs and #fragments', () => {
    assert.doesNotMatch(result.inner, /evil\.example/);
    assert.doesNotMatch(result.inner, /javascript:/i);
    assert.doesNotMatch(result.inner, /@import/);
    assert.match(result.inner, /xlink:href="data:image\/png;base64,AAAA"/);
    assert.match(result.inner, /<use href="#part"\s*\/>/);
    assert.match(result.inner, /stroke:#000/);
  });

  test('drops the XML prolog, doctype and comments', () => {
    assert.doesNotMatch(result.inner, /<\?xml|<!DOCTYPE|<!--/);
  });

  test('aspect from width/height when there is no viewBox; square by default', () => {
    const r = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="30px" height="10"><rect width="30" height="10"/></svg>');
    assert.deepEqual(r.viewBox, [0, 0, 30, 10]);
    assert.equal(r.aspect, 3);
    const bare = sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>');
    assert.deepEqual(bare.viewBox, [0, 0, 100, 100]);
    assert.equal(bare.aspect, 1);
  });

  test('rejects text that is not an SVG document', () => {
    assert.throws(() => sanitizeSvg('<html><body>no</body></html>'), /not an SVG/i);
    assert.throws(() => sanitizeSvg(''), /not an SVG/i);
  });
});

describe('embedSvgLogo', () => {
  test('wraps the sanitized content in a nested <svg> positioned at the box', () => {
    const markup = embedSvgLogo(LOGO, { x: 10.5, y: 12.25, w: 8, h: 4 });
    assert.match(markup, /^<svg x="10.5" y="12.25" width="8" height="4" viewBox="0 0 100 50" preserveAspectRatio="xMidYMid meet">/);
    assert.match(markup, /<\/svg>$/);
    assert.doesNotMatch(markup, /<script|onload|evil/);
  });
});
