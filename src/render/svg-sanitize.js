/**
 * Sanitize an SVG logo and embed it in our own SVG output. Pure JS.
 *
 * An SVG file is a programme as much as a picture: it can carry scripts,
 * event handlers and references to remote resources. Two layers keep that
 * away from whoever opens the QR code:
 *
 *   1. The logo is never inlined. embedSvgLogo() puts it in the output as
 *      <image href="data:image/svg+xml;base64,...">, exactly like a PNG
 *      logo. Browsers render an SVG that is loaded as an image in a
 *      restricted mode: no scripts, no event handlers, no external loads.
 *      This is the real protection.
 *
 *   2. Defence in depth: the markup is sanitized before it is encoded. The
 *      document is tokenized strictly (anything that is not well-formed XML
 *      is refused, including unquoted attributes) and then written out
 *      again from the tokens, so what leaves here never contains bytes we
 *      did not understand. On the way:
 *        - only known SVG elements are kept; <script>, <foreignObject>,
 *          HTML and anything with a namespace prefix go, with their content,
 *        - on* attributes, xmlns declarations and prefixed attributes other
 *          than xlink:href are dropped,
 *        - href / xlink:href must be "#fragment" (or a base64 raster
 *          data: URI on <image>),
 *        - <set> / <animate*> that target href or an event attribute go,
 *        - url(...) that is not "#fragment", CSS @import and CSS with
 *          escapes are removed,
 *        - comments, CDATA, processing instructions, the doctype and
 *          custom entities do not survive.
 *      The whole thing is repeated until the output stops changing.
 *
 * The root <svg> element is replaced by one we write ourselves.
 */
import { encodeBase64 } from './base64.js';

const fmt = (n) => String(Number(n.toFixed(3)));

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Elements that may appear in a logo. Everything else is dropped with its content. */
const ALLOWED_ELEMENTS = new Set([
  'svg', 'g', 'defs', 'symbol', 'use', 'switch', 'a', 'view',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'image',
  'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker',
  'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
  'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood',
  'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feImage', 'feMerge',
  'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting',
  'feSpotLight', 'feTile', 'feTurbulence',
  'title', 'desc', 'style',
  'animate', 'animateTransform', 'animateMotion', 'mpath', 'set',
]);

/** Elements that may carry an embedded raster image as a data: URI. */
const IMAGE_ELEMENTS = new Set(['image', 'feImage']);

