/**
 * Offline checks on one URL. Nothing here resolves, fetches or looks up
 * anything: every check reads the URL string and the small lists in
 * data.js, and returns findings.
 *
 * A finding is { id, severity, title, detail, where }. `where` says which
 * part of the payload the URL came from ("payload", "email body", ...).
 */
import { DANGEROUS_SCHEMES, URL_SHORTENERS, BRANDS, CREDENTIAL_BAIT_WORDS, CONFUSABLES, SECOND_LEVEL_LABELS } from './data.js';

const MAX_URL_LENGTH = 512;
const MAX_LABEL_LENGTH = 63;

const finding = (id, severity, title, detail, where) => ({ id, severity, title, detail, where });

// ---------------------------------------------------------------------------
// Punycode (RFC 3492) decoding, so internationalised labels can be analysed
// as the characters a person would see. Loops are bounded by the input.

const BASE = 36;
const T_MIN = 1;
const T_MAX = 26;
const SKEW = 38;
const DAMP = 700;

function adapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - T_MIN) * T_MAX) >> 1) {
    delta = Math.floor(delta / (BASE - T_MIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - T_MIN + 1) * delta) / (delta + SKEW));
}

function decodeDigit(code) {
  if (code - 48 < 10) return code - 22;
  if (code - 65 < 26) return code - 65;
  if (code - 97 < 26) return code - 97;
  return BASE;
}

/** Decode the part of a label after "xn--". Throws RangeError on malformed input. */
export function punycodeDecode(input) {
  if (input.length > MAX_LABEL_LENGTH) throw new RangeError('label too long');
  const output = [];
  let basic = input.lastIndexOf('-');
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) {
    const code = input.charCodeAt(j);
    if (code >= 0x80) throw new RangeError('not basic');
    output.push(code);
  }
  let n = 128;
  let i = 0;
  let bias = 72;
  for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
    const oldi = i;
    let w = 1;
    for (let k = BASE; ; k += BASE) {
      if (index >= input.length) throw new RangeError('truncated');
      const digit = decodeDigit(input.charCodeAt(index++));
      if (digit >= BASE) throw new RangeError('bad digit');
      i += digit * w;
      if (i > 0x10ffff * 64) throw new RangeError('overflow');
      const t = k <= bias ? T_MIN : k >= bias + T_MAX ? T_MAX : k - bias;
      if (digit < t) break;
      w *= BASE - t;
    }
    const count = output.length + 1;
    bias = adapt(i - oldi, count, oldi === 0);
    n += Math.floor(i / count);
    i %= count;
    if (n > 0x10ffff) throw new RangeError('overflow');
    output.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...output);
}

/** A hostname label as a person sees it: punycode decoded, otherwise unchanged. */
function displayLabel(label) {
  if (!label.startsWith('xn--')) return label;
  try {
    return punycodeDecode(label.slice(4));
  } catch {
    return label;
  }
}

// ---------------------------------------------------------------------------
// Host helpers

/** Approximate "registrable domain" (eTLD+1): example.com, example.co.uk. */
export function registrableDomain(host) {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  if (tld.length === 2 && SECOND_LEVEL_LABELS.includes(sld)) return labels.slice(-3).join('.');
  return labels.slice(-2).join('.');
}

/** Is the registrable domain under a two-letter country-code TLD (amazon.cl, example.co.uk)? */
export function isCountryCodeDomain(registrable) {
  const tld = registrable.split('.').pop();
  return /^[a-z]{2}$/i.test(tld);
}

/** Replace every lookalike character (Cyrillic а, digit 1...) with the Latin letter it imitates. */
export function skeleton(label) {
  let out = '';
  for (const ch of label.toLowerCase()) out += CONFUSABLES[ch] ?? ch;
  return out;
}

const SCRIPT_TESTS = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['CJK', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Bopomofo}]/u],
  ['Thai', /\p{Script=Thai}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Georgian', /\p{Script=Georgian}/u],
];

/** The writing systems used by the letters of a label. */
function scriptsOf(label) {
  const scripts = new Set();
  for (const ch of label) {
    if (!/\p{L}/u.test(ch)) continue;
    const hit = SCRIPT_TESTS.find(([, re]) => re.test(ch));
    scripts.add(hit ? hit[0] : 'Other');
  }
  return scripts;
}

const IPV4_DOTTED = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Everything between "//" and the first "/", "?" or "#", as written. */
function rawAuthority(raw) {
  const match = raw.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i);
  return match ? match[1] : '';
}

