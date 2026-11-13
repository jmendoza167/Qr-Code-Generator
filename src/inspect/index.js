/**
 * Browser-safe inspector API: analyse a decoded QR payload for phishing and
 * abuse signals, entirely offline.
 */
export { inspectPayload, verdictFor, DISCLAIMER, SEVERITIES } from './inspect.js';
export { formatReport } from './format.js';
export { classifyPayload } from './payload.js';
export { inspectUrl } from './url-checks.js';
export { inspectText } from './text-checks.js';
export { DANGEROUS_SCHEMES, URL_SHORTENERS, BRANDS, CREDENTIAL_BAIT_WORDS } from './data.js';
