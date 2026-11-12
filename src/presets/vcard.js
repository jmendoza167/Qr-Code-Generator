/**
 * Contact card in vCard 3.0 format (RFC 2426), the variant phones import
 * most reliably from a QR code. Pure JS, no Node APIs.
 *
 * Lines end with CRLF. Text values escape backslash, comma, semicolon and
 * line breaks. The N (structured name) field is
 * Family;Given;Additional;Prefix;Suffix, and FN is the display name.
 */

/** Escape a text value for use inside a property. */
export function escapeVCardText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

/**
 * "Javier Mendoza" -> given "Javier", family "Mendoza".
 * "Ana María Pérez" -> given "Ana María", family "Pérez".
 * "Cher" -> given "Cher", family "".
 */
export function splitName(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length <= 1) return { given: words[0] ?? '', family: '' };
  return { given: words.slice(0, -1).join(' '), family: words[words.length - 1] };
}

const nonEmpty = (list) => (list ?? []).map((v) => (v == null ? '' : String(v).trim())).filter((v) => v.length > 0);

/**
 * @param {Object} fields
 * @param {string} fields.name            required display name
 * @param {string[]} [fields.phones]
 * @param {string[]} [fields.emails]
 * @param {string} [fields.org]
 * @param {string} [fields.title]
 * @param {string} [fields.url]
 * @param {string} [fields.address]       free-form, stored in the street component
 * @param {string} [fields.note]
 * @returns {string} the vCard text, CRLF terminated
 */
export function buildVCard({ name, phones, emails, org, title, url, address, note } = {}) {
  const displayName = typeof name === 'string' ? name.trim() : '';
  if (displayName.length === 0) throw new RangeError('A contact name is required');
  const { given, family } = splitName(displayName);

  const lines = ['BEGIN:VCARD', 'VERSION:3.0'];
  lines.push(`N:${escapeVCardText(family)};${escapeVCardText(given)};;;`);
  lines.push(`FN:${escapeVCardText(displayName)}`);
  const text = (prop, value) => {
    if (typeof value === 'string' && value.trim().length > 0) lines.push(`${prop}:${escapeVCardText(value.trim())}`);
  };
  text('ORG', org);
  text('TITLE', title);
  for (const phone of nonEmpty(phones)) lines.push(`TEL:${escapeVCardText(phone)}`);
  for (const email of nonEmpty(emails)) lines.push(`EMAIL:${escapeVCardText(email)}`);
  text('URL', url);
  if (typeof address === 'string' && address.trim().length > 0) {
    lines.push(`ADR:;;${escapeVCardText(address.trim())};;;;`);
  }
  text('NOTE', note);
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}
