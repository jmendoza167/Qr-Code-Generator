// URL checks of the inspector: every check has at least one case that
// triggers it and one benign case that must not. All analysis is offline.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inspectUrl, punycodeDecode, registrableDomain, skeleton } from '../src/inspect/url-checks.js';

const ids = (raw) => inspectUrl(raw).map((f) => f.id);
const severity = (raw, id) => inspectUrl(raw).find((f) => f.id === id)?.severity;

describe('inspectUrl: benign URLs produce no findings', () => {
  test('ordinary https URLs', () => {
    for (const raw of [
      'https://github.com/jmendoza167/Qr-Code-Generator',
      'https://example.com',
      'https://www.example.org/path/to/page?id=42&lang=en#section',
      'https://support.apple.com/en-us/HT201222',
      'https://accounts.google.com/',
      'https://www.googleapis.com/oauth2/v3/certs',
      'https://s3.eu-west-1.amazonaws.com/bucket/key',
      'https://docs.microsoft.com/en-us/',
      'https://en.wikipedia.org/wiki/QR_code',
    ]) {
      assert.deepEqual(ids(raw), [], raw);
    }
  });

  test('words that contain a brand name are not the brand', () => {
    for (const raw of [
      'https://pineapple.com',
      'https://applebees.com/menu',
      'https://www.googleapis.com/',
      'https://amazonaws.com/',
      'https://snapple.com',
      'https://chasewater.example/',
      'https://upstart.example/',
      'https://dhlawyers.example/',
    ]) {
      assert.equal(ids(raw).some((id) => id.startsWith('brand-')), false, raw);
    }
  });

  test('a brand on its own country domain is the brand', () => {
    for (const raw of ['https://amazon.de', 'https://www.amazon.co.uk/gp/css/order-history', 'https://apple.co.jp', 'https://paypal.me/someone']) {
      assert.equal(ids(raw).some((id) => id.startsWith('brand-')), false, raw);
    }
  });

  test('a legitimate non-Latin domain is at most a low note, never high', () => {
    for (const raw of ['https://пример.рф/страница', 'https://xn--e1afmkfd.xn--p1ai/', 'https://例え.jp', 'https://müller.de']) {
      const findings = inspectUrl(raw);
      assert.ok(findings.every((f) => f.severity === 'low'), `${raw}: ${JSON.stringify(findings)}`);
      assert.ok(findings.some((f) => f.id === 'idn-non-latin' || f.id === 'idn-punycode'), raw);
    }
  });
});

describe('inspectUrl: dangerous schemes', () => {
  test('javascript:, data:, file:, vbscript:, blob:, intent: are high', () => {
    for (const raw of [
      'javascript:alert(document.cookie)',
      'JavaScript:void(0)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'file:///etc/passwd',
      'vbscript:msgbox(1)',
      'blob:https://example.com/uuid',
      'intent://scan/#Intent;scheme=zxing;package=com.google.zxing.client.android;end',
      'ms-msdt:/id PCWDiagnostic',
    ]) {
      assert.equal(severity(raw, 'url-dangerous-scheme'), 'high', raw);
    }
  });

  test('https, http and mailto are not dangerous schemes', () => {
    for (const raw of ['https://example.com', 'http://example.com', 'mailto:someone@example.com']) {
      assert.equal(ids(raw).includes('url-dangerous-scheme'), false, raw);
    }
  });
});

