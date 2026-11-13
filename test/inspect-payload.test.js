// Payload classification, the non-URL checks, decoder metadata notes and
// the verdict rules of the inspector.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPayload } from '../src/inspect/payload.js';
import { inspectText } from '../src/inspect/text-checks.js';
import { inspectPayload, verdictFor } from '../src/inspect/inspect.js';
import { buildWifiPayload } from '../src/presets/wifi.js';
import { buildVCard } from '../src/presets/vcard.js';

const ids = (text, meta) => inspectPayload(text, meta).findings.map((f) => f.id);
const severity = (text, id, meta) => inspectPayload(text, meta).findings.find((f) => f.id === id)?.severity;

describe('classifyPayload', () => {
  test('recognises every payload type', () => {
    assert.equal(classifyPayload('https://example.com').type, 'url');
    assert.equal(classifyPayload('HTTP://EXAMPLE.COM').type, 'url');
    assert.equal(classifyPayload('javascript:alert(1)').type, 'url');
    assert.equal(classifyPayload('WIFI:T:WPA;S:Home;P:secret;;').type, 'wifi');
    assert.equal(classifyPayload('BEGIN:VCARD\nVERSION:3.0\nFN:A\nEND:VCARD').type, 'vcard');
    assert.equal(classifyPayload('mailto:someone@example.com').type, 'email');
    assert.equal(classifyPayload('MAILTO:someone@example.com?subject=hi').type, 'email');
    assert.equal(classifyPayload('tel:+34600000000').type, 'phone');
    assert.equal(classifyPayload('sms:+34600000000?body=hi').type, 'sms');
    assert.equal(classifyPayload('SMSTO:+34600000000:hi').type, 'sms');
    assert.equal(classifyPayload('geo:40.4168,-3.7038').type, 'geo');
    assert.equal(classifyPayload('just some words').type, 'text');
    assert.equal(classifyPayload('12345').type, 'text');
    assert.equal(classifyPayload('ftp://files.example.com/x').type, 'scheme');
    assert.equal(classifyPayload('otpauth://totp/x?secret=abc').type, 'scheme');
  });

  test('a bare domain or www address is a URL without a scheme', () => {
    assert.equal(classifyPayload('www.example.com/page').type, 'url');
    assert.equal(classifyPayload('example.com').type, 'url');
    assert.equal(classifyPayload('example.com/path?x=1').type, 'url');
    assert.equal(classifyPayload('hello world.com is not').type, 'text');
    assert.equal(classifyPayload('v1.2.3').type, 'text');
  });

  test('parses Wi-Fi fields including escapes', () => {
    const wifi = classifyPayload(buildWifiPayload({ ssid: 'Café;Net', password: 'p\\ss;word', security: 'WPA', hidden: true })).wifi;
    assert.deepEqual(wifi, { security: 'WPA', ssid: 'Café;Net', password: 'p\\ss;word', hidden: true });
    assert.deepEqual(classifyPayload('WIFI:S:Open;T:nopass;;').wifi, { security: 'nopass', ssid: 'Open', password: '', hidden: false });
  });

  test('extracts URLs embedded in email bodies, SMS bodies and vCards', () => {
    const email = classifyPayload('mailto:a@example.com?subject=Hi&body=See%20https://evil.example/login%20now');
    assert.deepEqual(email.embeddedUrls.map((u) => u.url), ['https://evil.example/login']);
    assert.equal(email.embeddedUrls[0].where, 'email body');
    const sms = classifyPayload('sms:+1555?body=Click http://bit.ly/x');
    assert.deepEqual(sms.embeddedUrls.map((u) => u.url), ['http://bit.ly/x']);
    assert.equal(sms.sms.body, 'Click http://bit.ly/x');
    const smsto = classifyPayload('SMSTO:+1555:Your code https://a.example/b');
    assert.equal(smsto.sms.body, 'Your code https://a.example/b');
    const card = classifyPayload(buildVCard({ name: 'A B', url: 'https://example.com', note: 'see www.evil.example/verify' }));
    assert.deepEqual(card.embeddedUrls.map((u) => u.url).sort(), ['https://example.com', 'www.evil.example/verify']);
  });

  test('the number of embedded URLs is capped', () => {
    const many = Array.from({ length: 100 }, (_, i) => `https://h${i}.example/`).join(' ');
    assert.ok(classifyPayload(`mailto:a@b.example?body=${encodeURIComponent(many)}`).embeddedUrls.length <= 20);
  });
});

describe('inspectText: control and bidi characters', () => {
  test('bidi overrides are high, other control characters are medium', () => {
    assert.equal(inspectText('abc‮def').find((f) => f.id === 'text-bidi')?.severity, 'high');
    assert.equal(inspectText('abc⁦def⁩').find((f) => f.id === 'text-bidi')?.severity, 'high');
    assert.equal(inspectText('abc\u001b[31mdef').find((f) => f.id === 'text-control')?.severity, 'medium');
    assert.equal(inspectText('abc\u0000').find((f) => f.id === 'text-control')?.severity, 'medium');
    assert.equal(inspectText('abc\u009bdef').find((f) => f.id === 'text-control')?.severity, 'medium');
  });

  test('line breaks and tabs are normal (vCards need them)', () => {
    assert.deepEqual(inspectText('BEGIN:VCARD\r\nFN:A\tB\nEND:VCARD'), []);
    assert.deepEqual(inspectText('plain text, café, 日本語, 🙂'), []);
  });
});

