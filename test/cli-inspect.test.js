// End-to-end tests for "qrgen inspect": malicious payloads rendered to PNG
// with qrgen itself, then inspected; --text mode; --json; exit codes; the
// escaping of hostile content; and the guard that no inspect code can reach
// the network.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, EXIT_OK, EXIT_ERROR } from '../src/cli.js';
import { encode } from '../src/core/qr.js';
import { renderPng } from '../src/render/png.js';
import { encodeRgba } from '../src/render/png.js';
import { noiseRgba } from './helpers/image.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(ROOT, 'bin', 'qrgen.js');
const EXIT_SUSPICIOUS = 2;

function qrgen(args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { input: '', encoding: 'buffer' });
  return { status: result.status, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
}

function sink() {
  const stream = { text: '', write: (chunk) => ((stream.text += chunk), true) };
  return stream;
}

async function inspectInProcess(args) {
  const stdout = sink();
  const stderr = sink();
  const status = await run(['inspect', ...args], { stdin: { on() {} }, stdout, stderr });
  return { status, stdout: stdout.text, stderr: stderr.text };
}

const ESCAPE_PAYLOAD = 'https://example.com/\u001b[31mred\u001b]0;title\u0007\r\n‮reversed‬';

const PAYLOADS = {
  'fake-host.png': 'https://paypal.com@evil.example/login',
  'lookalike.png': 'http://paypa1.com/login',
  'javascript.png': 'javascript:alert(document.cookie)',
  'shortener.png': 'https://bit.ly/3xYz12',
  'open-wifi.png': 'WIFI:T:nopass;S:Free Airport WiFi;;',
  'benign.png': 'https://github.com/jmendoza167/Qr-Code-Generator',
  'benign-text.png': 'Table 12',
  'escape.png': ESCAPE_PAYLOAD,
  'http-login.png': 'http://example.com/login',
};

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qrgen-inspect-'));
  for (const [file, text] of Object.entries(PAYLOADS)) writeFileSync(join(dir, file), renderPng(encode(text, { ecc: 'M' }).matrix, { scale: 4 }));
  writeFileSync(join(dir, 'noise.png'), encodeRgba(noiseRgba(200, 200, 5)));
  writeFileSync(join(dir, 'not-a.png'), 'this is not a png');
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('qrgen inspect <image>', () => {
  test('a fake host before @ is HIGH and exits 2', () => {
    const { status, stdout } = qrgen(['inspect', join(dir, 'fake-host.png')]);
    assert.equal(status, EXIT_SUSPICIOUS, stdout);
    assert.match(stdout, /^Verdict: HIGH/m);
    assert.match(stdout, /\[HIGH\] Fake host before @/);
    assert.match(stdout, /evil\.example/);
    assert.match(stdout, /heuristic/i);
  });

  test('every malicious sample exits 2 with the expected finding', () => {
    const expected = {
      'lookalike.png': /\[HIGH\] Domain imitates a well-known brand/,
      'javascript.png': /\[HIGH\] Dangerous "javascript:" link/,
      'shortener.png': /\[MEDIUM\] Link shortener/,
      'open-wifi.png': /\[MEDIUM\] Open Wi-Fi network/,
      'http-login.png': /^Verdict: MEDIUM/m,
    };
    for (const [file, pattern] of Object.entries(expected)) {
      const { status, stdout } = qrgen(['inspect', join(dir, file)]);
      assert.equal(status, EXIT_SUSPICIOUS, `${file}: ${stdout}`);
      assert.match(stdout, pattern, file);
    }
  });

  test('benign codes report no findings and exit 0', () => {
    for (const file of ['benign.png', 'benign-text.png']) {
      const { status, stdout, stderr } = qrgen(['inspect', join(dir, file)]);
      assert.equal(status, EXIT_OK, `${file}: ${stdout}${stderr}`);
      assert.match(stdout, /^Verdict: no findings/m);
      assert.match(stdout, /Content \(escaped\):/);
      assert.match(stdout, /cannot prove/i);
    }
  });

  test('the symbol metadata is shown', () => {
    const { stdout } = qrgen(['inspect', join(dir, 'benign.png')]);
    assert.match(stdout, /Symbol: version \d+, level M, mask \d, 0 codewords corrected/);
  });
});

