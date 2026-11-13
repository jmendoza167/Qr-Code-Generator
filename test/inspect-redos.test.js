// Regression tests for regular-expression denial of service (ReDoS) in the
// inspector. Decoded QR content is attacker-controlled, so every pattern
// that runs on it must stay linear. The worst cases run in a child process
// with a hard timeout, so a regression fails the test instead of hanging
// the suite.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { trimTrailingPunctuation, extractUrls, classifyPayload } from '../src/inspect/payload.js';
import { inspectText } from '../src/inspect/text-checks.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const url = (relative) => pathToFileURL(join(ROOT, relative)).href;
const BUDGET_MS = 100;
const N = 50000;

/** The regex this function replaced, kept here as the reference for equivalence tests. */
const OLD_TRIM = (text) => text.replace(/[.,;:!?]+$/, '');

describe('trimTrailingPunctuation: same results as the old regex', () => {
  test('ordinary URLs and sentence endings', () => {
    for (const text of [
      'https://example.com',
      'https://example.com.',
      'https://example.com/path?x=1!',
      'https://example.com/a,b;c:d',
      'https://example.com/...',
      'https://example.com/?!.,;:',
      'www.example.com/page.html',
      'www.example.com/page.html.',
      'https://a.example/!!!a',
      '',
      '!!!',
      '.',
      'a',
    ]) {
      assert.equal(trimTrailingPunctuation(text), OLD_TRIM(text), JSON.stringify(text));
    }
  });

  test('random strings over the punctuation alphabet agree with the regex', () => {
    const alphabet = '.,;:!?a/-';
    let seed = 12345;
    const next = (n) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let i = 0; i < 5000; i++) {
      let text = '';
      for (let length = next(24); length > 0; length--) text += alphabet[next(alphabet.length)];
      assert.equal(trimTrailingPunctuation(text), OLD_TRIM(text), JSON.stringify(text));
    }
  });

  test('extractUrls still strips trailing punctuation and keeps inner punctuation', () => {
    assert.deepEqual(
      extractUrls('See https://example.com/a!b?c=1. Or www.example.org/x;y!!', 'body').map((u) => u.url),
      ['https://example.com/a!b?c=1', 'www.example.org/x;y'],
    );
  });
});

describe('inspector worst cases finish in linear time', () => {
  // Each case is built inside the child from a short spec, timed there, and
  // reported back. The parent's timeout is the backstop for a real hang.
  const cases = {
    'extractUrls: "!" x 50000 then a letter': `extractUrls('https://a.example/' + '!'.repeat(${N}) + 'a', 'body')`,
    'extractUrls: "." x 50000 then a letter': `extractUrls('www.a.example/' + '.'.repeat(${N}) + 'a', 'body')`,
    'extractUrls: mixed punctuation run': `extractUrls('https://a.example/' + '.,;:!?'.repeat(${N / 6}) + 'a', 'body')`,
    'trimTrailingPunctuation: all punctuation': `trimTrailingPunctuation('!'.repeat(${N}))`,
    'SMS body': `inspectPayload('sms:+1?body=https://a.example/' + '!'.repeat(${N}) + 'a')`,
    'email body': `inspectPayload('mailto:a@b.example?body=' + encodeURIComponent('https://a.example/' + '!'.repeat(${N}) + 'a'))`,
    'vCard note': `inspectPayload('BEGIN:VCARD\\nNOTE:www.a.example/' + '.'.repeat(${N}) + 'a\\nEND:VCARD')`,
    'vCard with many URL lines': `inspectPayload('BEGIN:VCARD\\n' + 'NOTE:https://a.example/ https://b.example/\\n'.repeat(${N / 40}) + 'END:VCARD')`,
    'URL with a long punctuation path': `inspectPayload('https://a.example/' + '!'.repeat(${N}) + 'a')`,
    'URL with heavy percent-encoding': `inspectPayload('https://a.example/' + '%41'.repeat(${N / 3}))`,
    'bare-domain test that fails at the end': `inspectPayload('a.'.repeat(${N / 2}) + '!')`,
    'scheme-like prefix without a colon': `inspectPayload('a'.repeat(${N}))`,
    'control characters': `inspectText('\\u001b'.repeat(${N}))`,
    'bidi characters': `inspectText('\\u202e'.repeat(${N}))`,
  };

  const script = `
    const { extractUrls, trimTrailingPunctuation } = await import(${JSON.stringify(url('src/inspect/payload.js'))});
    const { inspectPayload } = await import(${JSON.stringify(url('src/inspect/inspect.js'))});
    const { inspectText } = await import(${JSON.stringify(url('src/inspect/text-checks.js'))});
    // Warm up so the first case does not pay for compilation.
    inspectPayload('sms:+1?body=https://a.example/!a');
    inspectText('x');
    const results = {};
    ${Object.entries(cases)
      .map(([label, expr]) => `{ const t = performance.now(); ${expr}; results[${JSON.stringify(label)}] = performance.now() - t; }`)
      .join('\n    ')}
    console.log(JSON.stringify(results));
  `;

  test(`every case takes well under ${BUDGET_MS} ms`, () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.error, undefined, `child process failed or timed out: ${result.error?.message}`);
    assert.equal(result.status, 0, result.stderr);
    const timings = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(timings).sort(), Object.keys(cases).sort());
    for (const [label, ms] of Object.entries(timings)) {
      assert.ok(ms < BUDGET_MS, `${label} took ${ms.toFixed(1)} ms`);
    }
  });

  test('results on the worst cases are still correct', () => {
    assert.deepEqual(
      extractUrls(`https://a.example/${'!'.repeat(N)}a`, 'body').map((u) => u.url.length),
      [`https://a.example/${'!'.repeat(N)}a`.length],
      'punctuation inside the URL is kept',
    );
    assert.deepEqual(extractUrls(`https://a.example/a${'!'.repeat(N)}`, 'body').map((u) => u.url), ['https://a.example/a']);
    assert.equal(trimTrailingPunctuation('!'.repeat(N)), '');
    assert.equal(inspectText('\u202e'.repeat(10))[0].id, 'text-bidi');
  });

  test('embedded URL extraction stops at the cap, even across many vCard lines', () => {
    const card = `BEGIN:VCARD\n${'NOTE:https://a.example/ https://b.example/\n'.repeat(1000)}END:VCARD`;
    assert.equal(classifyPayload(card).embeddedUrls.length, 20);
  });
});

describe('source hygiene', () => {
  test('no literal bidirectional control or line-separator characters in src/ ("Trojan Source")', () => {
    const offenders = [];
    for (const file of readdirSync(join(ROOT, 'src'), { recursive: true })) {
      if (!file.endsWith('.js')) continue;
      const source = readFileSync(join(ROOT, 'src', file), 'utf8');
      const found = [...source].filter((ch) => /[\u202a-\u202e\u2066-\u2069\u2028\u2029]/.test(ch));
      if (found.length > 0) offenders.push(`src/${file}: ${found.map((ch) => `U+${ch.codePointAt(0).toString(16)}`).join(' ')}`);
    }
    assert.deepEqual(offenders, [], 'write these as \\u escapes instead');
  });
});