/** The host as written in the URL text (user info and port removed). */
function rawHost(raw) {
  let authority = rawAuthority(raw);
  const at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1);
  if (authority.startsWith('[')) return authority.slice(0, authority.indexOf(']') + 1);
  const colon = authority.indexOf(':');
  return colon >= 0 ? authority.slice(0, colon) : authority;
}

// ---------------------------------------------------------------------------
// The checks

function checkHost(url, raw, where, findings) {
  const hostname = url.hostname.toLowerCase();
  const written = rawHost(raw).toLowerCase();

  if (hostname.startsWith('[') || IPV4_DOTTED.test(hostname)) {
    const asWritten = written && written !== hostname ? `, written as ${written}` : '';
    findings.push(
      finding(
        'url-ip-host',
        'medium',
        'IP address instead of a domain name',
        `The host is the raw address ${hostname}${asWritten}. Legitimate services almost always use a name.`,
        where,
      ),
    );
    return; // no labels to analyse
  }

  const labels = hostname.split('.').map(displayLabel);
  const display = labels.join('.');
  const registrable = registrableDomain(display);
  const registrableLabels = registrable.split('.');
  const subLabels = labels.slice(0, labels.length - registrableLabels.length);

  // Internationalised labels: mixed scripts, confusables, or just non-Latin.
  let confusableLabel = null;
  let mixedLabel = null;
  let nonLatin = false;
  for (const label of labels) {
    const scripts = scriptsOf(label);
    if (scripts.size > 1 && !mixedLabel) mixedLabel = label;
    const hasNonAscii = /[^\x00-\x7f]/.test(label);
    if (hasNonAscii) nonLatin = true;
    if (hasNonAscii && /^[a-z0-9-]+$/.test(skeleton(label)) && !confusableLabel) confusableLabel = label;
  }
  if (mixedLabel) {
    findings.push(
      finding(
        'idn-mixed-script',
        'high',
        'Mixed writing systems in one domain label',
        `The label "${mixedLabel}" mixes letters from different alphabets, a classic way to imitate another domain.`,
        where,
      ),
    );
  }
  if (confusableLabel) {
    findings.push(
      finding(
        'idn-confusable',
        'high',
        'Lookalike characters in the domain',
        `"${confusableLabel}" uses characters that look like Latin letters; it reads as "${skeleton(confusableLabel)}" but is a different domain.`,
        where,
      ),
    );
  } else if (nonLatin) {
    findings.push(
      finding(
        'idn-non-latin',
        'low',
        'Internationalised domain name',
        `The domain "${display}" uses non-Latin characters. Check that it is the site you expect.`,
        where,
      ),
    );
  }
  if (/xn--/i.test(raw) && !confusableLabel) {
    findings.push(
      finding('idn-punycode', 'low', 'Punycode domain', `The domain is written in punycode; it displays as "${display}".`, where),
    );
  }

  checkBrands(labels, registrable, subLabels, where, findings);

  if (URL_SHORTENERS.includes(registrable) || URL_SHORTENERS.includes(display)) {
    findings.push(
      finding(
        'url-shortener',
        'medium',
        'Link shortener hides the destination',
        `${registrable} is a link shortener: the real destination is unknown until the link is followed.`,
        where,
      ),
    );
  }

  if (url.port !== '') {
    findings.push(finding('url-port', 'low', 'Non-standard port', `The URL uses port ${url.port} instead of the default.`, where));
  }
  if (subLabels.length >= 3) {
    findings.push(
      finding(
        'url-many-subdomains',
        'low',
        'Unusually many subdomains',
        `${subLabels.length} subdomain levels before ${registrable}; long hostnames can push the real domain out of view.`,
        where,
      ),
    );
  }
}

