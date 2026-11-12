import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import pngjs from 'pngjs';
import { encode } from '../src/core/qr.js';
import { planLogo } from '../src/render/logo.js';
import { renderPng } from '../src/render/png.js';
import { renderSvg } from '../src/render/svg.js';
import { decodePng } from '../src/render/png-decode.js';
import { encodeBase64 } from '../src/render/base64.js';
import { buildWifiPayload } from '../src/presets/wifi.js';
import { buildVCard } from '../src/presets/vcard.js';
import { decodeRgba } from './helpers/decode.js';
import { makeLogoImage, encodeWithPngjs } from './helpers/fixtures.js';

const { PNG } = pngjs;

const logoPngBuffer = encodeWithPngjs(makeLogoImage(64, 64), { colorType: 6 });
const logoImage = decodePng(logoPngBuffer);

/** encode -> plan logo -> render PNG -> decode with pngjs -> jsQR. */
function roundTrip(text, { sizePercent = 20, ecc = 'H', scale = 5, ...style } = {}) {
  const qr = encode(text, { ecc });
  const plan = planLogo(qr.matrix, { sizePercent, aspect: logoImage.width / logoImage.height });
  const buf = renderPng(plan.matrix, { scale, logo: { image: logoImage, box: plan.box, area: plan.area }, ...style });
  const png = PNG.sync.read(buf);
  return { qr, plan, png, decoded: decodeRgba(png.data, png.width, png.height) };
}

describe('base64', () => {
  test('matches Buffer.toString("base64") including padding cases', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      assert.equal(encodeBase64(Buffer.from(s)), Buffer.from(s).toString('base64'));
    }
    assert.equal(encodeBase64(logoPngBuffer), logoPngBuffer.toString('base64'));
  });
});

describe('PNG output with a logo', () => {
  test('decodes with jsQR at 10%, 20% and 30% logo sizes', () => {
    const text = 'https://example.com/logo-test';
    for (const sizePercent of [10, 20, 30]) {
      const { decoded, plan } = roundTrip(text, { sizePercent });
      assert.ok(decoded, `jsQR returned null at ${sizePercent}% (effective ${plan.sizePercent}%)`);
      assert.equal(decoded.data, text);
    }
  });

  test('decodes across several versions and together with styles', () => {
    const cases = [
      ['short', {}],
      ['medium length text for a version around six or seven', {}],
      ['x'.repeat(300), { shape: 'rounded', finder: 'circle' }],
      ['dots and a logo '.repeat(10), { shape: 'dots', gradient: '#1a237e,#004d40', gradientDir: 'radial', scale: 6 }],
    ];
    for (const [text, options] of cases) {
      const { decoded, qr } = roundTrip(text, options);
      assert.ok(decoded, `jsQR returned null for version ${qr.version} ${JSON.stringify(options)}`);
      assert.equal(decoded.data, text);
    }
  });

  test('Wi-Fi and vCard payloads with a logo', () => {
    for (const payload of [
      buildWifiPayload({ ssid: 'Home', password: 'secret' }),
      buildVCard({ name: 'Javier Mendoza', phones: ['+34600000000'] }),
    ]) {
      const { decoded } = roundTrip(payload);
      assert.ok(decoded, 'jsQR returned null');
      assert.equal(decoded.data, payload);
    }
  });

  test('the logo is drawn centred, scaled, alpha-blended over the cleared background', () => {
    const { png, plan } = roundTrip('logo pixels', { scale: 8, sizePercent: 30 });
    const scale = 8;
    const margin = 4;
    const px = (mx, my) => {
      const i = (Math.floor((my + margin) * scale) * png.width + Math.floor((mx + margin) * scale)) * 4;
      return [...png.data.subarray(i, i + 4)];
    };
    const centre = px(plan.box.x + plan.box.w / 2, plan.box.y + plan.box.h / 2);
    assert.ok(centre[0] < 60 && centre[1] < 60, `centre stripe is dark, got ${centre}`); // the diagonal stripe
    const red = px(plan.box.x + plan.box.w * 0.3, plan.box.y + plan.box.h * 0.6);
    assert.ok(red[0] > 180 && red[1] < 80, `logo body is red, got ${red}`);
    const corner = px(plan.box.x + 0.05, plan.box.y + 0.05); // transparent corner of the logo image
    assert.deepEqual(corner, [255, 255, 255, 255]);
    const padding = px(plan.area.col + 0.5, plan.area.row + 0.5);
    assert.deepEqual(padding, [255, 255, 255, 255]);
  });

  test('logo background colour fills the cleared area', () => {
    const qr = encode('logo bg', { ecc: 'H' });
    const plan = planLogo(qr.matrix, { sizePercent: 20 });
    const buf = renderPng(plan.matrix, { scale: 4, logo: { image: logoImage, box: plan.box, area: plan.area, bg: '#ffff00' } });
    const png = PNG.sync.read(buf);
    const i = (Math.floor((plan.area.row + 4 + 0.5) * 4) * png.width + Math.floor((plan.area.col + 4 + 0.5) * 4)) * 4;
    assert.deepEqual([...png.data.subarray(i, i + 4)], [255, 255, 0, 255]);
    assert.equal(decodeRgba(png.data, png.width, png.height).data, 'logo bg');
  });

  test('a logo forces the RGBA encoding', () => {
    const qr = encode('rgba', { ecc: 'H' });
    const plan = planLogo(qr.matrix, {});
    const buf = renderPng(plan.matrix, { logo: { image: logoImage, box: plan.box, area: plan.area } });
    assert.equal(buf[25], 6);
  });

  test('an upscaled tiny logo (bilinear) and a downscaled large logo both work', () => {
    const qr = encode('scaling', { ecc: 'H' });
    const plan = planLogo(qr.matrix, {});
    for (const size of [4, 400]) {
      const img = decodePng(encodeWithPngjs(makeLogoImage(size, size), { colorType: 6 }));
      const buf = renderPng(plan.matrix, { scale: 6, logo: { image: img, box: plan.box, area: plan.area } });
      const png = PNG.sync.read(buf);
      assert.equal(decodeRgba(png.data, png.width, png.height).data, 'scaling');
    }
  });
});

