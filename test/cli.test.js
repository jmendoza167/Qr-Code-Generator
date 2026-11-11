// End-to-end tests of the real CLI: spawn `node bin/qrgen.js` and check
// stdout, stderr, exit codes and written files.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import { decodeRgba } from './helpers/decode.js';

const { PNG } = pngjs;
const BIN = fileURLToPath(new URL('../bin/qrgen.js', import.meta.url));
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function qrgen(args, input) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    input: input === undefined ? '' : input,
    encoding: 'buffer',
  });
  return {
    status: result.status,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8'),
  };
}

function decodePngFile(file) {
  const png = PNG.sync.read(readFileSync(file));
  return decodeRgba(png.data, png.width, png.height);
}

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qrgen-cli-'));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('terminal output', () => {
  test('prints a half-block QR code for the text argument', () => {
    const { status, stdout, stderr } = qrgen(['hello world']);
    assert.equal(status, 0, stderr);
    assert.equal(stderr, '');
    const lines = stdout.replace(/\r?\n$/, '').split(/\r?\n/);
    assert.equal(lines.length, Math.ceil((21 + 8) / 2));
    assert.match(stdout, /[▀▄█]/);
  });

  test('--ascii uses ## and spaces, one line per module row', () => {
    const { status, stdout } = qrgen(['hello world', '--ascii']);
    assert.equal(status, 0);
    assert.doesNotMatch(stdout, /[▀▄█]/);
    assert.match(stdout, /##/);
    assert.equal(stdout.replace(/\r?\n$/, '').split(/\r?\n/).length, 21 + 8);
  });

  test('--margin changes the quiet zone, --invert flips the colours', () => {
    const plain = qrgen(['hello world', '-m', '0']).stdout;
    assert.equal(plain.replace(/\r?\n$/, '').split(/\r?\n/).length, 11);
    const inverted = qrgen(['hello world', '-m', '0', '--invert']).stdout;
    assert.notEqual(plain, inverted);
    assert.equal(plain.length, inverted.length);
  });

  test('--info prints version, mode, ECC level and mask', () => {
    const { status, stdout } = qrgen(['01234567', '--info', '-e', 'H']);
    assert.equal(status, 0);
    assert.match(stdout, /Version:\s+1 \(21x21 modules\)/);
    assert.match(stdout, /Mode:\s+numeric/);
    assert.match(stdout, /ECC:\s+H/);
    assert.match(stdout, /Mask:\s+[0-7]/);
  });

  test('ECC level is case-insensitive', () => {
    assert.match(qrgen(['x', '--info', '--ecc', 'q']).stdout, /ECC:\s+Q/);
  });
});

describe('stdin', () => {
  test('reads the text from stdin when no argument is given, stripping the trailing newline', () => {
    const file = join(dir, 'stdin.png');
    const { status, stderr } = qrgen(['-o', file], Buffer.from('from stdin\r\n', 'utf8'));
    assert.equal(status, 0, stderr);
    assert.equal(decodePngFile(file).data, 'from stdin');
  });

  test('decodes stdin as UTF-8 and ignores a BOM', () => {
    const file = join(dir, 'stdin-utf8.png');
    const input = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('¡Hola, señor! 😀\n', 'utf8')]);
    const { status, stderr } = qrgen(['-o', file], input);
    assert.equal(status, 0, stderr);
    assert.equal(decodePngFile(file).data, '¡Hola, señor! 😀');
  });

  test('empty stdin and no argument is a usage error', () => {
    const { status, stderr } = qrgen([], '');
    assert.equal(status, 2);
    assert.match(stderr, /no input text/i);
  });
});

describe('file output', () => {
  test('-o file.png writes a valid PNG that decodes, honouring scale/margin/colours', () => {
    const file = join(dir, 'out.png');
    const { status, stdout, stderr } = qrgen(['png test', '-o', file, '-s', '3', '-m', '2', '--fg', '#102030', '--bg', 'fff']);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /Saved .*out\.png/);
    const png = PNG.sync.read(readFileSync(file));
    assert.equal(png.width, (21 + 4) * 3);
    assert.deepEqual([...png.data.subarray(0, 3)], [255, 255, 255]);
    const i = (6 * png.width + 6) * 4; // first module of the top-left finder
    assert.deepEqual([...png.data.subarray(i, i + 3)], [0x10, 0x20, 0x30]);
    assert.equal(decodeRgba(png.data, png.width, png.height).data, 'png test');
  });

  test('-o file.svg writes an SVG; extension matching is case-insensitive', () => {
    const file = join(dir, 'out.SVG');
    const { status, stderr } = qrgen(['svg test', '--output', file, '--scale', '2', '--margin', '1']);
    assert.equal(status, 0, stderr);
    const svg = readFileSync(file, 'utf8');
    assert.match(svg, /^<svg /);
    assert.match(svg, /width="46" height="46"/);
  });

  test('--info also works together with -o', () => {
    const file = join(dir, 'info.svg');
    const { stdout } = qrgen(['HELLO', '-o', file, '--info']);
    assert.match(stdout, /Mode:\s+alphanumeric/);
  });

  test('an unknown extension is a usage error and writes nothing', () => {
    const file = join(dir, 'out.txt');
    const { status, stderr } = qrgen(['x', '-o', file]);
    assert.equal(status, 2);
    assert.match(stderr, /\.png or \.svg/);
    assert.equal(existsSync(file), false);
  });

  test('an unwritable path is a runtime error (exit 1)', () => {
    const { status, stderr } = qrgen(['x', '-o', join(dir, 'missing-dir', 'out.png')]);
    assert.equal(status, 1);
    assert.match(stderr, /qrgen: /);
  });
});

describe('usage errors (exit code 2) and runtime errors (exit code 1)', () => {
  const cases = [
    [['x', '-e', 'X'], /ECC level/],
    [['x', '-s', '0'], /scale/],
    [['x', '-s', 'ten'], /scale/],
    [['x', '--margin=-1'], /margin/],
    [['x', '--fg', 'red', '-o', 'a.png'], /colou?r/],
    [['x', '--bogus'], /bogus/],
    [['x', '-o'], /output/],
    [['one', 'two'], /quote/i],
  ];
  for (const [args, pattern] of cases) {
    test(`qrgen ${args.join(' ')}`, () => {
      const { status, stderr } = qrgen(args);
      assert.equal(status, 2, stderr);
      assert.match(stderr, /^qrgen: /);
      assert.match(stderr, pattern);
      assert.match(stderr, /--help/);
    });
  }

  test('text that cannot fit in version 40 exits with 1 and says so', () => {
    const { status, stderr } = qrgen(['x'.repeat(3000)]);
    assert.equal(status, 1);
    assert.match(stderr, /Data too long/);
  });
});

describe('--help and --version', () => {
  test('--help prints usage and exits 0', () => {
    const { status, stdout } = qrgen(['--help']);
    assert.equal(status, 0);
    assert.match(stdout, /Usage: qrgen/);
    for (const flag of ['--output', '--ecc', '--scale', '--margin', '--fg', '--bg', '--ascii', '--invert', '--info']) {
      assert.ok(stdout.includes(flag), `help mentions ${flag}`);
    }
    assert.equal(qrgen(['-h']).status, 0);
  });

  test('--version prints the package version', () => {
    const { status, stdout } = qrgen(['--version']);
    assert.equal(status, 0);
    assert.equal(stdout.trim(), PKG.version);
    assert.equal(qrgen(['-v']).stdout.trim(), PKG.version);
  });
});
