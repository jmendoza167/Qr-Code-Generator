import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  planLogo,
  encodeWithLogo,
  hasCentreAlignmentPattern,
  centreAlignmentPattern,
  NoRoomForLogoError,
  DEFAULT_LOGO_SIZE,
  MAX_LOGO_SIZE,
} from '../src/render/logo.js';
import { createMatrix } from '../src/core/matrix.js';
import { encode } from '../src/core/qr.js';

/** Text that lands on a given version at level H. */
function matrixForVersion(version) {
  return encode('v'.repeat(3), { ecc: 'H', version }).matrix;
}

describe('planLogo: geometry', () => {
  test('defaults: 20% of the width, 1 module of padding, centred on the symbol', () => {
    const size = 37; // version 5
    const plan = planLogo(matrixForVersion(5), {});
    assert.equal(DEFAULT_LOGO_SIZE, 20);
    assert.equal(MAX_LOGO_SIZE, 30);
    assert.ok(Math.abs(plan.box.w - size * 0.2) < 1e-9);
    assert.equal(plan.box.h, plan.box.w);
    assert.ok(Math.abs(plan.box.x + plan.box.w / 2 - size / 2) < 1e-9, 'horizontally centred');
    assert.ok(Math.abs(plan.box.y + plan.box.h / 2 - size / 2) < 1e-9, 'vertically centred');
    // cleared area: whole modules, padding on each side, centred too
    assert.equal(plan.area.cols, plan.area.rows);
    assert.ok(plan.area.cols >= Math.ceil(plan.box.w) + 2);
    assert.equal(plan.area.col + (plan.area.cols - 1) / 2, (size - 1) / 2);
    assert.equal(plan.area.row + (plan.area.rows - 1) / 2, (size - 1) / 2);
    assert.deepEqual(plan.warnings, []);
    assert.equal(plan.sizePercent, 20);
  });

  test('the cleared area fully contains the image box plus the padding', () => {
    const plan = planLogo(matrixForVersion(6), { sizePercent: 25, padding: 2 });
    assert.ok(plan.area.col + 2 <= plan.box.x);
    assert.ok(plan.area.row + 2 <= plan.box.y);
    assert.ok(plan.area.col + plan.area.cols - 2 >= plan.box.x + plan.box.w);
    assert.ok(plan.area.row + plan.area.rows - 2 >= plan.box.y + plan.box.h);
  });

  test('keeps the aspect ratio: the larger side is the requested percentage', () => {
    const size = 37;
    const wide = planLogo(matrixForVersion(5), { sizePercent: 20, aspect: 2 });
    assert.ok(Math.abs(wide.box.w - size * 0.2) < 1e-9);
    assert.ok(Math.abs(wide.box.h - size * 0.1) < 1e-9);
    const tall = planLogo(matrixForVersion(5), { sizePercent: 20, aspect: 0.5 });
    assert.ok(Math.abs(tall.box.h - size * 0.2) < 1e-9);
    assert.ok(Math.abs(tall.box.w - size * 0.1) < 1e-9);
    assert.ok(tall.area.rows > tall.area.cols);
  });

  test('the returned matrix has the area cleared and nothing else changed', () => {
    const matrix = matrixForVersion(5);
    const plan = planLogo(matrix, {});
    assert.notEqual(plan.matrix, matrix, 'a copy');
    for (let r = 0; r < matrix.length; r++) {
      for (let c = 0; c < matrix.length; c++) {
        const inArea =
          r >= plan.area.row && r < plan.area.row + plan.area.rows && c >= plan.area.col && c < plan.area.col + plan.area.cols;
        assert.equal(plan.matrix[r][c], inArea ? false : matrix[r][c], `(${r},${c})`);
      }
    }
    // the original is untouched
    assert.ok(matrix.some((row) => row.some(Boolean)));
  });

  test('validation', () => {
    const m = matrixForVersion(5);
    assert.throws(() => planLogo(m, { sizePercent: 31 }), /30/);
    assert.throws(() => planLogo(m, { sizePercent: 0 }), RangeError);
    assert.throws(() => planLogo(m, { padding: -1 }), /padding/);
    assert.throws(() => planLogo(m, { aspect: 0 }), /aspect/);
  });
});

