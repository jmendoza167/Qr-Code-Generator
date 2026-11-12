/**
 * Wi-Fi network payload, the de-facto format introduced by ZXing and read by
 * every phone camera:
 *
 *     WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<password>;H:true;;
 *
 * Pure JS, no Node APIs: the website will build the same strings.
 */

const SECURITY_ALIASES = {
  wpa: 'WPA',
  wpa2: 'WPA',
  wpa3: 'WPA',
  'wpa/wpa2': 'WPA',
  wep: 'WEP',
  nopass: 'nopass',
  none: 'nopass',
  open: 'nopass',
};

export const WIFI_SECURITY_TYPES = ['WPA', 'WEP', 'nopass'];

/** "wpa2" -> "WPA", "none" -> "nopass"; undefined -> "WPA". */
export function normalizeWifiSecurity(input) {
  if (input === undefined || input === null || input === '') return 'WPA';
  const type = SECURITY_ALIASES[String(input).trim().toLowerCase()];
  if (!type) throw new RangeError(`Unknown Wi-Fi security type ${JSON.stringify(input)}: use WPA, WEP or nopass`);
  return type;
}

// CR, LF and every other control character (C0, DEL, C1) plus the Unicode
// line and paragraph separators. None can be typed into a phone's Wi-Fi
// settings, and a line break inside a field can make a reader see extra
// fields that the person generating the code never intended.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/** Refuse a field that contains control characters. The value itself is never echoed. */
function assertNoControlCharacters(field, value) {
  const match = CONTROL_CHARACTER.exec(value);
  if (!match) return;
  const code = match[0].charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
  throw new RangeError(
    `The Wi-Fi ${field} contains a control character (U+${code} at position ${match.index + 1}): line breaks and other control characters are not allowed`,
  );
}

/** Backslash-escape the characters that have meaning in the format. */
export function escapeWifiValue(value) {
  return String(value).replace(/([\\;,:"])/g, '\\$1');
}

/**
 * @param {Object} options
 * @param {string} options.ssid
 * @param {string} [options.password]   required unless security is nopass
 * @param {string} [options.security]   WPA (default), WEP or nopass
 * @param {boolean} [options.hidden]    network does not broadcast its SSID
 * @returns {string}
 */
export function buildWifiPayload({ ssid, password, security, hidden = false } = {}) {
  if (typeof ssid !== 'string' || ssid.length === 0) throw new RangeError('Wi-Fi ssid is required');
  assertNoControlCharacters('ssid', ssid);
  const type = normalizeWifiSecurity(security);
  if (typeof password === 'string') assertNoControlCharacters('password', password);
  const hasPassword = typeof password === 'string' && password.length > 0;
  if (type === 'nopass' && hasPassword) {
    throw new RangeError('An open network (security nopass) cannot have a password');
  }
  if (type !== 'nopass' && !hasPassword) {
    throw new RangeError(`A ${type} network needs a password (or use --security nopass)`);
  }

  let payload = `WIFI:T:${type};S:${escapeWifiValue(ssid)};`;
  if (hasPassword) payload += `P:${escapeWifiValue(password)};`;
  if (hidden) payload += 'H:true;';
  return `${payload};`;
}
