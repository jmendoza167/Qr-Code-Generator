import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWifiPayload, escapeWifiValue, normalizeWifiSecurity } from '../src/presets/wifi.js';

describe('escapeWifiValue', () => {
  test('escapes backslash, semicolon, comma, colon and double quote', () => {
    assert.equal(escapeWifiValue('a\\b;c,d:e"f'), 'a\\\\b\\;c\\,d\\:e\\"f');
  });

  test('leaves everything else alone, including spaces and UTF-8', () => {
    assert.equal(escapeWifiValue('Café Wi-Fi 2.4 GHz ñ'), 'Café Wi-Fi 2.4 GHz ñ');
  });
});

describe('normalizeWifiSecurity', () => {
  test('accepts the three types in any case, plus common aliases', () => {
    assert.equal(normalizeWifiSecurity('WPA'), 'WPA');
    assert.equal(normalizeWifiSecurity('wpa2'), 'WPA');
    assert.equal(normalizeWifiSecurity('WPA3'), 'WPA');
    assert.equal(normalizeWifiSecurity('wep'), 'WEP');
    assert.equal(normalizeWifiSecurity('nopass'), 'nopass');
    assert.equal(normalizeWifiSecurity('NONE'), 'nopass');
    assert.equal(normalizeWifiSecurity(undefined), 'WPA');
  });

  test('rejects unknown types', () => {
    assert.throws(() => normalizeWifiSecurity('WPS'), /security/);
  });
});

describe('buildWifiPayload', () => {
  test('WPA network with password (the default security)', () => {
    assert.equal(buildWifiPayload({ ssid: 'Home', password: 'secret' }), 'WIFI:T:WPA;S:Home;P:secret;;');
  });

  test('WEP network', () => {
    assert.equal(buildWifiPayload({ ssid: 'Home', password: 'abc', security: 'WEP' }), 'WIFI:T:WEP;S:Home;P:abc;;');
  });

  test('open network has no P field', () => {
    assert.equal(buildWifiPayload({ ssid: 'Cafe', security: 'nopass' }), 'WIFI:T:nopass;S:Cafe;;');
  });

  test('hidden network adds H:true', () => {
    assert.equal(
      buildWifiPayload({ ssid: 'Home', password: 'secret', hidden: true }),
      'WIFI:T:WPA;S:Home;P:secret;H:true;;',
    );
  });

  test('special characters in SSID and password are escaped', () => {
    assert.equal(
      buildWifiPayload({ ssid: 'My;Net:1', password: 'p,a"s\\s' }),
      'WIFI:T:WPA;S:My\\;Net\\:1;P:p\\,a\\"s\\\\s;;',
    );
  });

  test('validation: ssid required, password rules per security type', () => {
    assert.throws(() => buildWifiPayload({ password: 'x' }), /ssid/i);
    assert.throws(() => buildWifiPayload({ ssid: '', password: 'x' }), /ssid/i);
    assert.throws(() => buildWifiPayload({ ssid: 'Home' }), /password/i);
    assert.throws(() => buildWifiPayload({ ssid: 'Home', password: '' }), /password/i);
    assert.throws(() => buildWifiPayload({ ssid: 'Open', security: 'nopass', password: 'x' }), /nopass/);
  });
});
