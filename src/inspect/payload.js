/**
 * What kind of thing is in the QR code? Phones treat a payload differently
 * depending on how it starts: a URL is opened, WIFI: joins a network,
 * BEGIN:VCARD adds a contact, mailto:/sms:/tel: start a message or call.
 * This module classifies the decoded text and pulls out the parts the
 * checks need, including any URLs hidden inside message bodies or contact
 * cards. Pure string work, bounded by the payload length and small caps.
 */
import { DANGEROUS_SCHEMES } from './data.js';

const MAX_EMBEDDED_URLS = 20;
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;
/** A bare domain with optional path: example.com, www.example.com/page, example.com:8080/x?y */
const BARE_DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i;
/**
 * URLs inside free text: http(s):// or www. up to whitespace or a quote/bracket.
 * Linear: a fixed prefix followed by one greedy character class.
 */
const EMBEDDED_URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'()[\]]+/gi;

/** Sentence punctuation that ends up glued to a URL in prose ("see https://x.example."). */
const TRAILING_PUNCTUATION = '.,;:!?';

/**
 * Strip trailing sentence punctuation. A backwards loop instead of
 * /[.,;:!?]+$/: that regex is retried from every position of a punctuation
 * run that is not at the end, so "!" x n followed by a letter costs O(n^2).
 * The text comes from a decoded QR code and is attacker-controlled.
 */
export function trimTrailingPunctuation(text) {
  let end = text.length;
  while (end > 0 && TRAILING_PUNCTUATION.includes(text[end - 1])) end--;
  return end === text.length ? text : text.slice(0, end);
}

/** URLs mentioned in a piece of free text, trailing punctuation removed, at most `limit`. */
export function extractUrls(text, where, limit = MAX_EMBEDDED_URLS) {
  const found = [];
  if (limit <= 0) return found;
  for (const match of text.matchAll(EMBEDDED_URL_RE)) {
    found.push({ url: trimTrailingPunctuation(match[0]), where });
    if (found.length >= limit) break;
  }
  return found;
}

/** WIFI:T:WPA;S:ssid;P:password;H:true;; with backslash escapes inside values. */
function parseWifi(text) {
  const fields = {};
  let i = 'WIFI:'.length;
  while (i < text.length) {
    const colon = text.indexOf(':', i);
    if (colon < 0) break;
    const key = text.slice(i, colon).toUpperCase();
    let value = '';
    let j = colon + 1;
    while (j < text.length && text[j] !== ';') {
      if (text[j] === '\\' && j + 1 < text.length) j++;
      value += text[j];
      j++;
    }
    fields[key] = value;
    i = j + 1;
    if (text[i] === ';') break; // the terminating ";;"
  }
  return {
    security: (fields.T ?? '').toUpperCase() === 'NOPASS' ? 'nopass' : (fields.T ?? '').toUpperCase(),
    ssid: fields.S ?? '',
    password: fields.P ?? '',
    hidden: (fields.H ?? '').toLowerCase() === 'true',
  };
}

/** Lines of a vCard, continuation lines folded back, as { name, value }. */
function parseVCard(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const lines = [];
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    lines.push({ name, value: line.slice(colon + 1) });
  }
  return lines;
}

function decodeQuery(query) {
  const params = {};
  for (const [key, value] of new URLSearchParams(query)) params[key.toLowerCase()] = value;
  return params;
}

/** mailto:addr?subject=..&body=.. */
function parseEmail(text, scheme) {
  const rest = text.slice(scheme.length + 1);
  const q = rest.indexOf('?');
  const params = q >= 0 ? decodeQuery(rest.slice(q + 1)) : {};
  return { to: q >= 0 ? rest.slice(0, q) : rest, subject: params.subject ?? '', body: params.body ?? '' };
}

/** sms:+1555?body=.. or smsto:+1555:body */
function parseSms(text, scheme) {
  const rest = text.slice(scheme.length + 1);
  const q = rest.indexOf('?');
  if (q >= 0) {
    const params = decodeQuery(rest.slice(q + 1));
    return { to: rest.slice(0, q), body: params.body ?? '' };
  }
  const colon = rest.indexOf(':');
  if (colon >= 0) return { to: rest.slice(0, colon), body: rest.slice(colon + 1) };
  return { to: rest, body: '' };
}

/**
 * @typedef {Object} Payload
 * @property {'url'|'wifi'|'vcard'|'email'|'phone'|'sms'|'geo'|'text'|'scheme'} type
 * @property {string|null} scheme     lower-case scheme, if the text starts with one
 * @property {string|null} urlText    for type 'url': the URL to analyse (a bare domain gets https:// in front)
 * @property {boolean} noScheme       for type 'url': true when the payload had no scheme
 * @property {{url: string, where: string}[]} embeddedUrls  URLs found inside bodies or vCard fields
 * @property {Object|null} wifi, sms, email
 * @property {{name: string, value: string}[]|null} vcard
 */

/** @returns {Payload} */
export function classifyPayload(text) {
  const trimmed = text.trim();
  const base = { type: 'text', scheme: null, urlText: null, noScheme: false, embeddedUrls: [], wifi: null, sms: null, email: null, vcard: null };

  if (/^WIFI:/i.test(trimmed)) return { ...base, type: 'wifi', scheme: 'wifi', wifi: parseWifi(trimmed) };
  if (/^BEGIN:VCARD/i.test(trimmed)) {
    const vcard = parseVCard(trimmed);
    const embeddedUrls = [];
    // Stop scanning once the cap is reached: a card with thousands of lines
    // full of links should not be fully extracted only to be cut down.
    for (const { name, value } of vcard) {
      if (embeddedUrls.length >= MAX_EMBEDDED_URLS) break;
      if (name === 'URL' && !/^(?:https?:\/\/|www\.)/i.test(value) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) {
        embeddedUrls.push({ url: value, where: 'vCard URL' });
      }
      embeddedUrls.push(...extractUrls(value, `vCard ${name}`, MAX_EMBEDDED_URLS - embeddedUrls.length));
    }
    return { ...base, type: 'vcard', scheme: null, vcard, embeddedUrls: embeddedUrls.slice(0, MAX_EMBEDDED_URLS) };
  }

  const schemeMatch = trimmed.match(SCHEME_RE);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme === 'http' || scheme === 'https' || DANGEROUS_SCHEMES.includes(scheme)) return { ...base, type: 'url', scheme, urlText: trimmed };
    if (scheme === 'mailto') {
      const email = parseEmail(trimmed, scheme);
      return { ...base, type: 'email', scheme, email, embeddedUrls: extractUrls(`${email.subject} ${email.body}`, 'email body') };
    }
    if (scheme === 'tel') return { ...base, type: 'phone', scheme };
    if (scheme === 'sms' || scheme === 'smsto' || scheme === 'mms') {
      const sms = parseSms(trimmed, scheme);
      return { ...base, type: 'sms', scheme, sms, embeddedUrls: extractUrls(sms.body, 'SMS body') };
    }
    if (scheme === 'geo') return { ...base, type: 'geo', scheme };
    return { ...base, type: 'scheme', scheme };
  }

  if (BARE_DOMAIN_RE.test(trimmed)) return { ...base, type: 'url', noScheme: true, urlText: `https://${trimmed}` };
  return base;
}
