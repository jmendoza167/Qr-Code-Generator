/**
 * The qrgen command-line interface (Node only).
 *
 * Structure:
 *   - OUTPUT_OPTIONS are shared by every command (file, size, colours...).
 *   - COMMANDS maps a subcommand name ("wifi", "contact") to its own options,
 *     help text and a buildText() that turns parsed values into the string
 *     to encode. The default command encodes the positional text (or stdin).
 *   - parseCliArgs() turns argv into a validated options object,
 *   - run() does the work and returns an exit code; it never calls
 *     process.exit itself, which keeps it testable.
 *
 * Exit codes: 0 success, 1 encoding or file error, 2 usage error.
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { encode, getCapacity, DataTooLongError, MAX_VERSION } from './core/qr.js';
import { getEccLevel } from './core/version.js';
import { normalizeStyle, checkContrast } from './render/style.js';
import { encodeWithLogo, DEFAULT_LOGO_SIZE, DEFAULT_LOGO_PADDING, MAX_LOGO_SIZE } from './render/logo.js';
import { sanitizeSvg } from './render/svg-sanitize.js';
import { decodePng, PngDecodeError } from './render/png-decode.js';
import { renderTerminal } from './render/terminal.js';
import { renderSvg } from './render/svg.js';
import { renderPng } from './render/png.js';
import { buildWifiPayload, normalizeWifiSecurity } from './presets/wifi.js';
import { buildVCard } from './presets/vcard.js';
import { decodeQrPng } from './decode/from-png.js';
import { QrDecodeError } from './decode/errors.js';
import { inspectPayload, formatReport } from './inspect/index.js';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
/** `qrgen inspect` only: the content is suspicious (verdict medium or high). */
export const EXIT_SUSPICIOUS = 2;

/** Thrown for anything the user got wrong on the command line. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

// Control characters (C0 including ESC, DEL, C1 including the one-byte CSI),
// the Unicode line/paragraph separators and the bidirectional overrides.
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/**
 * Make text safe to print on a terminal. File names, option values and the
 * messages built from them are user input: echoed raw, an ESC in them would
 * be run by the terminal as an escape sequence (move the cursor, rewrite
 * earlier output, change the window title...). Every control character is
 * shown as a visible escape such as \x1b instead.
 */
export function printable(text) {
  return String(text).replace(UNPRINTABLE, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x100 ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
  });
}

/** Write one line of message text (never the QR code itself) with control characters escaped. */
function say(stream, line) {
  stream.write(`${printable(line)}\n`);
}

