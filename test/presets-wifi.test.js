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

describe('buildWifiPayload: field injection through control characters', () => {
  const CONTROLS = ['\r', '\n', '\r\n', '\t', '\0', '\x1b', '\x7f', '\x85', '\x9b', '\u2028', '\u2029', '\v', '\f', '\b'];

  test('CR, LF and every other control character in the SSID are rejected', () => {
    for (const ch of CONTROLS) {
      for (const ssid of [`Home${ch}`, `${ch}Home`, `Ho${ch}me`]) {
        assert.throws(() => buildWifiPayload({ ssid, password: 'secret' }), (err) => err instanceof RangeError && /ssid.*control character/i.test(err.message), JSON.stringify(ssid));
        assert.throws(() => buildWifiPayload({ ssid, security: 'nopass' }), /control character/, JSON.stringify(ssid));
      }
    }
  });

  test('CR, LF and every other control character in the password are rejected', () => {
    for (const ch of CONTROLS) {
      for (const password of [`secret${ch}`, `${ch}secret`, `sec${ch}ret`]) {
        for (const security of ['WPA', 'WEP']) {
          assert.throws(
            () => buildWifiPayload({ ssid: 'Home', password, security }),
            (err) => err instanceof RangeError && /password.*control character/i.test(err.message),
            JSON.stringify(password),
          );
        }
      }
    }
  });

  test('an injected second network or field never reaches the payload', () => {
    const attacks = [
      { ssid: 'Guest;;\nWIFI:T:nopass;S:EvilTwin;;', password: 'secret' },
      { ssid: 'Guest\r\nWIFI:T:WPA;S:EvilTwin;P:attacker;;', password: 'secret' },
      { ssid: 'Home', password: 'secret;;\nhttps://evil.example/' },
      { ssid: 'Home', password: 'secret\r\nH:true' },
      { ssid: 'Home\x1b[2J', password: 'secret' },
    ];
    for (const fields of attacks) {
      assert.throws(() => buildWifiPayload(fields), /control character/, JSON.stringify(fields));
    }
  });

  test('the error names the field and the code point but does not echo the value', () => {
    assert.throws(
      () => buildWifiPayload({ ssid: 'Home', password: 'hunter2\nextra' }),
      (err) => /password/.test(err.message) && /U\+000A at position 8/.test(err.message) && !/hunter2|extra|\n/.test(err.message),
    );
    assert.throws(() => buildWifiPayload({ ssid: 'a\x1b[31mb', security: 'nopass' }), (err) => /U\+001B at position 2/.test(err.message) && !err.message.includes('\x1b'));
  });

  test('printable input, including the format characters and non-ASCII text, still works', () => {
    assert.equal(
      buildWifiPayload({ ssid: 'Café ; , : " \\ 日本語 🎉', password: 'p@ss word;:,"\\' }),
      'WIFI:T:WPA;S:Café \\; \\, \\: \\" \\\\ 日本語 🎉;P:p@ss word\\;\\:\\,\\"\\\\;;',
    );
  });
});
