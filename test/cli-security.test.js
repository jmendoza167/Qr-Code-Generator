// Security regression tests for the CLI: bounded stdin, and no terminal
// escape sequences echoed back from user input.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import { run, printable, MAX_INPUT_BYTES, EXIT_OK, EXIT_ERROR } from '../src/cli.js';
import { decodeRgba } from './helpers/decode.js';

const { PNG } = pngjs;
const BIN = fileURLToPath(new URL('../bin/qrgen.js', import.meta.url));

function qrgen(args, input = '') {
  const result = spawnSync(process.execPath, [BIN, ...args], { input: Buffer.from(input), encoding: 'buffer' });
  return { status: result.status, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
}

/** Collects what run() writes. */
function sink() {
  const stream = { text: '', write: (chunk) => ((stream.text += chunk), true) };
  return stream;
}

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qrgen-sec-'));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('stdin is bounded by the maximum QR capacity', () => {
  test('the limit is the largest capacity of any QR code (7089 digits in version 40-L)', () => {
    assert.equal(MAX_INPUT_BYTES, 7089);
  });

  test('an endless stdin stream is abandoned after the limit instead of being read forever', async () => {
    let produced = 0;
    let closed = false;
    async function* endless() {
      try {
        for (;;) {
          produced += 1024;
          yield Buffer.alloc(1024, 0x41);
        }
      } finally {
        closed = true;
      }
    }
    const stdout = sink();
    const stderr = sink();
    const code = await run([], { stdin: Readable.from(endless(), { objectMode: false }), stdout, stderr });
    assert.equal(code, EXIT_ERROR);
    assert.match(stderr.text, /^qrgen: Data too long: the input is larger than 7089 bytes/);
    assert.equal(stdout.text, '');
    assert.ok(closed, 'the stream was closed');
    assert.ok(produced < 1024 * 1024, `read ${produced} bytes before stopping`);
  });

  test('the real CLI exits with "Data too long" while the writer is still sending', async () => {
    const child = spawn(process.execPath, [BIN], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    let sent = 0;
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdout.resume();
    child.stdin.on('error', () => {}); // EPIPE once the child stops reading: expected
    const block = Buffer.alloc(64 * 1024, 0x31);
    const pump = setInterval(() => {
      // Never calls end(): only the size limit can make the child stop.
      if (child.stdin.writable) {
        child.stdin.write(block);
        sent += block.length;
      }
    }, 5);
    const guard = setTimeout(() => child.kill(), 20000);
    const [status] = await new Promise((resolve) => child.on('close', (...args) => resolve(args)));
    clearInterval(pump);
    clearTimeout(guard);
    assert.equal(status, 1, `stderr: ${stderr}`);
    assert.match(stderr, /^qrgen: Data too long/);
    assert.ok(sent < 256 * 1024 * 1024, `sent ${sent} bytes`);
  });

  test('a large piped input fails fast with exit code 1 and writes no file', () => {
    const file = join(dir, 'big.png');
    const started = Date.now();
    const { status, stderr } = qrgen(['-o', file], Buffer.alloc(32 * 1024 * 1024, 0x61));
    assert.equal(status, 1);
    assert.match(stderr, /^qrgen: Data too long/);
    assert.doesNotMatch(stderr, /--help/);
    assert.equal(existsSync(file), false);
    assert.ok(Date.now() - started < 15000);
  });

  test('one byte over the limit is refused; the Wi-Fi password prompt is bounded too', () => {
    assert.match(qrgen(['-e', 'L'], '7'.repeat(MAX_INPUT_BYTES + 6)).stderr, /Data too long/);
    const wifi = qrgen(['wifi', '--ssid', 'Home'], 'p'.repeat(100000));
    assert.equal(wifi.status, 1);
    assert.match(wifi.stderr, /Data too long/);
  });

  test('input of exactly the maximum capacity still works, with a BOM and a trailing CRLF', () => {
    const file = join(dir, 'max.png');
    const digits = '7'.repeat(MAX_INPUT_BYTES);
    const { status, stderr } = qrgen(['-o', file, '-e', 'L', '-s', '3'], Buffer.from(`\ufeff${digits}\r\n`, 'utf8'));
    assert.equal(status, 0, stderr);
    const png = PNG.sync.read(readFileSync(file));
    assert.equal(decodeRgba(png.data, png.width, png.height).data, digits);
  });

  test('ordinary stdin input is unaffected', async () => {
    const stdout = sink();
    const stderr = sink();
    const code = await run(['--info'], { stdin: Readable.from([Buffer.from('hello\n')], { objectMode: false }), stdout, stderr });
    assert.equal(code, EXIT_OK, stderr.text);
    assert.match(stdout.text, /Version: 1 /);
  });
});