/** Options every command accepts. */
const OUTPUT_OPTIONS = {
  output: { type: 'string', short: 'o' },
  ecc: { type: 'string', short: 'e' },
  scale: { type: 'string', short: 's', default: '10' },
  margin: { type: 'string', short: 'm', default: '4' },
  fg: { type: 'string', default: '#000000' },
  bg: { type: 'string', default: '#ffffff' },
  shape: { type: 'string', default: 'square' },
  finder: { type: 'string', default: 'square' },
  'finder-color': { type: 'string' },
  gradient: { type: 'string' },
  'gradient-dir': { type: 'string', default: 'diagonal' },
  logo: { type: 'string' },
  'logo-size': { type: 'string', default: String(DEFAULT_LOGO_SIZE) },
  'logo-padding': { type: 'string', default: String(DEFAULT_LOGO_PADDING) },
  'logo-bg': { type: 'string' },
  ascii: { type: 'boolean', default: false },
  invert: { type: 'boolean', default: false },
  info: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

const OUTPUT_OPTIONS_HELP = `Output options (all commands):
  -o, --output <file>   Save to a file instead of printing; the extension
                        picks the format (.png or .svg)
  -e, --ecc <L|M|Q|H>   Error correction level (default: M)
  -s, --scale <n>       Pixels per module for PNG/SVG (default: 10)
  -m, --margin <n>      Quiet zone in modules (default: 4)
      --fg <hex>        Foreground colour for PNG/SVG (default: #000000)
      --bg <hex>        Background colour for PNG/SVG (default: #ffffff)
      --ascii           Print with "##" instead of Unicode half blocks
      --invert          Swap dark and light in the terminal output
      --info            Also print version, mode, ECC level and mask
  -h, --help            Show this help
  -v, --version         Show the version number

Style options (PNG/SVG only; the terminal always shows the plain code):
      --shape <square|rounded|dots>      Shape of the data modules
      --finder <square|rounded|circle>   Style of the three finder patterns
      --finder-color <hex>               Separate colour for the finders
      --gradient <hex1,hex2>             Gradient fill for the dark modules
      --gradient-dir <horizontal|vertical|diagonal|radial>  (default: diagonal)
  Keep the contrast high (dark on light); qrgen warns when colours look
  hard to scan. Always test-scan a styled code before printing it.

Logo options (PNG/SVG only):
      --logo <file.png|file.svg>  Image for the centre. PNG logos work in
                                  both outputs; SVG logos only in .svg output
      --logo-size <percent>       Larger side as % of the code width
                                  (default: ${DEFAULT_LOGO_SIZE}, max ${MAX_LOGO_SIZE})
      --logo-padding <modules>    Clear modules around the logo (default: ${DEFAULT_LOGO_PADDING})
      --logo-bg <hex>             Fill the cleared area with a colour
  A logo forces error correction level H and never covers the finder,
  timing or alignment patterns; qrgen picks a larger version if needed.

Exit codes: 0 success, 1 encoding or file error, 2 usage error
`;

/**
 * Commands. `buildText(values, io)` may be async (the Wi-Fi command can
 * prompt for the password). `notes` returned alongside the text are printed
 * to stderr.
 */
const COMMANDS = {
  text: {
    positionals: true,
    options: {},
    help: `Usage: qrgen [text] [options]
       qrgen wifi --ssid <name> [--pass <password>] [options]
       qrgen contact --name <name> [contact fields] [options]

Generate a QR code from text. Without a text argument the text is read
from standard input (echo "hello" | qrgen). To encode text that is also a
command name, put it after "--": qrgen -o out.png -- wifi

Commands:
  wifi       Wi-Fi network credentials      (qrgen wifi --help)
  contact    Contact card in vCard format   (qrgen contact --help)
  inspect    Decode a QR image and check its content for phishing signals
                                            (qrgen inspect --help)

${OUTPUT_OPTIONS_HELP}
Examples:
  qrgen "hello world"
  qrgen "https://example.com" -e H --info
  qrgen "https://example.com" -o qr.png -s 8 --fg "#1a237e" --bg "#ffffff"
  qrgen "https://example.com" -o qr.svg -m 2
  echo "hello" | qrgen --ascii
  qrgen wifi --ssid "Home" --security WPA
  qrgen contact --name "Javier Mendoza" --phone "+34 600 000 000" -o card.png
`,
    async buildText(values, positionals, io) {
      if (positionals.length > 1) {
        throw new UsageError(
          `Expected one text argument but got ${positionals.length}. Quote text that contains spaces: qrgen "hello world"`,
        );
      }
      const text = positionals[0] ?? (await readStdin(io.stdin));
      if (text.length === 0) {
        throw new UsageError('No input text. Pass it as an argument (qrgen "hello") or pipe it in (echo hello | qrgen)');
      }
      return { text, notes: [] };
    },
  },

  wifi: {
    positionals: false,
    options: {
      ssid: { type: 'string' },
      pass: { type: 'string' },
      security: { type: 'string' },
      hidden: { type: 'boolean', default: false },
    },
    help: `Usage: qrgen wifi --ssid <name> [--pass <password>] [options]

Encode Wi-Fi credentials; scanning joins the network.

Wi-Fi options:
      --ssid <name>             Network name (required)
      --pass <password>         Password. If omitted (and security is not
                                nopass) it is read from stdin when piped,
                                otherwise prompted for without echo, so it
                                stays out of your shell history
      --security <WPA|WEP|nopass>  Default: WPA (WPA2/WPA3 use WPA)
      --hidden                  The network does not broadcast its SSID

${OUTPUT_OPTIONS_HELP}
Examples:
  qrgen wifi --ssid "Home"                   (prompts for the password)
  qrgen wifi --ssid "Cafe" --security nopass -o cafe.png
  qrgen wifi --ssid "Home" --pass "secret" --hidden -e Q
`,
    async buildText(values, positionals, io) {
      if (values.ssid === undefined) throw new UsageError('--ssid is required (qrgen wifi --ssid "Network name")');
      let security;
      try {
        security = normalizeWifiSecurity(values.security);
      } catch (err) {
        throw new UsageError(err.message);
      }
      let password = values.pass;
      if (password === undefined && security !== 'nopass') {
        password = io.stdin.isTTY ? await promptHidden('Wi-Fi password: ', io) : await readStdin(io.stdin);
        if (password.length === 0) throw new UsageError('No password given (use --pass, pipe it in, or --security nopass)');
      }
      const text = buildWifiPayload({ ssid: values.ssid, password, security, hidden: values.hidden });
      const notes = [];
      if (password) {
        notes.push('Note: the QR code contains the Wi-Fi password in plain text; anyone who scans it can read it.');
      }
      return { text, notes };
    },
  },

  contact: {
    positionals: false,
    options: {
      name: { type: 'string' },
      phone: { type: 'string', multiple: true },
      email: { type: 'string', multiple: true },
      org: { type: 'string' },
      title: { type: 'string' },
      url: { type: 'string' },
      address: { type: 'string' },
      note: { type: 'string' },
    },
    help: `Usage: qrgen contact --name <name> [contact fields] [options]

Encode a contact card (vCard 3.0); scanning offers to save the contact.

Contact fields:
      --name <full name>    Required. The last word becomes the family name
      --phone <number>      May be repeated
      --email <address>     May be repeated
      --org <organisation>
      --title <job title>
      --url <website>
      --address <text>
      --note <text>

${OUTPUT_OPTIONS_HELP}
Example:
  qrgen contact --name "Javier Mendoza" --phone "+34 600 000 000" --email "javier@example.com" -o card.png
`,
    async buildText(values) {
      if (values.name === undefined) throw new UsageError('--name is required (qrgen contact --name "Full Name")');
      const text = buildVCard({
        name: values.name,
        phones: values.phone,
        emails: values.email,
        org: values.org,
        title: values.title,
        url: values.url,
        address: values.address,
        note: values.note,
      });
      return { text, notes: [] };
    },
  },
};

export const HELP = COMMANDS.text.help;

function parseInteger(name, value, min) {
  if (!/^-?\d+$/.test(value) || Number(value) < min) {
    throw new UsageError(`--${name} must be an integer >= ${min}, got ${JSON.stringify(value)}`);
  }
  return Number(value);
}

/**
 * @param {string[]} argv  arguments without the node binary and script path
 */
export function parseCliArgs(argv) {
  const commandName = Object.hasOwn(COMMANDS, argv[0]) && argv[0] !== 'text' ? argv[0] : 'text';
  const command = COMMANDS[commandName];
  const args = commandName === 'text' ? argv : argv.slice(1);

  let parsed;
  try {
    parsed = parseArgs({
      args,
      options: { ...OUTPUT_OPTIONS, ...command.options },
      allowPositionals: command.positionals,
      strict: true,
    });
  } catch (err) {
    throw new UsageError(err.message);
  }
  const { values, positionals } = parsed;

  if (values.help || values.version) {
    return { command: commandName, help: values.help, version: values.version };
  }

  let ecc;
  try {
    ecc = getEccLevel(values.ecc ?? 'M').name;
  } catch (err) {
    throw new UsageError(err.message);
  }

  const output = values.output;
  let format;
  if (output !== undefined) {
    format = extname(output).toLowerCase().slice(1);
    if (format !== 'png' && format !== 'svg') {
      throw new UsageError(`Cannot tell the output format from ${JSON.stringify(output)}: use a .png or .svg extension`);
    }
  }

  // Colours and style options are validated here so mistakes are reported
  // as usage errors; the normalised values are passed on to the renderers.
  let style;
  try {
    style = normalizeStyle({
      fg: values.fg,
      bg: values.bg,
      shape: values.shape,
      finder: values.finder,
      finderColor: values['finder-color'],
      gradient: values.gradient,
      gradientDir: values['gradient-dir'],
    });
  } catch (err) {
    throw new UsageError(err.message);
  }

  let logo = null;
  if (values.logo !== undefined) {
    const sizePercent = Number(values['logo-size']);
    if (!(sizePercent > 0 && sizePercent <= MAX_LOGO_SIZE)) {
      throw new UsageError(`--logo-size must be between 1 and ${MAX_LOGO_SIZE} (percent of the code width), got ${JSON.stringify(values['logo-size'])}`);
    }
    let bg;
    try {
      bg = values['logo-bg'] === undefined ? undefined : normalizeStyle({ fg: values['logo-bg'] }).fg;
    } catch (err) {
      throw new UsageError(`--logo-bg: ${err.message}`);
    }
    logo = { file: values.logo, sizePercent, padding: parseInteger('logo-padding', values['logo-padding'], 0), bg };
  }

  return {
    command: commandName,
    help: false,
    version: false,
    values,
    positionals,
    output,
    format,
    ecc,
    eccExplicit: values.ecc !== undefined,
    scale: parseInteger('scale', values.scale, 1),
    margin: parseInteger('margin', values.margin, 0),
    fg: style.fg,
    bg: style.bg,
    style,
    logo,
    ascii: values.ascii,
    invert: values.invert,
    info: values.info,
  };
}

/**
 * The most input a QR code can ever hold: the largest symbol at the lowest
 * error correction level stores 7089 digits (one byte each). Anything in
 * another mode fits less (2953 bytes of UTF-8 text).
 */
export const MAX_INPUT_BYTES = getCapacity(MAX_VERSION, 'L', 'numeric');
// A UTF-8 byte order mark (3 bytes) and one trailing CRLF are dropped, so they do not count.
const STDIN_ALLOWANCE = 5;

/**
 * Read stdin as UTF-8, dropping a BOM and one trailing line break. Reading
 * stops as soon as the input is larger than any QR code could hold, so an
 * endless or huge stream cannot fill the memory.
 */
async function readStdin(stdin) {
  if (stdin.isTTY) return '';
  const chunks = [];
  let total = 0;
  for await (const chunk of stdin) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    total += bytes.length;
    if (total > MAX_INPUT_BYTES + STDIN_ALLOWANCE) {
      // Throwing out of the loop closes the stream: nothing more is read.
      throw new DataTooLongError(
        `Data too long: the input is larger than ${MAX_INPUT_BYTES} bytes, more than the largest QR code (version ${MAX_VERSION}-L) can hold`,
        { capacity: MAX_INPUT_BYTES },
      );
    }
    chunks.push(bytes);
  }
  let text = Buffer.concat(chunks).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r?\n$/, '');
}

