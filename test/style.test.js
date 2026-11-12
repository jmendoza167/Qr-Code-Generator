import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStyle,
  buildShapes,
  isFinderModule,
  contrastRatio,
  checkContrast,
  gradientT,
  gradientColor,
  pointInShape,
  shapeBounds,
} from '../src/render/style.js';
import { encode } from '../src/core/qr.js';

const grid = (rows) => rows.map((r) => [...r].map((ch) => ch === '1'));

describe('normalizeStyle', () => {
  test('defaults are the plain black-on-white square style', () => {
    const s = normalizeStyle();
    assert.equal(s.shape, 'square');
    assert.equal(s.finder, 'square');
    assert.equal(s.finderColor, null);
    assert.equal(s.gradient, null);
    assert.equal(s.fg, '#000000');
    assert.equal(s.bg, '#ffffff');
    assert.equal(s.isPlain, true);
  });

  test('any non-default visual option makes the style non-plain', () => {
    assert.equal(normalizeStyle({ shape: 'dots' }).isPlain, false);
    assert.equal(normalizeStyle({ finder: 'circle' }).isPlain, false);
    assert.equal(normalizeStyle({ finderColor: '#f00' }).isPlain, false);
    assert.equal(normalizeStyle({ gradient: '#f00,#00f' }).isPlain, false);
    // colours alone keep the fast 1-bit path: still "plain" geometry
    assert.equal(normalizeStyle({ fg: '#123456', bg: '#abcdef' }).isPlain, true);
  });

  test('gradient accepts "hex1,hex2" or an array, with a direction', () => {
    assert.deepEqual(normalizeStyle({ gradient: 'f00, 00f' }).gradient, {
      from: '#ff0000',
      to: '#0000ff',
      direction: 'diagonal',
    });
    assert.deepEqual(normalizeStyle({ gradient: ['#ff0000', '#0000ff'], gradientDir: 'radial' }).gradient, {
      from: '#ff0000',
      to: '#0000ff',
      direction: 'radial',
    });
  });

  test('validation', () => {
    assert.throws(() => normalizeStyle({ shape: 'hex' }), /shape/);
    assert.throws(() => normalizeStyle({ finder: 'star' }), /finder/);
    assert.throws(() => normalizeStyle({ gradient: '#f00' }), /gradient/);
    assert.throws(() => normalizeStyle({ gradient: '#f00,#00f', gradientDir: 'up' }), /gradient-dir|direction/);
    assert.throws(() => normalizeStyle({ finderColor: 'red' }), /colou?r/);
  });
});

describe('isFinderModule', () => {
  test('the three 7x7 corners of a real symbol, not the separators', () => {
    assert.equal(isFinderModule(21, 0, 0), true);
    assert.equal(isFinderModule(21, 6, 6), true);
    assert.equal(isFinderModule(21, 7, 0), false);
    assert.equal(isFinderModule(21, 0, 7), false);
    assert.equal(isFinderModule(21, 0, 14), true);
    assert.equal(isFinderModule(21, 14, 0), true);
    assert.equal(isFinderModule(21, 14, 14), false);
  });

  test('matrices smaller than a version 1 symbol have no finders (handy for tests)', () => {
    assert.equal(isFinderModule(3, 0, 0), false);
  });
});

