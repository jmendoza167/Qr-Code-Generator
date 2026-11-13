/**
 * The inspector: classify a decoded payload, run every applicable check,
 * add notes about how the symbol itself decoded, and turn the findings into
 * a verdict.
 *
 * Verdict rules: the verdict is the highest severity among the findings
 * (informational notes never count). Credential-bait wording in a URL path
 * is special: on its own it is only "low", but combined with any other
 * finding it raises the verdict one step, because that combination is what
 * phishing links look like.
 *
 * This is a heuristic check. It can show that a QR code is suspicious; it
 * can never show that one is safe.
 */
import { getBlockLayout } from '../core/version.js';
import { classifyPayload } from './payload.js';
import { inspectUrl } from './url-checks.js';
import { inspectText } from './text-checks.js';

export const SEVERITIES = Object.freeze(['none', 'low', 'medium', 'high']);
const RANK = { info: 0, low: 1, medium: 2, high: 3 };
const BAIT_ID = 'url-credential-bait';
/** Corrected codewords above this share of the symbol's capacity get a note. */
const DAMAGE_SHARE = 0.1;

export const DISCLAIMER =
  'This is a heuristic check of the decoded content only. It cannot prove that a QR code is safe: a clean result means none of the known warning signs were found, nothing more.';

const META_KEYS = ['version', 'ecc', 'mask', 'errorsCorrected', 'encoding', 'eci', 'inverted'];

const finding = (id, severity, title, detail, where = 'payload') => ({ id, severity, title, detail, where });

/** @param {Array<{id: string, severity: string}>} findings */
export function verdictFor(findings) {
  let max = 0;
  let bait = false;
  let others = false;
  for (const f of findings) {
    if (f.id === BAIT_ID) {
      bait = true;
      continue;
    }
    const rank = RANK[f.severity] ?? 0;
    if (rank > 0) others = true;
    if (rank > max) max = rank;
  }
  if (bait) max = others ? Math.min(3, max + 1) : Math.max(max, 1);
  return SEVERITIES[max];
}

function wifiFindings(wifi) {
  const findings = [];
  if (wifi.security === '' || wifi.security === 'nopass') {
    findings.push(finding('wifi-open', 'medium', 'Open Wi-Fi network', `"${wifi.ssid}" has no password: traffic on it can be read and redirected by anyone nearby.`));
  } else if (wifi.security === 'WEP') {
    findings.push(finding('wifi-wep', 'medium', 'Obsolete WEP encryption', `"${wifi.ssid}" uses WEP, which is broken: treat it like an open network.`));
  }
  if (wifi.hidden) {
    findings.push(finding('wifi-hidden', 'low', 'Hidden network', 'The network does not broadcast its name, which makes it harder to tell it apart from an impostor.'));
  }
  return findings;
}

function metaFindings(meta) {
  const findings = [];
  if (meta.encoding === 'latin-1') {
    findings.push(
      finding('meta-latin1', 'low', 'Text was not valid UTF-8', 'The bytes were read as Latin-1 instead; characters may not be what the author intended.', 'symbol'),
    );
  }
  if (meta.eci !== undefined && meta.eci !== null) {
    findings.push(finding('meta-eci', 'low', 'Explicit character set (ECI)', `The symbol declares ECI ${meta.eci}, which is unusual for everyday QR codes.`, 'symbol'));
  }
  if (Number.isInteger(meta.version) && typeof meta.ecc === 'string' && Number.isInteger(meta.errorsCorrected) && meta.errorsCorrected > 0) {
    let capacity = 0;
    try {
      const layout = getBlockLayout(meta.version, meta.ecc);
      capacity = layout.numBlocks * Math.floor(layout.ecPerBlock / 2);
    } catch {
      capacity = 0;
    }
    if (capacity > 0 && meta.errorsCorrected >= capacity * DAMAGE_SHARE) {
      findings.push(
        finding(
          'meta-damage',
          'info',
          'Error correction had work to do',
          `${meta.errorsCorrected} of ${capacity} correctable codewords were repaired: the code may be damaged, styled heavily, or a sticker may cover part of the original.`,
          'symbol',
        ),
      );
    }
  }
  return findings;
}

/**
 * @typedef {Object} InspectionReport
 * @property {string} type       payload type (url, wifi, vcard, email, phone, sms, geo, text, scheme)
 * @property {'none'|'low'|'medium'|'high'} verdict
 * @property {Array<{id: string, severity: string, title: string, detail: string, where: string}>} findings  highest severity first
 * @property {string} text       the decoded content, RAW: escape it before printing
 * @property {Object} meta       the decoder metadata that was passed in
 * @property {string} disclaimer
 */

/**
 * @param {string} text   the decoded payload, exactly as decoded
 * @param {Object} [meta] decoder metadata: version, ecc, mask, errorsCorrected, encoding, eci, inverted
 * @returns {InspectionReport}
 */
export function inspectPayload(text, meta = {}) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const payload = classifyPayload(text);
  const findings = [...inspectText(text)];

  switch (payload.type) {
    case 'url':
      if (payload.noScheme) {
        findings.push(finding('url-no-scheme', 'low', 'Web address without a scheme', 'The scanning app decides how to open it; most treat it as a link.'));
      }
      findings.push(...inspectUrl(payload.urlText, 'payload'));
      break;
    case 'wifi':
      findings.push(...wifiFindings(payload.wifi));
      break;
    case 'sms':
      if (payload.sms.body !== '') {
        findings.push(finding('sms-body', 'low', 'Pre-filled text message', `Scanning would prepare a message to ${payload.sms.to} with text already written in.`));
      }
      break;
    case 'email':
      if (payload.embeddedUrls.length > 0) {
        findings.push(finding('email-body-link', 'medium', 'Pre-filled email containing a link', 'The email body already contains a link; check where it leads before sending or opening.'));
      }
      break;
    case 'scheme':
      findings.push(finding('scheme-unknown', 'low', `Unusual "${payload.scheme}:" link`, 'This is not a web address; what happens depends on which app claims the scheme.'));
      break;
    default:
      break;
  }

  for (const { url, where } of payload.embeddedUrls) {
    findings.push(...inspectUrl(/^www\./i.test(url) ? `https://${url}` : url, where));
  }
  findings.push(...metaFindings(meta));

  findings.sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0));
  const kept = {};
  for (const key of META_KEYS) if (meta[key] !== undefined) kept[key] = meta[key];
  return { type: payload.type, verdict: verdictFor(findings), findings, text, meta: kept, disclaimer: DISCLAIMER };
}
