// End-to-end tests of the `qrgen wifi` and `qrgen contact` subcommands.
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
  return {
    status: result.status,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8'),
  };
}

function decodePngFile(file) {
  const png = PNG.sync.read(readFileSync(file));
  return decodeRgba(png.data, png.width, png.height).data;
}

let dir;
let n = 0;
const tmp = (ext) => join(dir, `preset-${n++}.${ext}`);
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'qrgen-presets-'));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('qrgen wifi', () => {
  test('builds a WPA payload and warns that the password is readable', () => {
    const file = tmp('png');
    const { status, stdout, stderr } = qrgen(['wifi', '--ssid', 'Home', '--pass', 'secret', '-o', file]);
    assert.equal(status, 0, stderr);
    assert.match(stdout, /Saved/);
    assert.match(stderr, /password.*plain text/i);
    assert.equal(decodePngFile(file), 'WIFI:T:WPA;S:Home;P:secret;;');
  });

  test('open network with --security nopass, hidden flag, no password note', () => {
    const file = tmp('png');
    const { status, stderr } = qrgen(['wifi', '--ssid', 'Cafe', '--security', 'nopass', '--hidden', '-o', file]);
    assert.equal(status, 0, stderr);
    assert.doesNotMatch(stderr, /plain text/i);
    assert.equal(decodePngFile(file), 'WIFI:T:nopass;S:Cafe;H:true;;');
  });

  test('reads the password from stdin when --pass is omitted and stdin is piped', () => {
    const file = tmp('png');
    const { status, stderr } = qrgen(['wifi', '--ssid', 'Home', '-o', file], 'from-stdin\r\n');
    assert.equal(status, 0, stderr);
    assert.equal(decodePngFile(file), 'WIFI:T:WPA;S:Home;P:from-stdin;;');
  });

  test('all shared output options work: --info, --ascii, --margin', () => {
    const { status, stdout } = qrgen(['wifi', '--ssid', 'Home', '--pass', 'x', '--info', '--ascii', '-m', '0']);
    assert.equal(status, 0);
    assert.match(stdout, /##/);
    assert.match(stdout, /Mode:\s+byte/);
  });

  test('usage errors', () => {
    const cases = [
      [['wifi'], /ssid/],
      [['wifi', '--ssid', 'Home', '--security', 'nopass', '--pass', 'x'], /nopass/],
      [['wifi', '--ssid', 'Home', '--pass', 'x', '--security', 'WPS'], /security/],
      [['wifi', '--ssid', 'Home', '--pass', 'x', 'extra'], /argument/i],
      [['wifi', '--ssid', 'Home', '--name', 'x'], /name/],
    ];
    for (const [args, pattern] of cases) {
      const { status, stderr } = qrgen(args);
      assert.equal(status, 2, `${args.join(' ')}\n${stderr}`);
      assert.match(stderr, pattern);
    }
    // empty piped stdin and no --pass
    const { status, stderr } = qrgen(['wifi', '--ssid', 'Home'], '');
    assert.equal(status, 2);
    assert.match(stderr, /password/i);
  });

  test('--help for the subcommand', () => {
    const { status, stdout } = qrgen(['wifi', '--help']);
    assert.equal(status, 0);
    assert.match(stdout, /Usage: qrgen wifi/);
    assert.match(stdout, /--ssid/);
  });
});

describe('qrgen contact', () => {
  test('builds a vCard with repeated phones and emails', () => {
    const file = tmp('png');
    const args = [
      'contact', '--name', 'Javier Mendoza', '--phone', '+34600000000', '--phone', '+34911111111',
      '--email', 'javier@example.com', '--org', 'Example', '--title', 'Dev', '--url', 'https://example.com',
      '--address', 'Calle Mayor 1', '--note', 'hi', '-o', file,
    ];
    const { status, stderr } = qrgen(args);
    assert.equal(status, 0, stderr);
    assert.equal(
      decodePngFile(file),
      'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Mendoza;Javier;;;\r\nFN:Javier Mendoza\r\nORG:Example\r\nTITLE:Dev\r\n' +
        'TEL:+34600000000\r\nTEL:+34911111111\r\nEMAIL:javier@example.com\r\nURL:https://example.com\r\n' +
        'ADR:;;Calle Mayor 1;;;;\r\nNOTE:hi\r\nEND:VCARD\r\n',
    );
  });

  test('accented names survive as UTF-8', () => {
    const file = tmp('png');
    const { status, stderr } = qrgen(['contact', '--name', 'José Núñez', '-o', file, '-e', 'Q']);
    assert.equal(status, 0, stderr);
    assert.match(decodePngFile(file), /N:Núñez;José;;;\r\nFN:José Núñez/);
  });

  test('--name is required', () => {
    const { status, stderr } = qrgen(['contact', '--phone', '123']);
    assert.equal(status, 2);
    assert.match(stderr, /--name/);
  });

  test('--help for the subcommand', () => {
    const { status, stdout } = qrgen(['contact', '-h']);
    assert.equal(status, 0);
    assert.match(stdout, /Usage: qrgen contact/);
  });
});

describe('literal text that looks like a subcommand', () => {
  test('qrgen -o file -- wifi encodes the word "wifi"', () => {
    const file = tmp('png');
    const { status, stderr } = qrgen(['-o', file, '--', 'wifi']);
    assert.equal(status, 0, stderr);
    assert.equal(decodePngFile(file), 'wifi');
  });

  test('the main help mentions the subcommands and the -- escape', () => {
    const { stdout } = qrgen(['--help']);
    assert.match(stdout, /qrgen wifi/);
    assert.match(stdout, /qrgen contact/);
    assert.match(stdout, /--\s+wifi/);
  });
});

describe('qrgen wifi: control characters are refused', () => {
  test('a line break in --ssid or --pass is a usage error and nothing is written', () => {
    for (const args of [
      ['wifi', '--ssid', 'Guest;;\nWIFI:T:nopass;S:EvilTwin;;', '--pass', 'secret'],
      ['wifi', '--ssid', 'Home', '--pass', 'secret\r\nH:true'],
      ['wifi', '--ssid', 'Ho\tme', '--security', 'nopass'],
    ]) {
      const file = tmp('png');
      const { status, stdout, stderr } = qrgen([...args, '-o', file]);
      assert.equal(status, 2, stderr);
      assert.match(stderr, /^qrgen: The Wi-Fi (ssid|password) contains a control character/);
      assert.doesNotMatch(stderr, /EvilTwin|secret/);
      assert.equal(stdout, '');
      assert.throws(() => readFileSync(file), /ENOENT/);
    }
  });

  test('a password piped through stdin with more than one line is refused', () => {
    const { status, stderr } = qrgen(['wifi', '--ssid', 'Home'], 'secret\nWIFI:T:nopass;S:EvilTwin;;\n');
    assert.equal(status, 2);
    assert.match(stderr, /Wi-Fi password contains a control character \(U\+000A/);
  });
});