const NAME = /[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?/y;
const SPACE = /[ \t\r\n]*/y;
const PREDEFINED_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
// C0 controls other than tab/LF/CR, DEL and the C1 range: never valid in a logo.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const MAX_PASSES = 8;

function malformed(reason) {
  return new RangeError(`The logo is not a well-formed SVG document (${reason})`);
}

/** Resolve the five XML entities and numeric references; refuse any other. */
function decodeEntities(raw) {
  return raw.replace(/&([^;&<\s]*);?/g, (match, body) => {
    if (!match.endsWith(';')) throw malformed('stray "&"');
    if (Object.hasOwn(PREDEFINED_ENTITIES, body)) return PREDEFINED_ENTITIES[body];
    const numeric = /^#(?:x([0-9a-fA-F]{1,6})|([0-9]{1,7}))$/.exec(body);
    if (!numeric) throw malformed(`unsupported entity &${body.slice(0, 20)};`);
    const code = numeric[1] !== undefined ? parseInt(numeric[1], 16) : parseInt(numeric[2], 10);
    if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw malformed('invalid character reference');
    return String.fromCodePoint(code);
  });
}

const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (s) => escapeText(s).replace(/"/g, '&quot;');

/**
 * Split the document into start tags, end tags and text. Comments,
 * processing instructions and the doctype are skipped; CDATA becomes text.
 */
function tokenize(source) {
  const tokens = [];
  const n = source.length;
  let i = 0;
  const skipSpace = () => {
    SPACE.lastIndex = i;
    SPACE.exec(source);
    i = SPACE.lastIndex;
  };
  const readName = () => {
    NAME.lastIndex = i;
    const m = NAME.exec(source);
    if (!m) return null;
    i = NAME.lastIndex;
    return m[0];
  };
  const skipPast = (terminator, what) => {
    const end = source.indexOf(terminator, i);
    if (end === -1) throw malformed(`unterminated ${what}`);
    const body = source.slice(i, end);
    i = end + terminator.length;
    return body;
  };

  while (i < n) {
    if (source[i] !== '<') {
      const next = source.indexOf('<', i);
      const end = next === -1 ? n : next;
      tokens.push({ type: 'text', value: decodeEntities(source.slice(i, end)) });
      i = end;
    } else if (source.startsWith('<!--', i)) {
      i += 4;
      skipPast('-->', 'comment');
    } else if (source.startsWith('<![CDATA[', i)) {
      i += 9;
      tokens.push({ type: 'text', value: skipPast(']]>', 'CDATA section') });
    } else if (source.startsWith('<?', i)) {
      i += 2;
      skipPast('?>', 'processing instruction');
    } else if (source.startsWith('<!', i)) {
      // <!DOCTYPE ...>, possibly with an internal subset in [ ] and quoted strings.
      let depth = 0;
      let quote = null;
      let closed = false;
      for (i += 2; i < n; i++) {
        const ch = source[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) {
          closed = true;
          i++;
          break;
        }
      }
      if (!closed) throw malformed('unterminated declaration');
    } else if (source.startsWith('</', i)) {
      i += 2;
      const name = readName();
      if (!name) throw malformed('bad closing tag');
      skipSpace();
      if (source[i] !== '>') throw malformed(`bad closing tag </${name}>`);
      i++;
      tokens.push({ type: 'end', name });
    } else {
      i++;
      const name = readName();
      if (!name) throw malformed('"<" that does not start a tag');
      const attributes = [];
      const seen = new Set();
      let selfClosing = false;
      for (;;) {
        const before = i;
        skipSpace();
        if (source[i] === '>') {
          i++;
          break;
        }
        if (source.startsWith('/>', i)) {
          i += 2;
          selfClosing = true;
          break;
        }
        if (i >= n) throw malformed(`unterminated <${name}> tag`);
        if (i === before) throw malformed(`missing space between attributes in <${name}>`);
        const attribute = readName();
        if (!attribute) throw malformed(`bad attribute in <${name}>`);
        skipSpace();
        if (source[i] !== '=') throw malformed(`attribute ${attribute} has no value`);
        i++;
        skipSpace();
        const quote = source[i];
        if (quote !== '"' && quote !== "'") throw malformed(`attribute ${attribute} is not quoted`);
        const end = source.indexOf(quote, i + 1);
        if (end === -1) throw malformed(`unterminated value of attribute ${attribute}`);
        const raw = source.slice(i + 1, end);
        if (raw.includes('<')) throw malformed(`"<" inside the value of attribute ${attribute}`);
        i = end + 1;
        if (seen.has(attribute)) throw malformed(`duplicate attribute ${attribute}`);
        seen.add(attribute);
        attributes.push({ name: attribute, value: decodeEntities(raw) });
      }
      tokens.push({ type: 'start', name, attributes, selfClosing });
    }
  }
  return tokens;
}

/** A URL reduced to what a browser would act on: no whitespace or control characters. */
const compactUrl = (value) => value.replace(/[\u0000- \u007f-\u009f]/g, '');

/** Replace every url(...) that is not a plain "#fragment" with "none". */
function neutralizeUrls(value) {
  return value.replace(/url\s*\(([^)]*)\)?/gi, (match, target) => {
    const cleaned = target.trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
    return match.endsWith(')') && /^#[\w.:-]+$/.test(cleaned) ? `url(#${cleaned.slice(1)})` : 'none';
  });
}

const CSS_FORBIDDEN =
  /@import|@namespace|@charset|expression\s*\(|behaviou?r\s*:|-moz-binding|image-set\s*\(|\bimage\s*\(|\bsrc\s*\(|(?:java|vb|live)script\s*:|[a-z][a-z0-9+.-]*:\/\/|<|\bdata:/i;

/**
 * Clean a stylesheet or a style attribute. CSS escapes (\75rl) and anything
 * that still looks like a remote reference after cleaning make us drop the
 * whole text: a logo loses some styling, never gains a request.
 */
function sanitizeCss(css) {
  if (css.includes('\\')) return '';
  let out = css.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, ' ');
  out = out.replace(/@import[^;]*;?/gi, '');
  out = neutralizeUrls(out);
  return CSS_FORBIDDEN.test(out) ? '' : out;
}

/** True for <set>/<animate*> that would rewrite a link or an event handler. */
function isDangerousAnimation(attributes) {
  for (const { name, value } of attributes) {
    const lower = name.toLowerCase();
    const compact = compactUrl(value).toLowerCase();
    if (lower === 'attributename' && (/(^|:)href$/.test(compact) || compact.startsWith('on'))) return true;
    if (['to', 'from', 'by', 'values'].includes(lower) && /script:|data:/.test(compact)) return true;
  }
  return false;
}

function isAllowedElement(name, attributes) {
  if (!ALLOWED_ELEMENTS.has(name)) return false; // also refuses every prefixed name
  if ((name === 'set' || name.startsWith('animate')) && isDangerousAnimation(attributes)) return false;
  return true;
}

/** The attributes of one kept element, cleaned and serialized. */
function serializeAttributes(element, attributes) {
  let out = '';
  for (const { name, value: decoded } of attributes) {
    const lower = name.toLowerCase();
    if (lower.startsWith('on')) continue;
    if (lower === 'xmlns') continue;
    if (name.includes(':') && lower !== 'xlink:href') continue;

    let value = decoded.replace(CONTROL_CHARS, '');
    if (value.includes('\\')) continue;
    const compact = compactUrl(value);
    if (/(?:java|vb|live)script:/i.test(compact)) continue;

    if (lower === 'href' || lower === 'xlink:href') {
      const fragment = /^#[\w.:-]+$/.test(compact);
      const raster = IMAGE_ELEMENTS.has(element) && /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]*={0,2}$/i.test(compact);
      if (!fragment && !raster) continue;
      value = compact;
    } else if (lower === 'style') {
      value = sanitizeCss(value);
      if (value.trim() === '') continue;
    } else {
      value = neutralizeUrls(value);
      if (/\bdata:/i.test(compact) || /^[a-z][a-z0-9+.-]*:\/\//i.test(compact)) continue;
    }
    out += ` ${name}="${escapeAttribute(value)}"`;
  }
  return out;
}

/** One pass: tokenize, filter, write out again. */
function sanitizeOnce(markup) {
  const tokens = tokenize(markup);
  const stack = []; // { name, dropped, css } for every open element below the root
  let rootAttributes = null;
  let rootClosed = false;
  let inner = '';

  for (const token of tokens) {
    if (rootAttributes === null || rootClosed) {
      // Outside the root element only white space may appear.
      if (token.type === 'text' && token.value.trim() === '') continue;
      if (rootAttributes === null && token.type === 'start' && token.name === 'svg') {
        rootAttributes = token.attributes;
        rootClosed = token.selfClosing;
        continue;
      }
      throw new RangeError('The logo is not an SVG document (no <svg> root element)');
    }

    const top = stack[stack.length - 1];
    const parentDropped = top ? top.dropped || top.name === 'style' : false;

    if (token.type === 'text') {
      if (!top) inner += escapeText(token.value.replace(CONTROL_CHARS, ''));
      else if (top.dropped) continue;
      else if (top.name === 'style') top.css += token.value;
      else inner += escapeText(token.value.replace(CONTROL_CHARS, ''));
    } else if (token.type === 'start') {
      const dropped = parentDropped || !isAllowedElement(token.name, token.attributes);
      if (!dropped) {
        const attributes = serializeAttributes(token.name, token.attributes);
        inner += token.selfClosing ? `<${token.name}${attributes}/>` : `<${token.name}${attributes}>`;
      }
      if (!token.selfClosing) stack.push({ name: token.name, dropped, css: '' });
    } else {
      if (!top) {
        if (token.name !== 'svg') throw malformed(`unexpected </${token.name}>`);
        rootClosed = true;
        continue;
      }
      if (top.name !== token.name) throw malformed(`<${top.name}> closed by </${token.name}>`);
      stack.pop();
      if (top.dropped) continue;
      if (top.name === 'style') inner += escapeText(sanitizeCss(top.css.replace(CONTROL_CHARS, '')));
      inner += `</${token.name}>`;
    }
  }
  if (rootAttributes === null) throw new RangeError('The logo is not an SVG document (no <svg> root element)');
  if (!rootClosed) throw malformed('the <svg> element is never closed');
  return { inner, rootAttributes };
}

/**
 * @param {string} markup  the SVG file contents
 * @returns {{ inner: string, viewBox: number[], aspect: number }}
 * @throws {RangeError} when the text is not a well-formed SVG document
 */
export function sanitizeSvg(markup) {
  if (typeof markup !== 'string') throw new RangeError('The logo is not an SVG document');
  const first = sanitizeOnce(markup.replace(/^\ufeff/, ''));
  const viewBox = readViewBox(first.rootAttributes);

  // Run to a fixed point: sanitizing the result again must change nothing.
  let inner = first.inner;
  for (let pass = 0; ; pass++) {
    const again = sanitizeOnce(`<svg>${inner}</svg>`).inner;
    if (again === inner) break;
    if (pass >= MAX_PASSES) throw new RangeError('The logo could not be sanitized (the SVG keeps changing when cleaned)');
    inner = again;
  }
  return { inner: inner.trim(), viewBox, aspect: viewBox[2] / viewBox[3] };
}

function readViewBox(attributes) {
  const get = (name) => attributes.find((a) => a.name === name)?.value;
  const vb = get('viewBox');
  if (vb !== undefined) {
    const parts = vb.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) return parts;
  }
  const width = parseFloat(get('width'));
  const height = parseFloat(get('height'));
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) return [0, 0, width, height];
  return [0, 0, 100, 100];
}

/**
 * The sanitized logo as a complete, standalone SVG document. The wrapper
 * declares both namespaces so xlink:href inside the logo stays valid XML.
 */
export function standaloneSvgLogo(markup) {
  const { inner, viewBox } = sanitizeSvg(markup);
  return (
    `<svg xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}" width="${fmt(viewBox[2])}" height="${fmt(viewBox[3])}" ` +
    `viewBox="${viewBox.map(fmt).join(' ')}">${inner}</svg>`
  );
}

/**
 * Sanitize the logo and return an <image> element that embeds it as a
 * base64 data URI, placed at `box` (user units of the outer document) and
 * letter-boxed to keep its aspect ratio. The logo's markup never becomes
 * part of the outer document.
 */
export function embedSvgLogo(markup, box) {
  const bytes = new TextEncoder().encode(standaloneSvgLogo(markup));
  return (
    `<image href="data:image/svg+xml;base64,${encodeBase64(bytes)}" x="${fmt(box.x)}" y="${fmt(box.y)}" ` +
    `width="${fmt(box.w)}" height="${fmt(box.h)}" preserveAspectRatio="xMidYMid meet"/>`
  );
}