/**
 * Ask for a secret on an interactive terminal without echoing it. Uses raw
 * mode so no character reaches the screen or the shell history. The prompt
 * goes to stderr so stdout stays clean for -o / piping.
 */
const CTRL_C = String.fromCharCode(3);
const DEL = String.fromCharCode(127);
const BACKSPACE = String.fromCharCode(8);

function promptHidden(question, { stdin, stderr }) {
  return new Promise((resolve, reject) => {
    stderr.write(question);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';
    const finish = (fn, arg) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stderr.write('\n');
      fn(arg);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish(resolve, value);
        if (ch === CTRL_C) return finish(reject, new UsageError("Cancelled"));
        if (ch === DEL || ch === BACKSPACE) value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
      return undefined;
    };
    stdin.on('data', onData);
  });
}

/**
 * Read and validate the logo file. Returns the image's aspect ratio and the
 * `logo` fields the renderer expects: PNG logos give `image` (decoded RGBA,
 * for PNG output) and `png` (the raw bytes, embedded as a data URI in SVG
 * output); SVG logos give `svg` (markup; the renderer sanitizes it and embeds
 * it as a data URI image, never inline).
 */
function loadLogo({ file }, format) {
  let bytes;
  try {
    bytes = readFileSync(file);
  } catch (err) {
    throw new UsageError(`Cannot read logo file ${file}: ${err.message}`);
  }
  if (extname(file).toLowerCase() === '.svg') {
    if (format !== 'svg') {
      throw new UsageError('SVG logos are only supported in SVG output: use a PNG logo, or save the code as .svg');
    }
    const markup = bytes.toString('utf8');
    try {
      return { aspect: sanitizeSvg(markup).aspect, logo: { svg: markup } };
    } catch (err) {
      throw new UsageError(`${file}: ${err.message}`);
    }
  }
  try {
    const image = decodePng(bytes);
    return { aspect: image.width / image.height, logo: { image, png: bytes } };
  } catch (err) {
    if (err instanceof PngDecodeError) throw new UsageError(`${file}: ${err.message}`);
    throw err;
  }
}

