import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildVCard, escapeVCardText, splitName } from '../src/presets/vcard.js';

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