describe('planLogo: never covers function patterns (except a centre alignment pattern)', () => {
  for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 10, 14, 20, 21, 27, 33, 40]) {
    for (const sizePercent of [10, 20, 30]) {
      test(`version ${version}, ${sizePercent}%`, () => {
        const plan = planLogo(matrixForVersion(version), { sizePercent });
        const { isFunction } = createMatrix(version);
        const p = centreAlignmentPattern(version);
        const centreAlignment = p !== null;
        for (let r = plan.area.row; r < plan.area.row + plan.area.rows; r++) {
          for (let c = plan.area.col; c < plan.area.col + plan.area.cols; c++) {
            const inCentrePattern = centreAlignment && Math.abs(r - p) <= 2 && Math.abs(c - p) <= 2;
            if (inCentrePattern) continue;
            assert.equal(isFunction[r][c], false, `function module at (${r},${c}) inside the cleared area`);
          }
        }
        assert.ok(plan.sizePercent <= sizePercent);
        if (plan.sizePercent < sizePercent) {
          assert.ok(plan.warnings.some((w) => /reduced|shrunk/i.test(w)), 'warns when it shrinks');
        }
        assert.equal(plan.notes.length, centreAlignment ? 1 : 0);
      });
    }
  }

  test('centreAlignmentPattern matches the alignment table', () => {
    const expected = [7, 8, 9, 10, 11, 12, 13, 21, 22, 23, 24, 25, 26, 27, 35, 37, 38, 40];
    const actual = [];
    for (let v = 1; v <= 40; v++) if (hasCentreAlignmentPattern(v)) actual.push(v);
    assert.deepEqual(actual, expected);
    assert.equal(centreAlignmentPattern(7), 22); // exactly centred
    assert.equal(centreAlignmentPattern(40), 86); // centre module (88,88) is on its edge
    assert.equal(centreAlignmentPattern(14), null);
  });

  test('the bottom-right alignment pattern (the one readers use) is never covered', () => {
    for (const version of [7, 10, 21, 40]) {
      const plan = planLogo(matrixForVersion(version), { sizePercent: 30 });
      const size = 17 + 4 * version;
      const br = size - 7; // centre of the bottom-right alignment pattern
      assert.ok(plan.area.row + plan.area.rows <= br - 2, `version ${version}`);
    }
  });

  test('a version 1 symbol forces a drastic reduction (only the centre 3x3 is free)', () => {
    const plan = planLogo(matrixForVersion(1), { sizePercent: 20 });
    assert.equal(plan.area.rows, 3);
    assert.equal(plan.area.row, 9);
    assert.ok(plan.warnings.length > 0);
  });

  test('versions with an alignment pattern in the exact centre cover it and say so in the notes', () => {
    for (const version of [7, 21, 35]) {
      const { isFunction } = createMatrix(version);
      const centre = (17 + 4 * version - 1) / 2;
      assert.equal(isFunction[centre][centre], true);
      const plan = planLogo(matrixForVersion(version), { sizePercent: 20 });
      assert.deepEqual(plan.warnings, []);
      assert.match(plan.notes[0], /alignment pattern at the centre/);
      assert.equal(plan.matrix[centre][centre], false, 'cleared');
    }
  });

  test('NoRoomForLogoError when padding alone exceeds the free centre', () => {
    assert.throws(() => planLogo(matrixForVersion(1), { sizePercent: 10, padding: 5 }), NoRoomForLogoError);
  });
});

describe('encodeWithLogo: picks a version with room for the full-size logo', () => {
  test('bumps version 1 to a larger symbol instead of shrinking the logo to one module', () => {
    const { qr, plan, notes } = encodeWithLogo('hi', { sizePercent: 20 });
    assert.equal(qr.ecc, 'H');
    assert.ok(qr.version > 1);
    assert.deepEqual(plan.warnings, []);
    assert.equal(plan.sizePercent, 20);
    assert.match(notes[0], new RegExp(`version ${qr.version} instead of 1`));
  });

  test('keeps version 7 (centre alignment pattern covered) and passes the note through', () => {
    const text = 'x'.repeat(60); // version 7 at level H holds 66 bytes
    assert.equal(encode(text, { ecc: 'H' }).version, 7);
    const { qr, notes } = encodeWithLogo(text, { sizePercent: 20 });
    assert.equal(qr.version, 7);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /alignment pattern at the centre/);
  });

  test('keeps the natural version when the logo already fits', () => {
    const text = 'https://example.com/some/path';
    const base = encode(text, { ecc: 'H' });
    const { qr, notes } = encodeWithLogo(text, {});
    assert.equal(qr.version, base.version);
    assert.deepEqual(notes, []);
  });

  test('passes other encode options through and still forces H', () => {
    const { qr } = encodeWithLogo('abc', { ecc: 'L', mask: 3 });
    assert.equal(qr.ecc, 'H');
    assert.equal(qr.mask, 3);
  });
});
