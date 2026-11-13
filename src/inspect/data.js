/**
 * The built-in lists used by the inspector. All of them are deliberately
 * SMALL and NON-EXHAUSTIVE: they catch the most common tricks, they do not
 * try to know every brand, shortener or scheme on the internet. A URL that
 * matches nothing here has not been shown to be safe.
 *
 * Everything is matched offline against the decoded text. Nothing here is
 * ever used to make a network request.
 */

/**
 * URL schemes that execute code or load local resources when opened. A QR
 * code should never need them.
 */
export const DANGEROUS_SCHEMES = Object.freeze([
  'javascript',
  'data',
  'file',
  'vbscript',
  'blob',
  'intent', // Android: launches an app with arbitrary extras
  'about',
  'chrome',
  'ms-appinstaller', // Windows: installs a package
  'ms-msdt', // Windows: diagnostic tool (Follina)
  'search-ms',
  'ms-officecmd',
  'jar',
  'wss', // WebSocket endpoints make no sense as a QR destination
  'ws',
]);

/**
 * Link shorteners and redirectors: the real destination is hidden until the
 * link is followed, which is exactly what a phishing QR code wants.
 */
export const URL_SHORTENERS = Object.freeze([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'cutt.ly',
  'rb.gy',
  'rebrand.ly',
  'shorturl.at',
  't.ly',
  'tiny.cc',
  'lnkd.in',
  'bl.ink',
  'qr.codes',
  'qrco.de',
  'qr.io',
  'qrs.ly',
  's.id',
  'v.gd',
  'x.co',
  'short.io',
  'adf.ly',
  'soo.gd',
]);

/**
 * Commonly impersonated brands. `domains` are registrable domains the brand
 * itself uses (so support.apple.com or accounts.google.com are fine). A
 * registrable domain whose first label is exactly the brand name (amazon.de,
 * apple.co.uk) is also treated as the brand's own.
 */
