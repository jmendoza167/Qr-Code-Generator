// The hand-made examples gallery in docs/examples/: every PNG must be a QR
// code that decodes to the content listed here, every SVG must be a
// well-formed SVG document, and the folder must hold nothing else.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pngjs from 'pngjs';
import { decodeRgba } from './helpers/decode.js';

const { PNG } = pngjs;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES_DIR = join(ROOT, 'docs', 'examples');

/** Expected content of every example (the text passed to qrgen). */
const EXPECTED = {
  'plain.png': 'https://github.com/jmendoza167/Qr-Code-Generator',
  'colors.svg': 'https://example.com',
  'rounded.png': 'https://github.com/jmendoza167/Qr-Code-Generator',
  'dots.png': 'https://github.com/jmendoza167/Qr-Code-Generator',
  'gradient.png': 'https://github.com/jmendoza167/Qr-Code-Generator',
  'logo-photo.png': 'https://github.com/jmendoza167',
  'logo-instagram.png': 'https://instagram.com/jmendoza.16',
  'logo-linkedin.png': 'https://www.linkedin.com',
  'logo-x.svg': 'https://x.com',
};

const entries = readdirSync(EXAMPLES_DIR);
const images = entries.filter((f) => /\.(png|svg)$/i.test(f));

/**
 * Lightweight well-formedness check for an SVG document: a single <svg>
 * root with the SVG namespace, and properly nested open/close tags.
 */
/**
 * Remove every match of `pattern`, repeating until nothing changes, so a
 * removal cannot leave a new match behind (e.g. "<!--<!---->-->" would
 * otherwise become "<!---->"). Both patterns here are multi-character
 * delimiters, which is why a single replace is not enough.
 */
function stripRepeatedly(text, pattern) {
  let previous;
  do {
    previous = text;
    text = text.replace(pattern, '');
  } while (text !== previous);
  return text;
}

function assertWellFormedSvg(source, label) {
  const body = stripRepeatedly(stripRepeatedly(source, /<\?xml[\s\S]*?\?>/g), /<!--[\s\S]*?-->/g).trim();
  assert.ok(body.startsWith('<svg'), `${label}: must start with <svg`);
  assert.ok(body.endsWith('</svg>'), `${label}: must end with </svg>`);
  assert.match(body, /^<svg[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/, `${label}: SVG namespace`);
  const stack = [];
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)(?:"[^"]*"|'[^']*'|[^'">])*?(\/?)>/g;
  let match;
  let count = 0;
  while ((match = tagRe.exec(body)) !== null) {
    const [, closing, name, selfClosing] = match;
    count++;
    if (selfClosing) continue;
    if (closing) {
      assert.equal(stack.pop(), name, `${label}: unexpected </${name}>`);
    } else {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], `${label}: unclosed tags`);
  assert.ok(count > 0);
}

describe('docs/examples gallery (hand-made)', () => {
  test('contains exactly the listed QR images plus README.md', () => {
    assert.deepEqual([...images].sort(), Object.keys(EXPECTED).sort());
    assert.deepEqual(entries.filter((f) => !/\.(png|svg)$/i.test(f)), ['README.md']);
  });

  for (const file of images.filter((f) => f.endsWith('.png'))) {
    test(`${file} decodes with jsQR to its expected content`, () => {
      assert.ok(file in EXPECTED, `${file} is not in the expected list`);
      const png = PNG.sync.read(readFileSync(join(EXAMPLES_DIR, file)));
      const decoded = decodeRgba(png.data, png.width, png.height);
      assert.ok(decoded, 'jsQR returned null');
      assert.equal(decoded.data, EXPECTED[file]);
    });
  }

  for (const file of images.filter((f) => f.endsWith('.svg'))) {
    test(`${file} is a well-formed SVG produced by qrgen`, () => {
      assert.ok(file in EXPECTED, `${file} is not in the expected list`);
      const svg = readFileSync(join(EXAMPLES_DIR, file), 'utf8');
      assertWellFormedSvg(svg, file);
      assert.match(svg, /<rect width="\d+" height="\d+" fill="#[0-9a-f]{6}"\/>/, 'background rect');
      assert.match(svg, /<path fill="[^"]+" d="M/, 'module path');
    });
  }

  test('colors.svg uses the requested colours; logo-x.svg embeds the PNG logo over a white area', () => {
    const colors = readFileSync(join(EXAMPLES_DIR, 'colors.svg'), 'utf8');
    assert.match(colors, /fill="#fffde7"/);
    assert.match(colors, /<path fill="#1a237e"/);
    const x = readFileSync(join(EXAMPLES_DIR, 'logo-x.svg'), 'utf8');
    assert.match(x, /<rect [^>]*fill="#ffffff"\/>\s*<image href="data:image\/png;base64,/);
  });

  test('the gallery README lists every image with its command and the Wi-Fi notes', () => {
    const readme = readFileSync(join(EXAMPLES_DIR, 'README.md'), 'utf8');
    for (const [file, content] of Object.entries(EXPECTED)) {
      assert.ok(readme.includes(`](${file})`), `preview for ${file}`);
      assert.ok(readme.includes(`\`qrgen "${content}" -o ${file}`), `command for ${file}`);
    }
    assert.match(readme, /--logo your-logo\.png/);
    assert.match(readme, /not part of the repository/);
    assert.match(readme, /qrgen wifi --ssid "YourNetwork" -o wifi\.png/);
    assert.match(readme, /hidden input/);
    assert.match(readme, /plain text/);
    assert.doesNotMatch(readme, /wifi\.png\)/, 'no Wi-Fi image is linked');
  });

  test('the main README links to the gallery and shows some previews', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    assert.match(readme, /## Gallery/);
    assert.match(readme, /docs\/examples\/README\.md/);
    const previews = readme.match(/docs\/examples\/([a-z-]+\.png)/g) ?? [];
    assert.ok(previews.length >= 3 && previews.length <= 4, `previews: ${previews}`);
    for (const p of previews) assert.ok(p.replace('docs/examples/', '') in EXPECTED, p);
    assert.doesNotMatch(readme, /npm run examples/);
  });
});