describe('buildShapes: data modules', () => {
  const m = grid(['110', '110', '000']);

  test('square: one rect per horizontal run', () => {
    const shapes = buildShapes(m, normalizeStyle({ shape: 'square' }));
    assert.deepEqual(shapes, [
      { kind: 'rect', x: 0, y: 0, w: 2, h: 1, role: 'data' },
      { kind: 'rect', x: 0, y: 1, w: 2, h: 1, role: 'data' },
    ]);
  });

  test('dots: one circle per module', () => {
    const shapes = buildShapes(m, normalizeStyle({ shape: 'dots' }));
    assert.equal(shapes.length, 4);
    assert.deepEqual(shapes[0], { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.45, role: 'data' });
    assert.deepEqual(shapes[3], { kind: 'circle', cx: 1.5, cy: 1.5, r: 0.45, role: 'data' });
  });

  test('rounded: only convex corners of a connected group are rounded', () => {
    const shapes = buildShapes(m, normalizeStyle({ shape: 'rounded' }));
    assert.equal(shapes.length, 4);
    // radii are [top-left, top-right, bottom-right, bottom-left]
    assert.deepEqual(shapes[0], { kind: 'roundedRect', x: 0, y: 0, w: 1, h: 1, radii: [0.5, 0, 0, 0], role: 'data' });
    assert.deepEqual(shapes[1], { kind: 'roundedRect', x: 1, y: 0, w: 1, h: 1, radii: [0, 0.5, 0, 0], role: 'data' });
    assert.deepEqual(shapes[2], { kind: 'roundedRect', x: 0, y: 1, w: 1, h: 1, radii: [0, 0, 0, 0.5], role: 'data' });
    assert.deepEqual(shapes[3], { kind: 'roundedRect', x: 1, y: 1, w: 1, h: 1, radii: [0, 0, 0.5, 0], role: 'data' });
  });

  test('rounded: an isolated module is fully round, interior modules of a run become a plain rect', () => {
    const shapes = buildShapes(grid(['01010', '11111', '00000']), normalizeStyle({ shape: 'rounded' }));
    const isolated = shapes.find((s) => s.y === 0 && s.x === 1);
    assert.deepEqual(isolated.radii, [0.5, 0.5, 0, 0]); // its bottom touches the long run
    const interior = shapes.find((s) => s.kind === 'rect');
    assert.deepEqual(interior, { kind: 'rect', x: 1, y: 1, w: 3, h: 1, role: 'data' });
  });
});

describe('buildShapes: finders', () => {
  const qr = encode('finder styles');
  const darkOutsideFinders = qr.matrix.flatMap((row, r) => row.filter((d, c) => d && !isFinderModule(qr.size, r, c))).length;

  for (const finder of ['square', 'rounded', 'circle']) {
    test(`${finder}: 3 rings + 3 centres, data shapes skip the finder areas`, () => {
      const shapes = buildShapes(qr.matrix, normalizeStyle({ finder, shape: 'dots' }));
      const finders = shapes.filter((s) => s.role === 'finder');
      assert.equal(finders.filter((s) => s.kind === 'ring').length, 3);
      assert.equal(finders.filter((s) => s.kind !== 'ring').length, 3);
      assert.equal(shapes.filter((s) => s.role === 'data').length, darkOutsideFinders);
    });
  }

  test('square finders are rect rings 7/5/3 modules wide at the three corners', () => {
    const shapes = buildShapes(qr.matrix, normalizeStyle({ finder: 'square', finderColor: '#f00' }));
    const rings = shapes.filter((s) => s.kind === 'ring');
    assert.deepEqual(rings[0].outer, { kind: 'rect', x: 0, y: 0, w: 7, h: 7 });
    assert.deepEqual(rings[0].inner, { kind: 'rect', x: 1, y: 1, w: 5, h: 5 });
    const centres = shapes.filter((s) => s.role === 'finder' && s.kind === 'rect');
    assert.deepEqual(
      centres.map((c) => [c.x, c.y, c.w, c.h]).sort(),
      [
        [2, 2, 3, 3],
        [2, 16, 3, 3],
        [16, 2, 3, 3],
      ].sort(),
    );
  });

  test('circle finders are concentric circles of radius 3.5 / 2.5 / 1.5', () => {
    const shapes = buildShapes(qr.matrix, normalizeStyle({ finder: 'circle' }));
    const ring = shapes.find((s) => s.kind === 'ring');
    assert.deepEqual(ring.outer, { kind: 'circle', cx: 3.5, cy: 3.5, r: 3.5 });
    assert.deepEqual(ring.inner, { kind: 'circle', cx: 3.5, cy: 3.5, r: 2.5 });
    assert.deepEqual(
      shapes.find((s) => s.role === 'finder' && s.kind === 'circle'),
      { kind: 'circle', cx: 3.5, cy: 3.5, r: 1.5, role: 'finder' },
    );
  });
});

