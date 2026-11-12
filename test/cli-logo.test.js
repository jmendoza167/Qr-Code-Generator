// End-to-end tests of the --logo options.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import { decodeRgba } from './helpers/decode.js';
import { makeLogoImage, encodeWithPngjs } from './helpers/fixtures.js';

const { PNG } = pngjs;
const BIN = fileURLToPath(new URL('../bin/qrgen.js', import.meta.url));

function qrgen(args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { input: Buffer.alloc(0), encoding: 'buffer' });
  return { status: result.status, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
}

function decodeFile(file) {
  const png = PNG.sync.read(readFileSync(file));
  return decodeRgba(png.data, png.width, png.height);
}

let dir;
let logoPng;
let logoSvg;
let logoJpg;
let n = 0;
const tmp = (ext) => join(dir, `out-${n++}.${ext}`);

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qrgen-logo-'));
  logoPng = join(dir, 'logo.png');
  writeFileSync(logoPng, encodeWithPngjs(makeLogoImage(48, 48), { colorType: 6 }));
  logoSvg = join(dir, 'logo.svg');
  writeFileSync(logoSvg, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#00f"/></svg>');
  logoJpg = join(dir, 'logo.jpg');
  writeFileSync(logoJpg, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('--logo with PNG output', () => {
  test('embeds the logo, forces ECC H silently when no level was given, and decodes', () => {
    const file = tmp('png');
    const { status, stdout, stderr } = qrgen(['https://example.com', '-o', file, '--logo', logoPng, '--info']);
    assert.equal(status, 0, stderr);
    assert.equal(stderr, '');
    assert.match(stdout, /ECC:\s+H/);
    assert.equal(decodeFile(file).data, 'https://example.com');
  });

  test('warns and overrides when a lower ECC level was passed explicitly', () => {
    const file = tmp('png');
    const { status, stdout, stderr } = qrgen(['https://example.com', '-o', file, '--logo', logoPng, '-e', 'L', '--info']);
    assert.equal(status, 0, stderr);
    assert.match(stderr, /Warning:.*ECC.*L.*H/);
    assert.match(stdout, /ECC:\s+H/);
  });

  test('--logo-size, --logo-padding and --logo-bg are applied; styles combine with the logo', () => {
    const file = tmp('png');
    const args = [
      'https://example.com/styled-logo', '-o', file, '--logo', logoPng, '--logo-size', '25', '--logo-padding', '2',
      '--logo-bg', '#ffff00', '--shape', 'rounded', '--finder', 'rounded', '--gradient', '#1a237e,#004d40', '-s', '6',
    ];
    const { status, stderr } = qrgen(args);
    assert.equal(status, 0, stderr);
    const png = PNG.sync.read(readFileSync(file));
    assert.equal(decodeRgba(png.data, png.width, png.height).data, 'https://example.com/styled-logo');
    // the yellow logo background is somewhere in the middle
    const mid = (Math.floor(png.height / 2) * png.width + Math.floor(png.width / 2 - 3 * 6)) * 4;
    let yellowFound = false;
    for (let y = png.height / 2 - 40; y < png.height / 2 + 40 && !yellowFound; y++) {
      for (let x = png.width / 2 - 40; x < png.width / 2 + 40; x++) {
        const i = (y * png.width + x) * 4;
        if (png.data[i] === 255 && png.data[i + 1] === 255 && png.data[i + 2] === 0) {
          yellowFound = true;
          break;
        }
      }
    }
    assert.ok(yellowFound, `no yellow pixels near ${mid}`);
  });

  test('a short text moves to a larger version so the logo keeps its size, with a note', () => {
    const file = tmp('png');
    const { status, stdout, stderr } = qrgen(['hi', '-o', file, '--logo', logoPng, '--logo-size', '30', '--info']);
    assert.equal(status, 0, stderr);
    assert.match(stderr, /Note:.*version \d+ instead of 1/i);
    assert.doesNotMatch(stdout, /Version: 1 /);
    assert.equal(decodeFile(file).data, 'hi');
  });

  test('an SVG logo in PNG output is refused with a hint', () => {
    const { status, stderr } = qrgen(['x', '-o', tmp('png'), '--logo', logoSvg]);
    assert.equal(status, 2);
    assert.match(stderr, /SVG logo/i);
    assert.match(stderr, /PNG logo|\.svg/);
  });
});

describe('--logo with SVG output', () => {
  test('PNG logo becomes a data URI image', () => {
    const file = tmp('svg');
    const { status, stderr } = qrgen(['x', '-o', file, '--logo', logoPng]);
    assert.equal(status, 0, stderr);
    assert.match(readFileSync(file, 'utf8'), /<image href="data:image\/png;base64,/);
  });

  test('SVG logo is inlined', () => {
    const file = tmp('svg');
    const { status, stderr } = qrgen(['x', '-o', file, '--logo', logoSvg, '--logo-bg', '#fff']);
    assert.equal(status, 0, stderr);
    const svg = readFileSync(file, 'utf8');
    assert.match(svg, /<svg x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" viewBox="0 0 10 10"/);
    assert.match(svg, /<circle cx="5" cy="5" r="5" fill="#00f"\/>/);
  });
});

describe('--logo errors and notes', () => {
  test('JPEG and other formats are rejected with a conversion hint', () => {
    const { status, stderr } = qrgen(['x', '-o', tmp('png'), '--logo', logoJpg]);
    assert.equal(status, 2);
    assert.match(stderr, /JPEG/);
    assert.match(stderr, /convert.*PNG/i);
  });

  test('missing logo file', () => {
    const { status, stderr } = qrgen(['x', '-o', tmp('png'), '--logo', join(dir, 'nope.png')]);
    assert.equal(status, 2);
    assert.match(stderr, /nope\.png/);
  });

  test('logo size above 30% is rejected', () => {
    const { status, stderr } = qrgen(['x', '-o', tmp('png'), '--logo', logoPng, '--logo-size', '40']);
    assert.equal(status, 2);
    assert.match(stderr, /30/);
  });

  test('bad padding or background colour', () => {
    assert.equal(qrgen(['x', '-o', tmp('png'), '--logo', logoPng, '--logo-padding', '-1']).status, 2);
    assert.equal(qrgen(['x', '-o', tmp('png'), '--logo', logoPng, '--logo-bg', 'yellow']).status, 2);
  });

  test('logo options with terminal output print a note and the plain code', () => {
    const { status, stdout, stderr } = qrgen(['x', '--logo', logoPng, '-m', '0']);
    assert.equal(status, 0);
    assert.match(stdout, /[▀▄█]/);
    assert.match(stderr, /logo/i);
    assert.match(stderr, /-o/);
  });
});
