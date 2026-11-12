import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildVCard, escapeVCardText, escapeVCardUri, splitName } from '../src/presets/vcard.js';

describe('escapeVCardText', () => {
  test('escapes backslash, comma, semicolon and newlines', () => {
    assert.equal(escapeVCardText('a\\b,c;d\ne\r\nf'), 'a\\\\b\\,c\\;d\\ne\\nf');
  });
});

describe('splitName', () => {
  test('last word is the family name, the rest the given name', () => {
    assert.deepEqual(splitName('Javier Mendoza'), { given: 'Javier', family: 'Mendoza' });
    assert.deepEqual(splitName('Ana María Pérez'), { given: 'Ana María', family: 'Pérez' });
  });

  test('a single word is a given name only', () => {
    assert.deepEqual(splitName('Cher'), { given: 'Cher', family: '' });
  });

  test('extra whitespace is ignored', () => {
    assert.deepEqual(splitName('  Javier   Mendoza  '), { given: 'Javier', family: 'Mendoza' });
  });
});

describe('buildVCard', () => {
  test('minimal card: name only, CRLF line endings, version 3.0', () => {
    assert.equal(
      buildVCard({ name: 'Javier Mendoza' }),
      'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Mendoza;Javier;;;\r\nFN:Javier Mendoza\r\nEND:VCARD\r\n',
    );
  });

  test('all fields, with repeated phones and emails in the order given', () => {
    const card = buildVCard({
      name: 'Javier Mendoza',
      phones: ['+34 600 000 000', '+34 911 111 111'],
      emails: ['javier@example.com', 'jm@work.example'],
      org: 'Example Corp',
      title: 'Engineer',
      url: 'https://example.com',
      address: 'Calle Mayor 1, Madrid',
      note: 'Met at the conference',
    });
    const lines = card.split('\r\n');
    assert.deepEqual(lines, [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Mendoza;Javier;;;',
      'FN:Javier Mendoza',
      'ORG:Example Corp',
      'TITLE:Engineer',
      'TEL:+34 600 000 000',
      'TEL:+34 911 111 111',
      'EMAIL:javier@example.com',
      'EMAIL:jm@work.example',
      'URL:https://example.com',
      'ADR:;;Calle Mayor 1\\, Madrid;;;;',
      'NOTE:Met at the conference',
      'END:VCARD',
      '',
    ]);
  });

  test('escapes special characters and keeps accents as-is (UTF-8)', () => {
    const card = buildVCard({ name: 'José Núñez', org: 'A;B, C\\D', note: 'line1\nline2' });
    assert.match(card, /\r\nN:Núñez;José;;;\r\n/);
    assert.match(card, /\r\nFN:José Núñez\r\n/);
    assert.match(card, /\r\nORG:A\\;B\\, C\\\\D\r\n/);
    assert.match(card, /\r\nNOTE:line1\\nline2\r\n/);
  });

  test('single-word name', () => {
    assert.match(buildVCard({ name: 'Cher' }), /\r\nN:;Cher;;;\r\nFN:Cher\r\n/);
  });

  test('empty optional fields are omitted; name is required', () => {
    const card = buildVCard({ name: 'X Y', org: '', phones: [], emails: [''] });
    assert.doesNotMatch(card, /ORG|TEL|EMAIL/);
    assert.throws(() => buildVCard({}), /name/i);
    assert.throws(() => buildVCard({ name: '   ' }), /name/i);
  });
});

describe('vCard URL is escaped as a URI, not as text', () => {
  const urlLine = (url) => buildVCard({ name: 'X Y', url }).split('\r\n').find((line) => line.startsWith('URL:'));

  test('commas, semicolons and other URL syntax are left exactly as they are', () => {
    for (const url of [
      'https://example.com/a,b;c',
      'https://example.com/search?q=a,b;c&lang=en;q=0.8#frag,ment',
      'https://example.com/maps/@40.4168,-3.7038,15z',
      'https://user:pw@example.com:8080/p/a/t/h;param?x=1&y=2+3#top',
      'https://example.com/~user/(x)!$*\'',
      'http://[2001:db8::1]:8080/a,b',
      'mailto:someone@example.com?subject=a,b;c',
    ]) {
      assert.equal(urlLine(url), `URL:${url}`);
      assert.equal(escapeVCardUri(url), url);
    }
  });

  test('no backslash is ever added (the bug: "," and ";" used to become "\\," and "\\;")', () => {
    const line = urlLine('https://example.com/a,b;c');
    assert.doesNotMatch(line, /\\/);
    assert.equal(new URL(line.slice(4)).href, 'https://example.com/a,b;c');
  });

  test('existing percent escapes are kept, not double-encoded', () => {
    assert.equal(escapeVCardUri('https://example.com/a%20b%2Cc%3b?d=%E2%9C%93'), 'https://example.com/a%20b%2Cc%3b?d=%E2%9C%93');
    assert.equal(escapeVCardUri('https://example.com/100%'), 'https://example.com/100%25');
    assert.equal(escapeVCardUri('https://example.com/%zz'), 'https://example.com/%25zz');
  });

  test('characters a URI cannot contain are percent-encoded', () => {
    assert.equal(escapeVCardUri('https://example.com/a b'), 'https://example.com/a%20b');
    assert.equal(escapeVCardUri('https://example.com/a\\b'), 'https://example.com/a%5Cb');
    assert.equal(escapeVCardUri('https://example.com/"<x>"'), 'https://example.com/%22%3Cx%3E%22');
    assert.equal(escapeVCardUri('https://example.com/café/日本'), 'https://example.com/caf%C3%A9/%E6%97%A5%E6%9C%AC');
    assert.equal(escapeVCardUri('  https://example.com/  '), 'https://example.com/');
  });

  test('a line break in the URL cannot inject another vCard property', () => {
    for (const breakChars of ['\r\n', '\n', '\r']) {
      const card = buildVCard({ name: 'X Y', url: `https://example.com/${breakChars}TEL:+1900EVIL${breakChars}URL:https://evil.example/` });
      const lines = card.split('\r\n');
      assert.deepEqual(lines.slice(0, 4), ['BEGIN:VCARD', 'VERSION:3.0', 'N:Y;X;;;', 'FN:X Y']);
      assert.equal(lines.length, 7, card); // 4 + URL + END + trailing empty
      assert.equal(lines[5], 'END:VCARD');
      assert.equal(lines.filter((line) => /^(TEL|URL):/.test(line)).length, 1);
      assert.match(lines[4], /^URL:https:\/\/example\.com\/(%0D|%0A)+TEL:\+1900EVIL(%0D|%0A)+URL:https:\/\/evil\.example\/$/);
      assert.doesNotMatch(card.replace(/\r\n/g, ''), /[\r\n]/);
    }
  });

  test('other control characters are encoded too, and invalid text is refused', () => {
    assert.equal(escapeVCardUri('https://example.com/\t\x00\x1b\x7f'), 'https://example.com/%09%00%1B%7F');
    assert.throws(() => buildVCard({ name: 'X Y', url: 'https://example.com/\ud800' }), RangeError);
  });

  test('an empty URL is omitted', () => {
    assert.doesNotMatch(buildVCard({ name: 'X Y', url: '   ' }), /URL/);
    assert.doesNotMatch(buildVCard({ name: 'X Y' }), /URL/);
  });
});