describe('pointInShape / shapeBounds', () => {
  test('rect: half-open on the far edges', () => {
    const rect = { kind: 'rect', x: 1, y: 1, w: 2, h: 1 };
    assert.equal(pointInShape(rect, 1, 1), true);
    assert.equal(pointInShape(rect, 2.99, 1.5), true);
    assert.equal(pointInShape(rect, 3, 1.5), false);
    assert.equal(pointInShape(rect, 0.99, 1.5), false);
    assert.deepEqual(shapeBounds(rect), { x: 1, y: 1, w: 2, h: 1 });
  });

  test('circle', () => {
    const c = { kind: 'circle', cx: 0.5, cy: 0.5, r: 0.45 };
    assert.equal(pointInShape(c, 0.5, 0.5), true);
    assert.equal(pointInShape(c, 0.5, 0.06), true);
    assert.equal(pointInShape(c, 0.02, 0.02), false); // the square's corner is outside
    const b = shapeBounds(c);
    for (const [key, expected] of Object.entries({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 })) {
      assert.ok(Math.abs(b[key] - expected) < 1e-9, `${key}: ${b[key]}`);
    }
  });

  test('roundedRect: corners with radius are cut, square corners are kept', () => {
    const s = { kind: 'roundedRect', x: 0, y: 0, w: 1, h: 1, radii: [0.5, 0, 0, 0] };
    assert.equal(pointInShape(s, 0.02, 0.02), false); // rounded top-left
    assert.equal(pointInShape(s, 0.98, 0.02), true); // square top-right
    assert.equal(pointInShape(s, 0.02, 0.98), true); // square bottom-left
    assert.equal(pointInShape(s, 0.5, 0.5), true);
  });

  test('ring: inside the outer shape but not the inner one', () => {
    const ring = {
      kind: 'ring',
      outer: { kind: 'circle', cx: 3.5, cy: 3.5, r: 3.5 },
      inner: { kind: 'circle', cx: 3.5, cy: 3.5, r: 2.5 },
    };
    assert.equal(pointInShape(ring, 0.5, 3.5), true);
    assert.equal(pointInShape(ring, 3.5, 3.5), false);
    assert.equal(pointInShape(ring, 0.1, 0.1), false);
    assert.deepEqual(shapeBounds(ring), { x: 0, y: 0, w: 7, h: 7 });
  });
});

describe('contrast safety', () => {
  test('WCAG contrast ratio', () => {
    assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
    assert.ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 0.01);
    assert.ok(Math.abs(contrastRatio('#777777', '#ffffff') - 4.48) < 0.01);
  });

  test('black on white: no warnings', () => {
    assert.deepEqual(checkContrast(normalizeStyle()), []);
  });

  test('warns when contrast is too low', () => {
    const warnings = checkContrast(normalizeStyle({ fg: '#cccccc' }));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /contrast/i);
  });

  test('warns when the dark colour is lighter than the background (inverted)', () => {
    const warnings = checkContrast(normalizeStyle({ fg: '#ffffff', bg: '#000000' }));
    assert.ok(warnings.some((w) => /lighter than the background/i.test(w)));
  });

  test('checks both gradient stops and the finder colour', () => {
    assert.ok(checkContrast(normalizeStyle({ gradient: '#000,#eee' })).some((w) => /gradient/i.test(w)));
    assert.ok(checkContrast(normalizeStyle({ finderColor: '#ffeeee' })).some((w) => /finder/i.test(w)));
  });
});

describe('gradient maths', () => {
  const box = { x: 4, y: 4, w: 21, h: 21 };

  test('t runs from 0 to 1 across the box in each direction', () => {
    assert.equal(gradientT('horizontal', 4, 10, box), 0);
    assert.equal(gradientT('horizontal', 25, 10, box), 1);
    assert.equal(gradientT('vertical', 10, 4, box), 0);
    assert.equal(gradientT('vertical', 10, 25, box), 1);
    assert.equal(gradientT('diagonal', 4, 4, box), 0);
    assert.equal(gradientT('diagonal', 25, 25, box), 1);
    assert.equal(gradientT('radial', 14.5, 14.5, box), 0);
    assert.ok(Math.abs(gradientT('radial', 4, 4, box) - 1) < 1e-9);
    assert.equal(gradientT('horizontal', 100, 0, box), 1); // clamped
  });

  test('gradientColor interpolates between the two stops', () => {
    const g = { from: '#000000', to: '#ff00ff', direction: 'horizontal' };
    assert.deepEqual(gradientColor(g, 0), { r: 0, g: 0, b: 0 });
    assert.deepEqual(gradientColor(g, 1), { r: 255, g: 0, b: 255 });
    assert.deepEqual(gradientColor(g, 0.5), { r: 128, g: 0, b: 128 });
  });
});