export const BRANDS = Object.freeze([
  { name: 'paypal', domains: ['paypal.com', 'paypal.me', 'paypalobjects.com', 'paypal-community.com'] },
  { name: 'apple', domains: ['apple.com', 'icloud.com', 'itunes.com', 'apple.news', 'applemusic.com'] },
  { name: 'icloud', domains: ['icloud.com', 'apple.com'] },
  {
    name: 'google',
    domains: ['google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'withgoogle.com', 'goo.gl', 'youtube.com', 'gmail.com', 'google.dev', 'googlesource.com', 'googleblog.com', 'googleadservices.com', 'googletagmanager.com', 'google-analytics.com', 'googlevideo.com', 'googlesyndication.com', 'android.com'],
  },
  { name: 'gmail', domains: ['gmail.com', 'google.com'] },
  {
    name: 'microsoft',
    domains: ['microsoft.com', 'microsoftonline.com', 'live.com', 'office.com', 'office365.com', 'outlook.com', 'azure.com', 'windows.com', 'msn.com', 'microsoftstore.com', 'xbox.com', 'skype.com', 'visualstudio.com', 'azurewebsites.net', 'sharepoint.com', 'onedrive.com', 'bing.com', 'microsoft.net'],
  },
  { name: 'outlook', domains: ['outlook.com', 'live.com', 'office.com', 'microsoft.com'] },
  { name: 'office365', domains: ['office365.com', 'office.com', 'microsoft.com'] },
  {
    name: 'amazon',
    domains: ['amazon.com', 'amazonaws.com', 'amazon.dev', 'primevideo.com', 'audible.com', 'amazonpay.com', 'media-amazon.com', 'ssl-images-amazon.com', 'amazontrust.com', 'awsstatic.com', 'cloudfront.net', 'a2z.com', 'amazon.jobs'],
  },
  { name: 'netflix', domains: ['netflix.com', 'nflxext.com', 'nflximg.net', 'nflxvideo.net'] },
  { name: 'facebook', domains: ['facebook.com', 'fb.com', 'fb.me', 'fbcdn.net', 'meta.com', 'messenger.com'] },
  { name: 'instagram', domains: ['instagram.com', 'cdninstagram.com', 'facebook.com'] },
  { name: 'whatsapp', domains: ['whatsapp.com', 'whatsapp.net', 'wa.me'] },
  { name: 'linkedin', domains: ['linkedin.com', 'lnkd.in', 'licdn.com'] },
  { name: 'dropbox', domains: ['dropbox.com', 'dropboxusercontent.com', 'dropboxstatic.com'] },
  { name: 'github', domains: ['github.com', 'github.io', 'githubusercontent.com', 'github.dev', 'githubassets.com'] },
  { name: 'docusign', domains: ['docusign.com', 'docusign.net'] },
  { name: 'binance', domains: ['binance.com', 'binance.us'] },
  { name: 'coinbase', domains: ['coinbase.com'] },
  { name: 'metamask', domains: ['metamask.io'] },
  { name: 'chase', domains: ['chase.com', 'jpmorgan.com', 'jpmorganchase.com'] },
  { name: 'wellsfargo', domains: ['wellsfargo.com', 'wf.com'] },
  { name: 'bankofamerica', domains: ['bankofamerica.com', 'bofa.com'] },
  { name: 'citibank', domains: ['citibank.com', 'citi.com'] },
  { name: 'hsbc', domains: ['hsbc.com', 'hsbc.co.uk'] },
  { name: 'barclays', domains: ['barclays.com', 'barclays.co.uk'] },
  { name: 'santander', domains: ['santander.com', 'santander.co.uk', 'santander.es', 'santanderbank.com'] },
  { name: 'bbva', domains: ['bbva.com', 'bbva.es', 'bbva.mx'] },
  { name: 'caixabank', domains: ['caixabank.com', 'caixabank.es'] },
  { name: 'revolut', domains: ['revolut.com'] },
  { name: 'usps', domains: ['usps.com', 'usps.gov'] },
  { name: 'fedex', domains: ['fedex.com'] },
  { name: 'dhl', domains: ['dhl.com', 'dhl.de'] },
  { name: 'ups', domains: ['ups.com'] },
]);

/**
 * Words that phishing pages put in their paths to look like a login or
 * verification step. Legitimate sites use them too, so on their own they
 * only produce a low finding; combined with any other finding they raise
 * the verdict one step.
 */
export const CREDENTIAL_BAIT_WORDS = Object.freeze([
  'login',
  'logon',
  'signin',
  'sign-in',
  'verify',
  'verification',
  'confirm',
  'account',
  'secure',
  'security',
  'update',
  'wallet',
  'password',
  'passwd',
  'credential',
  'authenticate',
  'auth',
  'unlock',
  'suspended',
  'billing',
  'invoice',
  'payment',
  'recover',
  'reset',
  'otp',
  '2fa',
  'bank',
  'seed',
  'mnemonic',
  'airdrop',
  'claim',
  'prize',
  'reward',
]);

/**
 * Characters that look like Latin letters or digits in most fonts, mapped to
 * what they imitate. Used to spot a label that would read as a brand once
 * the lookalikes are replaced (аррӏе.com for apple.com, paypa1 for paypal).
 * Mostly Cyrillic and Greek; a few Latin letters with a lookalike shape.
 */
export const CONFUSABLES = Object.freeze({
  // Cyrillic
  'а': 'a', // а
  'е': 'e', // е
  'о': 'o', // о
  'р': 'p', // р
  'с': 'c', // с
  'у': 'y', // у
  'х': 'x', // х
  'і': 'i', // і
  'ј': 'j', // ј
  'ѕ': 's', // ѕ
  'һ': 'h', // һ
  'ӏ': 'l', // ӏ
  'ԁ': 'd', // ԁ
  'ԛ': 'q', // ԛ
  'ԝ': 'w', // ԝ
  'А': 'a', // А
  'В': 'b', // В
  'Е': 'e', // Е
  'К': 'k', // К
  'М': 'm', // М
  'Н': 'h', // Н
  'О': 'o', // О
  'Р': 'p', // Р
  'С': 'c', // С
  'Т': 't', // Т
  'Х': 'x', // Х
  // Greek
  'ο': 'o', // ο
  'ρ': 'p', // ρ
  'ν': 'v', // ν
  'κ': 'k', // κ
  'ι': 'i', // ι
  'υ': 'u', // υ
  'χ': 'x', // χ
  'Ρ': 'p', // Ρ
  'Ο': 'o', // Ο
  'Α': 'a', // Α
  'Β': 'b', // Β
  'Ε': 'e', // Ε
  'Η': 'h', // Η
  'Ι': 'i', // Ι
  'Κ': 'k', // Κ
  'Μ': 'm', // Μ
  'Ν': 'n', // Ν
  'Τ': 't', // Τ
  'Υ': 'y', // Υ
  'Χ': 'x', // Χ
  'Ζ': 'z', // Ζ
  // Armenian
  'օ': 'o', // օ
  'հ': 'h', // հ
  'ց': 'g', // ց
  // Latin lookalikes and digits
  'ı': 'i', // dotless i
  'ȷ': 'j', // dotless j
  'ɑ': 'a', // ɑ
  'ᴏ': 'o',
  0: 'o',
  1: 'l',
  3: 'e',
  4: 'a',
  5: 's',
  7: 't',
  8: 'b',
  '|': 'l',
});

/** Second-level labels under which registrations happen (co.uk, com.au...). */
export const SECOND_LEVEL_LABELS = Object.freeze(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'mil']);