function readPackageVersion() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

function formatInfo(qr) {
  return [
    `Version: ${qr.version} (${qr.size}x${qr.size} modules)`,
    `Mode:    ${qr.mode}`,
    `ECC:     ${qr.ecc}`,
    `Mask:    ${qr.mask}`,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// qrgen inspect: decode an image and analyse its content, offline.

const INSPECT_HELP = `Usage: qrgen inspect <image.png> [--json]
       qrgen inspect --text "<payload>" [--json]

Decode a QR code image and check its content for phishing and abuse
signals: dangerous link types, fake hosts, lookalike and brand-imitating
domains, link shorteners, open Wi-Fi networks, hidden characters and more.

The check is heuristic and runs offline on the decoded text only: qrgen
never opens the link and makes no network request of any kind. A clean
result cannot prove that a code is safe; it only means none of the known
warning signs were found.

Options:
      --text <payload>  Analyse this text instead of decoding an image
      --json            Machine-readable output (the report plus exitCode)
  -h, --help            Show this help

The decoded content is printed with control characters escaped (\\x1b,
\\u202e...), so a hostile payload cannot drive your terminal.

Exit codes: 0 no findings or low, 2 medium or high, 1 error (unreadable
image, no QR code found, bad arguments). Unlike the other commands, usage
mistakes exit 1 here so that 2 always means "suspicious".
`;

const INSPECT_OPTIONS = {
  text: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

/** Line/paragraph separators and the bidi controls: valid in JSON strings, but not safe to print raw. */
const JSON_UNSAFE = new RegExp('[\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]', 'g');

/** JSON with those characters escaped too, so the output is safe to print as-is. */
function safeJson(value) {
  return JSON.stringify(value, null, 2).replace(JSON_UNSAFE, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

async function runInspect(argv, { stdout, stderr }) {
  let values;
  let positionals;
  let json = argv.includes('--json');
  const fail = (err) => {
    if (json) stdout.write(`${safeJson({ error: { name: err.name, message: err.message }, exitCode: EXIT_ERROR })}\n`);
    say(stderr, `qrgen inspect: ${err.message}`);
    if (err instanceof UsageError) stderr.write("Try 'qrgen inspect --help' for more information.\n");
    return EXIT_ERROR;
  };

  try {
    ({ values, positionals } = parseArgs({ args: argv, options: INSPECT_OPTIONS, allowPositionals: true, strict: true }));
  } catch (err) {
    return fail(new UsageError(err.message));
  }
  json = values.json;
  if (values.help) {
    stdout.write(INSPECT_HELP);
    return EXIT_OK;
  }
  if (values.text !== undefined && positionals.length > 0) return fail(new UsageError('Give either an image file or --text, not both'));
  if (values.text === undefined && positionals.length !== 1) {
    return fail(new UsageError(positionals.length === 0 ? 'Expected an image file or --text "<payload>"' : `Expected one image file but got ${positionals.length}`));
  }

  let text;
  let meta = {};
  if (values.text !== undefined) {
    text = values.text;
  } else {
    try {
      const decoded = decodeQrPng(readFileSync(positionals[0]));
      text = decoded.text;
      const { version, ecc, mask, errorsCorrected, encoding, eci, inverted } = decoded;
      meta = { version, ecc, mask, errorsCorrected, encoding, eci, inverted };
    } catch (err) {
      // Unreadable file, not a PNG, oversized image, no QR code: all exit 1.
      if (err instanceof QrDecodeError || err instanceof PngDecodeError || err instanceof RangeError || err.code !== undefined) return fail(err);
      throw err;
    }
  }

  const report = inspectPayload(text, meta);
  const exitCode = report.verdict === 'medium' || report.verdict === 'high' ? EXIT_SUSPICIOUS : EXIT_OK;
  if (json) stdout.write(`${safeJson({ ...report, exitCode })}\n`);
  else stdout.write(formatReport(report, { escape: printable }));
  return exitCode;
}

/**
 * Run the CLI. Streams are injectable for tests.
 * @returns {Promise<number>} exit code
 */
export async function run(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  if (argv[0] === 'inspect') return runInspect(argv.slice(1), { stdout, stderr });
  try {
    const args = parseCliArgs(argv);
    if (args.help) {
      stdout.write(COMMANDS[args.command].help);
      return EXIT_OK;
    }
    if (args.version) {
      stdout.write(`${readPackageVersion()}\n`);
      return EXIT_OK;
    }

    let built;
    try {
      built = await COMMANDS[args.command].buildText(args.values, args.positionals, { stdin, stdout, stderr });
    } catch (err) {
      // Preset builders throw RangeError for bad field values: user input.
      // Too much data is an encoding error (exit code 1), like in encode().
      throw err instanceof RangeError && !(err instanceof DataTooLongError) ? new UsageError(err.message) : err;
    }
    for (const note of built.notes) say(stderr, note);

    let qr;
    if (args.output) {
      for (const warning of checkContrast(args.style)) say(stderr, `Warning: ${warning}`);
      const renderOptions = {
        scale: args.scale,
        margin: args.margin,
        fg: args.style.fg,
        bg: args.style.bg,
        shape: args.style.shape,
        finder: args.style.finder,
        finderColor: args.style.finderColor ?? undefined,
        gradient: args.style.gradient ? [args.style.gradient.from, args.style.gradient.to] : undefined,
        gradientDir: args.style.gradient?.direction,
      };
      let matrix;
      if (args.logo) {
        const loaded = loadLogo(args.logo, args.format);
        if (args.eccExplicit && args.ecc !== 'H') {
          say(stderr, `Warning: ECC level ${args.ecc} overridden to H because a logo covers part of the code`);
        }
        const withLogo = encodeWithLogo(built.text, {
          sizePercent: args.logo.sizePercent,
          padding: args.logo.padding,
          aspect: loaded.aspect,
        });
        qr = withLogo.qr;
        matrix = withLogo.plan.matrix;
        for (const note of withLogo.notes) say(stderr, `Note: ${note}`);
        for (const warning of withLogo.plan.warnings) say(stderr, `Warning: ${warning}`);
        renderOptions.logo = { ...loaded.logo, box: withLogo.plan.box, area: withLogo.plan.area, bg: args.logo.bg };
      } else {
        qr = encode(built.text, { ecc: args.ecc });
        matrix = qr.matrix;
      }
      const data = args.format === 'png' ? renderPng(matrix, renderOptions) : renderSvg(matrix, renderOptions);
      writeFileSync(args.output, data);
      say(stdout, `Saved ${args.output}`);
    } else {
      if (!args.style.isPlain) {
        stderr.write('Note: style options only apply to PNG/SVG files (-o); the terminal shows the plain code.\n');
      }
      if (args.logo) stderr.write('Note: the logo only applies to PNG/SVG files (-o); the terminal shows the plain code.\n');
      qr = encode(built.text, { ecc: args.ecc });
      stdout.write(`${renderTerminal(qr.matrix, { margin: args.margin, ascii: args.ascii, invert: args.invert })}\n`);
    }

    if (args.info) stdout.write(formatInfo(qr));
    return EXIT_OK;
  } catch (err) {
    say(stderr, `qrgen: ${err.message}`);
    if (err instanceof UsageError) {
      stderr.write("Try 'qrgen --help' for more information.\n");
      return EXIT_USAGE;
    }
    return EXIT_ERROR;
  }
}