describe('terminal escape sequences in user input are never echoed raw', () => {
  const ESC = '\x1b';
  const BEL = '\x07';
  const CSI = '\x9b'; // one-character CSI (C1)
  // Anything a terminal would act on. Line feeds end our own lines; nothing else is allowed.
  const RAW_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
  const CLEAR = `${ESC}[2J${ESC}[H`;
  const TITLE = `${ESC}]0;pwned${BEL}`;

  function assertClean({ stdout, stderr }, label) {
    for (const [name, text] of [['stdout', stdout], ['stderr', stderr]]) {
      const hit = RAW_CONTROL.exec(text.replace(/\r\n/g, '\n'));
      assert.equal(hit, null, `${label}: raw U+${hit?.[0].charCodeAt(0).toString(16)} in ${name}: ${JSON.stringify(text)}`);
    }
  }

  test('printable() escapes C0, DEL, C1, line separators and bidi overrides, and nothing else', () => {
    assert.equal(printable(`a${ESC}[31mb`), 'a\\x1b[31mb');
    assert.equal(printable(`${BEL}\b\t\n\r\x00\x7f${CSI}`), '\\x07\\x08\\x09\\x0a\\x0d\\x00\\x7f\\x9b');
    assert.equal(printable('\u2028\u2029\u202e\u2066'), '\\u2028\\u2029\\u202e\\u2066');
    assert.equal(printable('Café 日本語 🎉 C:\\dir\\file.png "quoted"'), 'Café 日本語 🎉 C:\\dir\\file.png "quoted"');
    for (let code = 0; code < 0xa0; code++) {
      const out = printable(String.fromCharCode(code));
      assert.doesNotMatch(out, /[\u0000-\u001f\u007f-\u009f]/, `U+${code.toString(16)}`);
    }
  });

  // [arguments, text that must show up escaped in the output]
  const cases = [
    ['unknown option', [`--${ESC}[31mbogus`, 'x']],
    ['unknown short option cluster', ['x', `--no${CLEAR}`]],
    ['output path with an unknown extension', ['x', '-o', `out${CLEAR}.gif`]],
    ['output path that sets the window title', ['x', '-o', join('no-such-dir', `out${TITLE}.png`)]],
    ['output path with a one-byte CSI', ['x', '-o', join('no-such-dir', `out${CSI}31m.svg`)]],
    ['output path with a bidi override', ['x', '-o', join('no-such-dir', 'out\u202egnp.svg')]],
    ['logo path', ['x', '-o', 'never-written.png', '--logo', `logo${CLEAR}${TITLE}.png`]],
    ['SVG logo path', ['x', '-o', 'never-written.svg', '--logo', `logo${ESC}[31m.svg`]],
    ['--ecc', ['x', '-e', `${ESC}[31mQ`]],
    ['--scale', ['x', '-s', `${ESC}[5m9`]],
    ['--margin', ['x', '-m', `4${CSI}2J`]],
    ['--fg', ['x', '-o', 'never-written.png', '--fg', `${ESC}[31m#000`]],
    ['--bg', ['x', '-o', 'never-written.png', '--bg', `#fff${BEL}`]],
    ['--shape', ['x', '--shape', `dots${CLEAR}`]],
    ['--finder', ['x', '--finder', `${TITLE}circle`]],
    ['--finder-color', ['x', '--finder-color', `${ESC}[0m`]],
    ['--gradient', ['x', '--gradient', `#000,${ESC}[31m`]],
    ['--gradient-dir', ['x', '--gradient', '#000,#333', '--gradient-dir', `up${ESC}[A`]],
    ['--logo-size', ['x', '--logo', 'l.png', '--logo-size', `${ESC}[31m20`]],
    ['--logo-padding', ['x', '--logo', 'l.png', '--logo-padding', `1${ESC}[31m`]],
    ['--logo-bg', ['x', '--logo', 'l.png', '--logo-bg', `${ESC}]0;x${BEL}`]],
    ['extra positional', ['one', `two${CLEAR}`]],
    ['wifi --security', ['wifi', '--ssid', 'Home', '--pass', 'x', '--security', `WPA${CLEAR}`]],
    ['wifi --ssid', ['wifi', '--ssid', `Home${CLEAR}`, '--pass', 'x']],
    ['wifi unknown option', ['wifi', `--${ESC}[31mssid`, 'Home']],
    ['contact unknown option', ['contact', '--name', 'A B', `--nick${TITLE}`, 'x']],
  ];

  for (const [label, args] of cases) {
    test(`${label}: the real CLI prints no raw control characters`, () => {
      const result = qrgen(args);
      assertClean(result, label);
      assert.notEqual(result.status, 0, `${label} was expected to fail: ${result.stdout}`);
      assert.match(result.stderr, /^qrgen: /);
      // Where the message quotes the input, it is quoted in escaped form (this one message does not quote it).
      if (label !== 'extra positional') {
        assert.match(result.stderr, /\\x1b|\\x9b|\\x07|\\u202e|\\u00(1b|07|9b)|control character/, `${label}: the input is shown escaped: ${result.stderr}`);
      }
    });
  }

  test('the text to encode can still contain control characters; they are encoded, not printed', () => {
    const file = join(dir, 'esc.png');
    const text = `a${CLEAR}b${TITLE}`;
    const result = qrgen([text, '-o', file, '--info']);
    assert.equal(result.status, 0, result.stderr);
    assertClean(result, 'encode');
    const png = PNG.sync.read(readFileSync(file));
    assert.equal(decodeRgba(png.data, png.width, png.height).data, text);
  });

  test('"Saved <path>" escapes the path it echoes', async () => {
    // Windows refuses control characters in file names, so the message is
    // either "Saved ..." (POSIX) or the write error; neither may be raw.
    const file = join(dir, `saved${ESC}[31m${TITLE}.svg`);
    const stdout = sink();
    const stderr = sink();
    const code = await run(['x', '-o', file], { stdin: Readable.from([]), stdout, stderr });
    assertClean({ stdout: stdout.text, stderr: stderr.text }, 'saved');
    const message = code === EXIT_OK ? stdout.text : stderr.text;
    assert.match(message, code === EXIT_OK ? /^Saved / : /^qrgen: /);
    assert.ok(message.includes('saved\\x1b[31m\\x1b]0;pwned\\x07.svg'), message);
  });

  test('notes and warnings built from a logo file name are escaped too', async () => {
    const stdout = sink();
    const stderr = sink();
    const code = await run(['x', '-o', join(dir, 'w.png'), '--logo', join(dir, `missing${CLEAR}.png`)], { stdin: Readable.from([]), stdout, stderr });
    assert.notEqual(code, EXIT_OK);
    assertClean({ stdout: stdout.text, stderr: stderr.text }, 'logo');
    assert.match(stderr.text, /Cannot read logo file .*missing\\x1b\[2J\\x1b\[H\.png/);
  });
});