describe('qrgen inspect: hostile content is escaped, never interpreted', () => {
  test('ESC, OSC, CR and bidi overrides appear as visible escapes in the report', async () => {
    for (const result of [await inspectInProcess([join(dir, 'escape.png')]), await inspectInProcess(['--text', ESCAPE_PAYLOAD])]) {
      assert.equal(result.status, EXIT_SUSPICIOUS);
      assert.ok(!result.stdout.includes('\u001b'), 'raw ESC in stdout');
      assert.ok(!result.stdout.includes('\u0007'), 'raw BEL in stdout');
      assert.ok(!result.stdout.includes('‮'), 'raw bidi override in stdout');
      assert.ok(!result.stdout.includes('\r'), 'raw CR in stdout');
      assert.match(result.stdout, /\\x1b\[31mred\\x1b\]0;title\\x07\\x0d\\x0a\\u202ereversed\\u202c/);
      assert.match(result.stdout, /\[HIGH\] Bidirectional override/);
      assert.match(result.stdout, /\[MEDIUM\] Control characters/);
      assert.ok(!result.stderr.includes('\u001b'));
    }
  });

  test('the same through the real binary', () => {
    const { stdout } = qrgen(['inspect', join(dir, 'escape.png')]);
    assert.ok(!stdout.includes('\u001b'));
    assert.match(stdout, /\\x1b\[31m/);
  });

  test('JSON output keeps the text raw (JSON escaping makes it safe) and is valid JSON', async () => {
    const { status, stdout } = await inspectInProcess(['--json', '--text', ESCAPE_PAYLOAD]);
    assert.equal(status, EXIT_SUSPICIOUS);
    assert.ok(!stdout.includes('\u001b'), 'JSON must escape ESC as \\u001b');
    const report = JSON.parse(stdout);
    assert.equal(report.text, ESCAPE_PAYLOAD);
  });
});

describe('qrgen inspect --text and --json', () => {
  test('--text analyses a raw payload without an image', async () => {
    const { status, stdout } = await inspectInProcess(['--text', 'https://paypal.com.evil.example/']);
    assert.equal(status, EXIT_SUSPICIOUS);
    assert.match(stdout, /Brand name only in a subdomain/);
    const ok = await inspectInProcess(['--text', 'https://github.com/']);
    assert.equal(ok.status, EXIT_OK);
  });

  test('--json has the documented shape', async () => {
    const { status, stdout } = await inspectInProcess(['--json', join(dir, 'lookalike.png')]);
    assert.equal(status, EXIT_SUSPICIOUS);
    const report = JSON.parse(stdout);
    assert.deepEqual(Object.keys(report).sort(), ['disclaimer', 'exitCode', 'findings', 'meta', 'text', 'type', 'verdict']);
    assert.equal(report.verdict, 'high');
    assert.equal(report.type, 'url');
    assert.equal(report.text, 'http://paypa1.com/login');
    assert.equal(report.exitCode, EXIT_SUSPICIOUS);
    assert.deepEqual(report.findings.map((f) => f.id).sort(), ['brand-lookalike', 'url-credential-bait', 'url-http']);
    for (const f of report.findings) assert.deepEqual(Object.keys(f).sort(), ['detail', 'id', 'severity', 'title', 'where']);
    assert.equal(report.meta.ecc, 'M');
    assert.equal(typeof report.meta.version, 'number');
    assert.equal(report.meta.errorsCorrected, 0);
    assert.match(report.disclaimer, /heuristic/i);
  });

  test('--json with no findings', async () => {
    const { status, stdout } = await inspectInProcess(['--json', '--text', 'Table 12']);
    assert.equal(status, EXIT_OK);
    const report = JSON.parse(stdout);
    assert.equal(report.verdict, 'none');
    assert.deepEqual(report.findings, []);
    assert.equal(report.exitCode, 0);
  });

  test('a low verdict exits 0', async () => {
    const { status, stdout } = await inspectInProcess(['--text', 'http://example.com/']);
    assert.equal(status, EXIT_OK);
    assert.match(stdout, /^Verdict: LOW/m);
  });
});

describe('qrgen inspect: errors exit 1', () => {
  test('an image with no QR code', async () => {
    const { status, stderr, stdout } = await inspectInProcess([join(dir, 'noise.png')]);
    assert.equal(status, EXIT_ERROR);
    assert.match(stderr, /No QR code found/);
    assert.equal(stdout, '');
  });

  test('a file that is not a PNG, and a missing file', async () => {
    const notPng = await inspectInProcess([join(dir, 'not-a.png')]);
    assert.equal(notPng.status, EXIT_ERROR);
    assert.match(notPng.stderr, /not a PNG/);
    const missing = await inspectInProcess([join(dir, 'missing.png')]);
    assert.equal(missing.status, EXIT_ERROR);
    assert.match(missing.stderr, /missing\.png/);
  });

  test('usage mistakes exit 1 (so that 2 always means suspicious)', async () => {
    for (const args of [[], ['--text'], ['a.png', 'b.png'], ['--bogus'], ['--text', 'x', join(dir, 'benign.png')]]) {
      const { status, stderr } = await inspectInProcess(args);
      assert.equal(status, EXIT_ERROR, JSON.stringify(args));
      assert.match(stderr, /qrgen inspect/);
    }
  });

  test('--json errors are JSON too', async () => {
    const { status, stdout } = await inspectInProcess(['--json', join(dir, 'noise.png')]);
    assert.equal(status, EXIT_ERROR);
    const out = JSON.parse(stdout);
    assert.equal(out.error.name, 'NoQrFoundError');
    assert.equal(out.exitCode, EXIT_ERROR);
  });

  test('--help documents usage and the exit codes', async () => {
    const { status, stdout } = await inspectInProcess(['--help']);
    assert.equal(status, EXIT_OK);
    assert.match(stdout, /qrgen inspect <image\.png>/);
    assert.match(stdout, /--text/);
    assert.match(stdout, /--json/);
    assert.match(stdout, /0 .*no findings or low/i);
    assert.match(stdout, /2 .*medium or high/i);
    assert.match(stdout, /1 .*error/i);
    assert.match(stdout, /heuristic|cannot prove/i);
    assert.match(stdout, /never .*network|no network/i);
  });

  test('the main help mentions inspect', () => {
    assert.match(qrgen(['--help']).stdout, /inspect/);
  });
});

describe('qrgen inspect: never touches the network', () => {
  const NETWORK = /node:(?:http|https|net|dns|tls|dgram|http2)\b|from\s+['"](?:http|https|net|dns|tls|dgram|http2|undici|axios|node-fetch)['"]|\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|\bdns\.|\bnet\.connect|createConnection/;

  test('no networking module or API in src/inspect or the CLI', () => {
    const files = readdirSync(join(ROOT, 'src', 'inspect')).map((f) => join(ROOT, 'src', 'inspect', f));
    files.push(join(ROOT, 'src', 'cli.js'));
    for (const file of files) {
      const offending = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => NETWORK.test(line));
      assert.deepEqual(offending, [], file);
    }
  });

  test('src/inspect imports nothing outside src/inspect and src/core', () => {
    for (const f of readdirSync(join(ROOT, 'src', 'inspect'))) {
      const imports = [...readFileSync(join(ROOT, 'src', 'inspect', f), 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const spec of imports) assert.match(spec, /^\.\/|^\.\.\/core\//, `${f} imports ${spec}`);
    }
  });
});