function checkBrands(labels, registrable, subLabels, where, findings) {
  const registrableLabel = registrable.split('.')[0];
  const seen = new Set();
  const report = (id, title, detail, severity = 'high') => {
    if (seen.has(id)) return;
    seen.add(id);
    findings.push(finding(id, severity, title, `${detail}.`, where));
  };
  const hasToken = (label, name) => label.split('-').includes(name) || skeleton(label).split('-').includes(name);

  for (const brand of BRANDS) {
    if (brand.domains.includes(registrable)) continue; // one of the brand's own domains

    if (registrableLabel === brand.name) {
      // The exact brand name under a domain not on the brand's list. On a
      // generic TLD (paypal.top, apple.xyz) that is the classic cheap-TLD
      // phishing trick. On a country-code TLD (amazon.cl) it may well be the
      // brand's real site for that country, so it is only a warning to check.
      const own = brand.domains.filter((d) => d.startsWith(`${brand.name}.`)).slice(0, 4).join(', ');
      if (isCountryCodeDomain(registrable)) {
        report(
          'brand-unknown-tld',
          'Brand name on a country domain not in the known list',
          `"${registrable}" is not among the ${brand.name} sites known here (${own}, ...); check it is the brand's official site for that country`,
          'medium',
        );
      } else {
        report('brand-unknown-tld', "Brand name on a domain the brand doesn't use", `"${registrable}" is not one of ${brand.name}'s domains (${own}, ...)`);
      }
      continue;
    }

    if (skeleton(registrableLabel) === brand.name) {
      report('brand-lookalike', 'Domain imitates a well-known brand', `"${registrableLabel}" reads like "${brand.name}" with swapped characters`);
    } else if (hasToken(registrableLabel, brand.name)) {
      report('brand-lookalike', 'Domain imitates a well-known brand', `"${registrable}" contains "${brand.name}" but is not the brand's own domain`);
    }
    for (const label of subLabels) {
      if (hasToken(label, brand.name)) {
        report(
          'brand-in-subdomain',
          'Brand name only in a subdomain',
          `"${label}" (${brand.name}) appears in front of ${registrable}; the site belongs to ${registrable}, not to the brand`,
        );
        break;
      }
    }
  }
}

function checkEncodingAndLength(raw, url, where, findings) {
  const encoded = raw.match(/%[0-9a-f]{2}/gi) ?? [];
  if (encoded.length >= 6 || (encoded.length >= 3 && encoded.length * 3 >= raw.length * 0.3)) {
    findings.push(
      finding(
        'url-heavy-encoding',
        'medium',
        'Heavily percent-encoded URL',
        `${encoded.length} percent-encoded characters: the real path or parameters are hidden from a quick look.`,
        where,
      ),
    );
  }
  if (/%25[0-9a-f]{2}/i.test(raw)) {
    findings.push(
      finding('url-double-encoding', 'medium', 'Double percent-encoding', 'Parts of the URL are encoded twice, a common way to slip past filters.', where),
    );
  }
  if (raw.length > MAX_URL_LENGTH) {
    findings.push(finding('url-long', 'low', 'Very long URL', `${raw.length} characters; long URLs are hard to read and easy to hide things in.`, where));
  }

  const pathAndQuery = `${url.pathname}${url.search}`.toLowerCase();
  const tokens = new Set(pathAndQuery.split(/[^a-z0-9]+/).filter(Boolean));
  const bait = CREDENTIAL_BAIT_WORDS.filter((word) => (word.includes('-') ? pathAndQuery.includes(word) : tokens.has(word)));
  if (bait.length > 0) {
    findings.push(
      finding(
        'url-credential-bait',
        'low',
        'Login or verification wording in the path',
        `The path mentions ${bait.map((w) => `"${w}"`).join(', ')}. Normal on real sites, but it is what phishing pages look like too.`,
        where,
      ),
    );
  }
}

/**
 * @param {string} raw    the URL exactly as found in the payload
 * @param {string} where  which part of the payload it came from
 * @returns {Array<{id: string, severity: string, title: string, detail: string, where: string}>}
 */
export function inspectUrl(raw, where = 'payload') {
  const findings = [];
  const schemeMatch = raw.match(/^([a-z][a-z0-9+.-]*):/i);
  const scheme = schemeMatch ? schemeMatch[1].toLowerCase() : null;

  if (scheme && DANGEROUS_SCHEMES.includes(scheme)) {
    findings.push(
      finding(
        'url-dangerous-scheme',
        'high',
        `Dangerous "${scheme}:" link`,
        `A "${scheme}:" URL can run code or open local resources when scanned. A QR code never needs it.`,
        where,
      ),
    );
    return findings;
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    findings.push(finding('url-unparseable', 'low', 'Malformed URL', 'The text looks like a URL but does not parse as one.', where));
    return findings;
  }

  if (url.username !== '' || url.password !== '') {
    const fake = decodeURIComponent(url.username);
    findings.push(
      finding(
        'url-credentials',
        'high',
        'Fake host before @',
        `"${fake}" is a username, not the site: the link really goes to ${url.hostname}.`,
        where,
      ),
    );
  }
  if (url.protocol === 'http:') {
    findings.push(finding('url-http', 'low', 'Unencrypted http:// link', 'The connection is not encrypted; anyone on the network can read or alter it.', where));
  }
  if (url.hostname !== '') checkHost(url, raw, where, findings);
  checkEncodingAndLength(raw, url, where, findings);
  return findings;
}
