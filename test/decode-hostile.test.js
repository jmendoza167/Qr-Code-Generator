// Hostile images for the decoder: random noise, a field of finder-like
// squares, destroyed format information, and maximum-size images. Each one
// must fail (or succeed) with a typed error, within a time budget, and
// without the process ballooning. Everything runs in a fresh Node process
// so peak memory can be measured; the images are built inside that process
// from a small spec, so 64 MB RGBA buffers never cross a pipe.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const url = (relative) => pathToFileURL(fileURLToPath(new URL(relative, import.meta.url))).href;
const MB = 1024 * 1024;

const SCRIPT = `
  const { decodeQr } = await import(${JSON.stringify(url('../src/decode/decode.js'))});
  const { encode } = await import(${JSON.stringify(url('../src/core/qr.js'))});
  const { formatInfoPositions } = await import(${JSON.stringify(url('../src/core/matrix.js'))});
  const { renderRgba, pasteRgba, blitRgba, solidRgba, noiseRgba } = await import(${JSON.stringify(url('./helpers/image.js'))});
  const { rasterize } = await import(${JSON.stringify(url('./helpers/decode.js'))});

  function build(spec) {
    switch (spec.kind) {
      case 'solid': return solidRgba(spec.size, spec.size, spec.shade === 'black' ? [0, 0, 0] : [255, 255, 255]);
      case 'noise': return noiseRgba(spec.size, spec.size, spec.seed);
      case 'qr-in-canvas': {
        const qr = encode(spec.text, { ecc: 'M' });
        const small = renderRgba(qr.matrix, { scale: spec.scale, margin: 4 });
        return pasteRgba(solidRgba(spec.size, spec.size, [255, 255, 255]), small, spec.x, spec.y);
      }
      case 'finder-field': {
        const finder = encode('x').matrix.slice(0, 7).map((row) => row.slice(0, 7));
        const tile = rasterize(finder, { scale: spec.scale, margin: 0 });
        const cell = 10 * spec.scale;
        const cols = Math.floor(spec.size / cell);
        const image = solidRgba(spec.size, spec.size, [255, 255, 255]);
        const tileImage = { width: tile.width, height: tile.height, data: tile.data };
        for (let ty = 0; ty < cols; ty++) for (let tx = 0; tx < cols; tx++) blitRgba(image, tileImage, tx * cell + spec.scale, ty * cell + spec.scale);
        return image;
      }
      case 'bad-format': {
        const qr = encode(spec.text, { ecc: 'M' });
        const matrix = qr.matrix.map((row) => row.slice());
        formatInfoPositions(qr.size).forEach(([a, b], i) => {
          if (i % 2 === 0) { matrix[a[0]][a[1]] = !matrix[a[0]][a[1]]; matrix[b[0]][b[1]] = !matrix[b[0]][b[1]]; }
        });
        return renderRgba(matrix, { scale: spec.scale });
      }
      default: throw new Error('unknown spec ' + spec.kind);
    }
  }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const specs = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const outcomes = {};
  for (const [label, spec] of Object.entries(specs)) {
    const image = build(spec);
    const started = performance.now();
    try {
      const result = decodeQr(image);
      outcomes[label] = { ok: true, text: result.text };
    } catch (err) {
      outcomes[label] = { ok: false, name: err.name, message: err.message };
    }
    outcomes[label].ms = performance.now() - started;
  }
  console.log(JSON.stringify({ outcomes, peakMB: process.resourceUsage().maxRSS / 1024 }));
`;

function runInChild(specs) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', SCRIPT], {
    input: JSON.stringify(specs),
    encoding: 'utf8',
    maxBuffer: 16 * MB,
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

describe('decodeQr: hostile and maximum-size images', () => {
  let baselineMB;
  let small;
  let large;

  before(() => {
    baselineMB = runInChild({ warm: { kind: 'qr-in-canvas', text: 'baseline', scale: 4, size: 200, x: 10, y: 10 } }).peakMB;
    small = runInChild({
      'noise 256': { kind: 'noise', size: 256, seed: 1 },
      'noise 1024': { kind: 'noise', size: 1024, seed: 2 },
      'finder field 2048': { kind: 'finder-field', size: 2048, scale: 3 },
      'bad format': { kind: 'bad-format', text: 'format area destroyed', scale: 4 },
      '1x1': { kind: 'solid', size: 1, shade: 'black' },
      'white 512': { kind: 'solid', size: 512, shade: 'white' },
    });
    large = runInChild({
      'white 4096': { kind: 'solid', size: 4096, shade: 'white' },
      'black 4096': { kind: 'solid', size: 4096, shade: 'black' },
      'noise 4096': { kind: 'noise', size: 4096, seed: 3 },
      'qr in 4096': { kind: 'qr-in-canvas', text: 'needle in a 16 megapixel haystack', scale: 4, size: 4096, x: 3000, y: 2900 },
    });
  });

  test('noise, a field of finder-like squares, blank and tiny images raise NoQrFoundError', () => {
    for (const label of ['noise 256', 'noise 1024', 'finder field 2048', '1x1', 'white 512']) {
      assert.equal(small.outcomes[label].ok, false, label);
      assert.equal(small.outcomes[label].name, 'NoQrFoundError', `${label}: ${small.outcomes[label].message}`);
    }
  });

  test('destroyed format information raises FormatUnreadableError', () => {
    assert.equal(small.outcomes['bad format'].name, 'FormatUnreadableError', small.outcomes['bad format'].message);
  });

  test('maximum-size images: blank and noise are refused, a real symbol inside one is still found', () => {
    for (const label of ['white 4096', 'black 4096', 'noise 4096']) {
      assert.equal(large.outcomes[label].ok, false, label);
      assert.equal(large.outcomes[label].name, 'NoQrFoundError', `${label}: ${large.outcomes[label].message}`);
    }
    assert.equal(large.outcomes['qr in 4096'].ok, true, large.outcomes['qr in 4096'].message);
    assert.equal(large.outcomes['qr in 4096'].text, 'needle in a 16 megapixel haystack');
  });

  test('every case finishes within its time budget', () => {
    for (const [label, outcome] of Object.entries(small.outcomes)) {
      assert.ok(outcome.ms < 3000, `${label} took ${outcome.ms.toFixed(0)} ms`);
    }
    for (const [label, outcome] of Object.entries(large.outcomes)) {
      assert.ok(outcome.ms < 15000, `${label} took ${outcome.ms.toFixed(0)} ms`);
    }
  });

  test('peak memory stays bounded (a 16 megapixel RGBA image is 64 MB on its own)', () => {
    assert.ok(small.peakMB < baselineMB + 200, `small cases peaked at ${small.peakMB.toFixed(0)} MB (baseline ${baselineMB.toFixed(0)} MB)`);
    assert.ok(large.peakMB < baselineMB + 600, `large cases peaked at ${large.peakMB.toFixed(0)} MB (baseline ${baselineMB.toFixed(0)} MB)`);
  });
});
