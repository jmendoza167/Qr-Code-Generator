// End-to-end tests of the style options on the CLI.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import { decodeRgba } from './helpers/decode.js';

const { PNG } = pngjs;
const BIN = fileURLToPath(new URL('../bin/qrgen.js', import.meta.url));

function qrgen(args, input = '') {
  const result = spawnSync(process.execPath, [BIN, ...args], { input: Buffer.from(input, 'utf8'), encoding: 'buffer' });
  return { status: result.status, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
}

let dir;
let n = 0;
const tmp = (ext) => join(dir, `style-${n++}.${ext}`);
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qrgen-styles-'));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('style options', () => {
  test('all style flags together produce an RGBA PNG that decodes', () => {
    const file = tmp('png');
    const args = [
      'styled cli', '-o', file, '-s', '6', '--shape', 'dots', '--finder', 'circle',
      '--gradient', '#1a237e,#004d40', '--gradient-dir', 'radial', '--finder-color', '#b71c1c',
    ];
    const { status, stderr } = qrgen(args);
    assert.equal(status, 0, stderr);
    assert.equal(stderr, '');
    const buf = readFileSync(file);
    assert.equal(buf[25], 6, 'colour type RGBA');
    const png = PNG.sync.read(buf);
    assert.equal(decodeRgba(png.data, png.width, png.height).data, 'styled cli');
  });

  test('SVG output gets the same styles', () => {
    const file = tmp('svg');
    const { status, stderr } = qrgen(['styled svg', '-o', file, '--shape', 'rounded', '--finder', 'rounded', '--gradient', 'f00,00f']);
    assert.equal(status, 0, stderr);
    const svg = readFileSync(file, 'utf8');
    assert.match(svg, /<linearGradient/);
    assert.match(svg, /a0\.5 0\.5 0 0 1/);
  });

  test('plain output is unchanged when no style flag is given', () => {
    const file = tmp('png');
    qrgen(['plain', '-o', file]);
    assert.equal(readFileSync(file)[25], 3, 'still a palette PNG');
  });

  test('invalid values are usage errors', () => {
    const cases = [
      [['x', '-o', 'a.png', '--shape', 'hex'], /shape/],
      [['x', '-o', 'a.png', '--finder', 'star'], /finder/],
      [['x', '-o', 'a.png', '--gradient', '#f00'], /gradient/],
      [['x', '-o', 'a.png', '--gradient', '#f00,#00f', '--gradient-dir', 'up'], /direction/],
      [['x', '-o', 'a.png', '--finder-color', 'red'], /colou?r/],
    ];
    for (const [args, pattern] of cases) {
      const { status, stderr } = qrgen(args);
      assert.equal(status, 2, `${args.join(' ')}\n${stderr}`);
      assert.match(stderr, pattern);
    }
  });
});

describe('contrast warnings (never errors)', () => {
  test('low contrast foreground warns on stderr but still writes the file', () => {
    const file = tmp('png');
    const { status, stderr } = qrgen(['x', '-o', file, '--fg', '#dddddd']);
    assert.equal(status, 0);
    assert.match(stderr, /Warning:.*contrast/i);
    assert.doesNotThrow(() => readFileSync(file));
  });

  test('inverted colours warn', () => {
    const { status, stderr } = qrgen(['x', '-o', tmp('svg'), '--fg', '#ffffff', '--bg', '#000000']);
    assert.equal(status, 0);
    assert.match(stderr, /lighter than the background/i);
  });

  test('a light gradient stop warns', () => {
    const { stderr } = qrgen(['x', '-o', tmp('svg'), '--gradient', '#000000,#eeeeee']);
    assert.match(stderr, /gradient end/i);
  });
});

describe('styles and the terminal', () => {
  test('terminal output ignores styles and says so once', () => {
    const { status, stdout, stderr } = qrgen(['x', '--shape', 'dots', '--finder', 'circle', '-m', '0']);
    assert.equal(status, 0);
    assert.match(stdout, /[▀▄█]/);
    const notes = stderr.trim().split('\n');
    assert.equal(notes.length, 1);
    assert.match(notes[0], /terminal/i);
    assert.match(notes[0], /-o/);
  });

  test('no note without style options', () => {
    assert.equal(qrgen(['x', '-m', '0']).stderr, '');
  });
});