describe('SVG output with a logo', () => {
  const qr = encode('svg logo', { ecc: 'H' });
  const plan = planLogo(qr.matrix, { sizePercent: 20 });

  test('PNG logo becomes a base64 data URI <image> at the box, after the modules', () => {
    const svg = renderSvg(plan.matrix, { logo: { png: logoPngBuffer, box: plan.box, area: plan.area } });
    const expectedHref = `data:image/png;base64,${logoPngBuffer.toString('base64')}`;
    assert.ok(svg.includes(`<image href="${expectedHref}"`));
    assert.match(svg, new RegExp(`<image [^>]*x="${plan.box.x + 4}" y="${plan.box.y + 4}" width="${plan.box.w}" height="${plan.box.h}"`));
    assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);
    assert.ok(svg.lastIndexOf('<path') < svg.indexOf('<image'));
  });

  // Was 'SVG logo is sanitized and inlined': the logo is still sanitized but
  // is now embedded as a data URI <image>, the same way as a PNG logo.
  test('SVG logo is sanitized and embedded as a base64 data URI <image>, never inlined', () => {
    const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="x()"><script>x()</script><circle cx="5" cy="5" r="5" fill="#00f"/></svg>';
    const svg = renderSvg(plan.matrix, { logo: { svg: logo, box: plan.box, area: plan.area } });
    const m = new RegExp(
      `<image href="data:image/svg\\+xml;base64,([A-Za-z0-9+/]+={0,2})" x="${plan.box.x + 4}" y="${plan.box.y + 4}" ` +
        `width="${plan.box.w}" height="${plan.box.h}" preserveAspectRatio="xMidYMid meet"/>`,
    ).exec(svg);
    assert.ok(m, 'the logo is an <image> with a base64 SVG data URI at the box');
    assert.equal(svg.match(/<svg\b/g).length, 1, 'no nested <svg> in the output');
    assert.doesNotMatch(svg, /<script|onload|<circle/);
    assert.ok(svg.lastIndexOf('<path') < svg.indexOf('<image'));
    const embedded = Buffer.from(m[1], 'base64').toString('utf8');
    assert.match(embedded, /^<svg xmlns="[^"]+" xmlns:xlink="[^"]+" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" fill="#00f"\/><\/svg>$/);
  });

  test('logo background rect covers the cleared area when requested', () => {
    const svg = renderSvg(plan.matrix, { logo: { png: logoPngBuffer, box: plan.box, area: plan.area, bg: '#ffff00' } });
    assert.match(
      svg,
      new RegExp(`<rect x="${plan.area.col + 4}" y="${plan.area.row + 4}" width="${plan.area.cols}" height="${plan.area.rows}" fill="#ffff00"/>`),
    );
  });

  test('the cleared modules are really absent from the path', () => {
    const svg = renderSvg(plan.matrix, { logo: { png: logoPngBuffer, box: plan.box, area: plan.area } });
    const centreCommand = new RegExp(`M${Math.floor(qr.size / 2) + 4} ${Math.floor(qr.size / 2) + 4}h`);
    assert.doesNotMatch(svg, centreCommand);
  });

  test('a logo needs either png bytes or svg markup', () => {
    assert.throws(() => renderSvg(plan.matrix, { logo: { box: plan.box, area: plan.area } }), /logo/);
  });
});
