/**
 * The qrgen command-line interface (Node only).
 *
 * Structure, so that presets (wifi, vCard, ...) can be added later without
 * touching the entry point:
 *   - OPTIONS / HELP describe the flags,
 *   - parseCliArgs() turns argv into a validated options object,
 *   - run() does the work and returns an exit code; it never calls
 *     process.exit itself, which keeps it testable.
 *
 * Exit codes: 0 success, 1 encoding or file error, 2 usage error.
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { encode } from './core/qr.js';
import { getEccLevel } from './core/version.js';
import { parseColor } from './render/color.js';
import { renderTerminal } from './render/terminal.js';
import { renderSvg } from './render/svg.js';
import { renderPng } from './render/png.js';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;

/** Thrown for anything the user got wrong on the command line. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const OPTIONS = {
  output: { type: 'string', short: 'o' },
  ecc: { type: 'string', short: 'e', default: 'M' },
  scale: { type: 'string', short: 's', default: '10' },
  margin: { type: 'string', short: 'm', default: '4' },
  fg: { type: 'string', default: '#000000' },
  bg: { type: 'string', default: '#ffffff' },
  ascii: { type: 'boolean', default: false },
  invert: { type: 'boolean', default: false },
  info: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

export const HELP = `Usage: qrgen [text] [options]

Generate a QR code from text. Without a text argument the text is read
from standard input (echo "hello" | qrgen).

Options:
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

Examples:
  qrgen "hello world"
  qrgen "https://example.com" -e H --info
  qrgen "https://example.com" -o qr.png -s 8 --fg "#1a237e" --bg "#ffffff"
  qrgen "https://example.com" -o qr.svg -m 2
  echo "hello" | qrgen --ascii

Exit codes: 0 success, 1 encoding or file error, 2 usage error
`;

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
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err.message);
  }
  const { values, positionals } = parsed;

  if (values.help || values.version) {
    return { help: values.help, version: values.version };
  }
  if (positionals.length > 1) {
    throw new UsageError(
      `Expected one text argument but got ${positionals.length}. Quote text that contains spaces: qrgen "hello world"`,
    );
  }

  let ecc;
  try {
    ecc = getEccLevel(values.ecc).name;
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

  let fg;
  let bg;
  try {
    fg = parseColor(values.fg).hex;
    bg = parseColor(values.bg).hex;
  } catch (err) {
    throw new UsageError(err.message);
  }

  return {
    help: false,
    version: false,
    text: positionals[0],
    output,
    format,
    ecc,
    scale: parseInteger('scale', values.scale, 1),
    margin: parseInteger('margin', values.margin, 0),
    fg,
    bg,
    ascii: values.ascii,
    invert: values.invert,
    info: values.info,
  };
}

/** Read all of stdin as UTF-8, dropping a BOM and one trailing line break. */
async function readStdin(stdin) {
  if (stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of stdin) chunks.push(chunk);
  let text = Buffer.concat(chunks).toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r?\n$/, '');
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

/**
 * Run the CLI. Streams are injectable for tests.
 * @returns {Promise<number>} exit code
 */
export async function run(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const args = parseCliArgs(argv);
    if (args.help) {
      stdout.write(HELP);
      return EXIT_OK;
    }
    if (args.version) {
      stdout.write(`${readPackageVersion()}\n`);
      return EXIT_OK;
    }

    const text = args.text ?? (await readStdin(stdin));
    if (text.length === 0) {
      throw new UsageError('No input text. Pass it as an argument (qrgen "hello") or pipe it in (echo hello | qrgen)');
    }

    const qr = encode(text, { ecc: args.ecc });

    if (args.output) {
      const renderOptions = { scale: args.scale, margin: args.margin, fg: args.fg, bg: args.bg };
      const data = args.format === 'png' ? renderPng(qr.matrix, renderOptions) : renderSvg(qr.matrix, renderOptions);
      writeFileSync(args.output, data);
      stdout.write(`Saved ${args.output}\n`);
    } else {
      stdout.write(`${renderTerminal(qr.matrix, { margin: args.margin, ascii: args.ascii, invert: args.invert })}\n`);
    }

    if (args.info) stdout.write(formatInfo(qr));
    return EXIT_OK;
  } catch (err) {
    stderr.write(`qrgen: ${err.message}\n`);
    if (err instanceof UsageError) {
      stderr.write("Try 'qrgen --help' for more information.\n");
      return EXIT_USAGE;
    }
    return EXIT_ERROR;
  }
}
