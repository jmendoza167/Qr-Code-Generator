// Guards the one architectural rule that matters for the future website:
// the pure engine (src/core) and the browser-reusable renderers must not
// touch Node APIs, so they can be bundled for the browser unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function listJsFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listJsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const BROWSER_SAFE = [
  ...listJsFiles(join(ROOT, 'src', 'core')),
  ...listJsFiles(join(ROOT, 'src', 'presets')),
  join(ROOT, 'src', 'render', 'svg.js'),
  join(ROOT, 'src', 'render', 'terminal.js'),
  join(ROOT, 'src', 'render', 'color.js'),
  join(ROOT, 'src', 'render', 'style.js'),
  join(ROOT, 'src', 'render', 'logo.js'),
  join(ROOT, 'src', 'render', 'base64.js'),
  join(ROOT, 'src', 'render', 'svg-sanitize.js'),
];

// Anything that only exists in Node: node: imports, CommonJS require, the
// classic built-in module names, and the process / Buffer globals.
const NODE_API =
  /\b(?:from\s+['"]node:|require\s*\(|from\s+['"](?:fs|zlib|path|os|process|buffer|crypto|util|stream)['"]|process\.|Buffer\.)/;

for (const file of BROWSER_SAFE) {
  test(`${relative(ROOT, file)} does not use Node APIs`, (t) => {
    if (!existsSync(file)) {
      t.skip('file not written yet');
      return;
    }
    const source = readFileSync(file, 'utf8');
    const offending = source.split('\n').filter((line) => NODE_API.test(line));
    assert.deepEqual(offending, [], 'lines that reference Node APIs');
  });
}
