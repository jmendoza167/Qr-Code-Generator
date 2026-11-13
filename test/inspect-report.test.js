// The plain-text report: verdict first, one line per finding, the escaped
// content, and the disclaimer. The escape function is injected so the pure
// formatter never depends on the CLI.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inspectPayload } from '../src/inspect/inspect.js';
import { formatReport } from '../src/inspect/format.js';

const escape = (s) => s.replace(/[\u0000-\u001f‪-‮]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

describe('formatReport', () => {
  test('no findings: verdict, type, content and disclaimer', () => {
    const out = formatReport(inspectPayload('https://github.com/'), { escape });
    const lines = out.split('\n');
    assert.match(lines[0], /^Verdict: no findings/);
    assert.match(out, /Type: URL/);
    assert.match(out, /Content \(escaped\):\nhttps:\/\/github\.com\//);
    assert.match(out, /heuristic/i);
    assert.match(out, /cannot prove|does not prove/i);
  });

  test('findings are listed by severity, highest first, with an explanation', () => {
    const out = formatReport(inspectPayload('http://paypa1.com/login'), { escape });
    const findingLines = out.split('\n').filter((l) => /^\s*\[(HIGH|MEDIUM|LOW|INFO)\]/.test(l));
    assert.ok(findingLines.length >= 3, out);
    assert.match(findingLines[0], /^\s*\[HIGH\] .*paypal/i);
    assert.match(findingLines[findingLines.length - 1], /^\s*\[LOW\]/);
    assert.match(out, /^Verdict: HIGH/m);
    for (const line of findingLines) assert.match(line, /\] .+: .+\.$/, 'title: explanation.');
  });

  test('the content is passed through the escape function, including the finding details', () => {
    const payload = 'https://example.com/\u001b[31mred‮';
    const out = formatReport(inspectPayload(payload), { escape });
    assert.ok(!out.includes('\u001b'), 'raw ESC must not appear');
    assert.ok(!out.includes('‮'), 'raw bidi override must not appear');
    assert.match(out, /\\u001b\[31mred\\u202e/);
  });

  test('metadata is shown when present', () => {
    const out = formatReport(inspectPayload('hello', { version: 3, ecc: 'Q', errorsCorrected: 4, encoding: 'utf-8', eci: null, inverted: false }), { escape });
    assert.match(out, /version 3/);
    assert.match(out, /level Q/);
    assert.match(out, /4 codewords? corrected|corrected: 4/i);
  });

  test('the JSON form is the report itself with raw text', () => {
    const report = inspectPayload('https://example.com/\u001b');
    const json = JSON.parse(JSON.stringify(report));
    assert.equal(json.text, 'https://example.com/\u001b');
    assert.equal(json.verdict, 'medium');
    assert.ok(Array.isArray(json.findings));
    assert.deepEqual(Object.keys(json.findings[0]).sort(), ['detail', 'id', 'severity', 'title', 'where']);
  });
});