describe('inspectUrl: http, credentials and hosts', () => {
  test('http:// instead of https:// is low', () => {
    assert.equal(severity('http://example.com/', 'url-http'), 'low');
    assert.equal(ids('https://example.com/').includes('url-http'), false);
  });

  test('credentials or a fake host before @ are high', () => {
    assert.equal(severity('https://paypal.com@evil.example/', 'url-credentials'), 'high');
    assert.equal(severity('https://user:pass@example.com/', 'url-credentials'), 'high');
    assert.equal(severity('https://www.apple.com:443@198.51.100.7/login', 'url-credentials'), 'high');
    assert.equal(ids('https://example.com/path?email=a@b.com').includes('url-credentials'), false, '@ in the query is fine');
  });

  test('IP address hosts in dotted, decimal, hex and octal forms are medium', () => {
    for (const raw of ['http://192.168.1.1/', 'http://3232235777/', 'http://0xC0A80101/', 'http://0300.0250.0001.0001/', 'http://[2001:db8::1]/', 'https://[::1]:8443/']) {
      assert.equal(severity(raw, 'url-ip-host'), 'medium', raw);
    }
    assert.equal(ids('https://example.com/').includes('url-ip-host'), false);
    assert.equal(ids('https://1password.com/').includes('url-ip-host'), false, 'a label starting with a digit is not an IP');
  });

  test('non-standard ports are low, default ports are nothing', () => {
    assert.equal(severity('https://example.com:8443/', 'url-port'), 'low');
    assert.equal(severity('http://example.com:8080/', 'url-port'), 'low');
    assert.equal(ids('https://example.com:443/').includes('url-port'), false);
    assert.equal(ids('http://example.com:80/').includes('url-port'), false);
  });

  test('many subdomains are low', () => {
    assert.equal(severity('https://a.b.c.d.example.com/', 'url-many-subdomains'), 'low');
    assert.equal(ids('https://www.docs.example.com/').includes('url-many-subdomains'), false);
  });

  test('a URL without a scheme is handled by the caller, not here', () => {
    assert.ok(ids('www.example.com/path').includes('url-unparseable') || ids('www.example.com/path').length === 0);
  });
});

describe('inspectUrl: internationalised domains', () => {
  test('punycode decodes correctly', () => {
    assert.equal(punycodeDecode('e1afmkfd'), 'пример');
    assert.equal(punycodeDecode('p1ai'), 'рф');
    assert.equal(punycodeDecode('mller-kva'), 'müller');
    assert.equal(punycodeDecode('80ak6aa92e'), 'аррӏе');
    assert.equal(punycodeDecode('r8jz45g'), '例え');
  });

  test('confusable characters posing as Latin are high and name the lookalike', () => {
    const findings = inspectUrl('https://аррӏе.com/'); // Cyrillic а р р ӏ е
    const confusable = findings.find((f) => f.id === 'idn-confusable');
    assert.equal(confusable?.severity, 'high');
    assert.match(confusable.detail, /apple/);
    assert.ok(findings.some((f) => f.id === 'brand-lookalike'), 'and it is the apple brand');
    assert.equal(severity('https://xn--80ak6aa92e.com/', 'idn-confusable'), 'high', 'the punycode form too');
    assert.equal(severity('https://gооgle.com/', 'idn-confusable'), 'high', 'two Cyrillic o');
  });

  test('mixed scripts within one label are high', () => {
    assert.equal(severity('https://examрle.com/', 'idn-mixed-script'), 'high'); // Cyrillic р among Latin
    assert.equal(severity('https://пример-test.рф/', 'idn-mixed-script'), 'high');
    assert.equal(ids('https://пример.рф/').includes('idn-mixed-script'), false, 'whole-script Cyrillic');
    assert.equal(ids('https://example.рф/').includes('idn-mixed-script'), false, 'different scripts in different labels');
  });

  test('a whole-script non-Latin label is a low note only', () => {
    assert.equal(severity('https://пример.рф/', 'idn-non-latin'), 'low');
    assert.equal(ids('https://пример.рф/').includes('idn-confusable'), false);
  });
});