describe('inspectPayload: Wi-Fi, SMS, email and vCard checks', () => {
  test('open and WEP networks are medium, hidden is low, WPA with a password is nothing', () => {
    assert.equal(severity('WIFI:T:nopass;S:Free;;', 'wifi-open'), 'medium');
    assert.equal(severity('WIFI:S:Free;;', 'wifi-open'), 'medium', 'no T field means open');
    assert.equal(severity('WIFI:T:WEP;S:Old;P:1234567890;;', 'wifi-wep'), 'medium');
    assert.equal(severity('WIFI:T:WPA;S:Home;P:secret;H:true;;', 'wifi-hidden'), 'low');
    assert.deepEqual(ids(buildWifiPayload({ ssid: 'Home', password: 'secret' })), []);
  });

  test('SMS with a pre-filled body is low; a link in it is checked', () => {
    assert.equal(severity('sms:+1555?body=hello', 'sms-body'), 'low');
    assert.deepEqual(ids('sms:+1555'), []);
    const findings = inspectPayload('smsto:+1555:Confirm at http://paypa1.com/login').findings;
    assert.ok(findings.some((f) => f.id === 'brand-lookalike' && f.where === 'SMS body'));
  });

  test('an email body containing a link is medium; a plain mailto is nothing', () => {
    assert.equal(severity('mailto:a@example.com?body=Read%20https://example.com/news', 'email-body-link'), 'medium');
    assert.deepEqual(ids('mailto:a@example.com?subject=Hello'), []);
    assert.deepEqual(ids('mailto:a@example.com'), []);
  });

  test('URLs inside a vCard go through the URL checks', () => {
    const card = buildVCard({ name: 'A B', url: 'http://bit.ly/card' });
    const findings = inspectPayload(card).findings;
    assert.ok(findings.some((f) => f.id === 'url-shortener' && /vCard/.test(f.where)));
    assert.deepEqual(ids(buildVCard({ name: 'A B', phones: ['+34 600 000 000'], url: 'https://example.com' })), []);
  });

  test('phone, geo and plain text with nothing odd produce no findings', () => {
    for (const text of ['tel:+34600000000', 'geo:40.4168,-3.7038', 'Hello, world', 'Ticket 12345 row 7 seat 9']) {
      assert.deepEqual(ids(text), [], text);
    }
  });

  test('an unknown scheme is a low note', () => {
    assert.equal(severity('ftp://files.example.com/x', 'scheme-unknown'), 'low');
    assert.equal(severity('market://details?id=com.example', 'scheme-unknown'), 'low');
  });

  test('a URL without a scheme is a low note and still gets the URL checks', () => {
    assert.equal(severity('www.paypa1.com/login', 'url-no-scheme'), 'low');
    assert.equal(severity('www.paypa1.com/login', 'brand-lookalike'), 'high');
  });
});

describe('inspectPayload: decoder metadata', () => {
  test('Latin-1 fallback and ECI designators are low notes', () => {
    assert.equal(severity('hello', 'meta-latin1', { encoding: 'latin-1' }), 'low');
    assert.equal(severity('hello', 'meta-eci', { eci: 3 }), 'low');
    assert.deepEqual(ids('hello', { encoding: 'utf-8', eci: null }), []);
  });

  test('a high corrected-error count is an informational note that does not change the verdict', () => {
    // 1-M: one block of 10 EC codewords corrects 5; 3 corrected is 60 % of capacity.
    const report = inspectPayload('hello', { version: 1, ecc: 'M', errorsCorrected: 3 });
    assert.equal(report.findings.find((f) => f.id === 'meta-damage')?.severity, 'info');
    assert.equal(report.verdict, 'none');
    assert.deepEqual(ids('hello', { version: 1, ecc: 'M', errorsCorrected: 0 }), []);
  });
});

describe('verdict rules', () => {
  const f = (severity, id = `x-${severity}`) => ({ id, severity });

  test('the verdict is the highest severity, info never counts', () => {
    assert.equal(verdictFor([]), 'none');
    assert.equal(verdictFor([f('info')]), 'none');
    assert.equal(verdictFor([f('low')]), 'low');
    assert.equal(verdictFor([f('low'), f('medium')]), 'medium');
    assert.equal(verdictFor([f('high'), f('low')]), 'high');
  });

  test('credential-bait words alone are low, and promote any other finding one step', () => {
    assert.equal(verdictFor([f('low', 'url-credential-bait')]), 'low');
    assert.equal(verdictFor([f('low', 'url-credential-bait'), f('low', 'url-http')]), 'medium');
    assert.equal(verdictFor([f('low', 'url-credential-bait'), f('medium', 'url-shortener')]), 'high');
    assert.equal(verdictFor([f('low', 'url-credential-bait'), f('info', 'meta-damage')]), 'low');
  });

  test('two low findings without bait stay low', () => {
    assert.equal(verdictFor([f('low', 'url-http'), f('low', 'url-long')]), 'low');
  });

  test('end to end: http plus a bait path is medium, not high', () => {
    const report = inspectPayload('http://example.com/login');
    assert.deepEqual(report.findings.map((x) => x.id).sort(), ['url-credential-bait', 'url-http']);
    assert.equal(report.verdict, 'medium');
    assert.equal(inspectPayload('https://example.com/login').verdict, 'low');
    assert.equal(inspectPayload('https://bit.ly/x/login').verdict, 'high');
    assert.equal(inspectPayload('https://paypal.com@evil.example/').verdict, 'high');
    assert.equal(inspectPayload('https://github.com/').verdict, 'none');
  });

  test('the report shape', () => {
    const report = inspectPayload('https://example.com', { version: 2, ecc: 'L', errorsCorrected: 0, encoding: null, eci: null });
    assert.deepEqual(Object.keys(report).sort(), ['disclaimer', 'findings', 'meta', 'text', 'type', 'verdict']);
    assert.equal(report.type, 'url');
    assert.equal(report.text, 'https://example.com');
    assert.match(report.disclaimer, /heuristic/i);
    assert.match(report.disclaimer, /cannot prove|does not prove/i);
  });
});