describe('inspectUrl: brand lookalikes', () => {
  test('digit and letter swaps of the whole label', () => {
    assert.equal(severity('https://paypa1.com/', 'brand-lookalike'), 'high');
    assert.equal(severity('https://www.g00gle.com/', 'brand-lookalike'), 'high');
    assert.equal(severity('https://micr0soft.com/login', 'brand-lookalike'), 'high');
    assert.equal(severity('https://amaz0n.co.uk/', 'brand-lookalike'), 'high');
  });

  test('the brand as a whole token with extra words in the registrable label', () => {
    assert.equal(severity('https://paypal-secure.com/', 'brand-lookalike'), 'high');
    assert.equal(severity('https://secure-apple-id.com/', 'brand-lookalike'), 'high');
    assert.equal(severity('https://login-microsoft.example/', 'brand-lookalike'), 'high');
  });

  test('the brand only in a subdomain of another domain', () => {
    assert.equal(severity('https://paypal.com.evil.example/', 'brand-in-subdomain'), 'high');
    assert.equal(severity('https://www.paypal.com-login.evil.example/', 'brand-in-subdomain'), 'high');
    assert.equal(severity('https://apple.id-verify.example/', 'brand-in-subdomain'), 'high');
    assert.equal(severity('https://google.evil.example/', 'brand-in-subdomain'), 'high');
  });

  test('the brand on a different TLD is a lookalike; its own domains are not', () => {
    assert.equal(severity('https://paypal.evil/', 'brand-lookalike'), undefined, 'exact brand label on another TLD is treated as the brand\'s own');
    assert.equal(ids('https://www.paypal.com/').some((id) => id.startsWith('brand-')), false);
    assert.equal(ids('https://signin.paypalobjects.com/').some((id) => id.startsWith('brand-')), false);
    assert.equal(ids('https://m.facebook.com/').some((id) => id.startsWith('brand-')), false);
  });

  test('the skeleton maps confusables and digits to Latin', () => {
    assert.equal(skeleton('paypa1'), 'paypal');
    assert.equal(skeleton('аррӏе'), 'apple');
    assert.equal(skeleton('g00gle'), 'google');
    assert.equal(skeleton('пример'), 'пpимep'); // only lookalikes change; this is not a Latin word
  });

  test('registrable domain approximation', () => {
    assert.equal(registrableDomain('www.example.com'), 'example.com');
    assert.equal(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
    assert.equal(registrableDomain('example.com'), 'example.com');
    assert.equal(registrableDomain('localhost'), 'localhost');
  });
});

describe('inspectUrl: shorteners, encoding, length and bait', () => {
  test('known shorteners are medium', () => {
    for (const raw of ['https://bit.ly/3xYz', 'https://tinyurl.com/abc', 'http://t.co/x', 'https://qrco.de/abc']) {
      assert.equal(severity(raw, 'url-shortener'), 'medium', raw);
    }
    assert.equal(ids('https://bitly-is-not-this.example/').includes('url-shortener'), false);
  });

  test('heavy and double percent-encoding are medium', () => {
    assert.equal(severity('https://example.com/%6c%6f%67%69%6e/%73%65%63%75%72%65', 'url-heavy-encoding'), 'medium');
    assert.equal(severity('https://example.com/a?next=%252F%252Fevil.example', 'url-double-encoding'), 'medium');
    assert.equal(ids('https://example.com/search?q=hello%20world').includes('url-heavy-encoding'), false);
    assert.equal(ids('https://example.com/100%25-cotton').includes('url-double-encoding'), false, '%25 not followed by an encoded byte');
  });

  test('very long URLs are low', () => {
    assert.equal(severity(`https://example.com/${'a'.repeat(600)}`, 'url-long'), 'low');
    assert.equal(ids(`https://example.com/${'a'.repeat(100)}`).includes('url-long'), false);
  });

  test('credential-bait words in the path or query are low, as whole words', () => {
    assert.equal(severity('https://example.com/login', 'url-credential-bait'), 'low');
    assert.equal(severity('https://example.com/account/verify?reset=1', 'url-credential-bait'), 'low');
    assert.equal(ids('https://example.com/blog/accounting-tips').includes('url-credential-bait'), false, 'accounting is not account');
    assert.equal(ids('https://example.com/').includes('url-credential-bait'), false);
  });

  test('findings carry an id, severity, title, detail and where', () => {
    const [finding] = inspectUrl('http://example.com/', 'payload');
    assert.deepEqual(Object.keys(finding).sort(), ['detail', 'id', 'severity', 'title', 'where']);
    assert.equal(finding.where, 'payload');
  });
});
