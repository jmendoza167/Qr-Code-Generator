// Reading format information (ECC level + mask, BCH(15,5)) and version
// information (BCH(18,6)) from raw bit readings. The encoder's formatBits /
// versionBits produce the valid codewords; a reading is decoded to the
// nearest codeword within 3 bit errors. The test keeps its own brute-force
// nearest-codeword search as an independent oracle.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFormat, decodeVersion } from '../src/decode/format.js';
import { formatBits, versionBits } from '../src/core/format.js';
import { FormatUnreadableError, QrDecodeError } from '../src/decode/errors.js';

const LEVELS = ['L', 'M', 'Q', 'H'];

function popcount(n) {
  let c = 0;
  for (; n; n >>>= 1) c += n & 1;
  return c;
}

/** Flip the bits listed in `bits` (0 = least significant). */
function flip(value, bits) {
  for (const b of bits) value ^= 1 << b;
  return value;
}

/** Every valid format codeword with its meaning. */
const FORMAT_TABLE = [];
for (const ecc of LEVELS) for (let mask = 0; mask < 8; mask++) FORMAT_TABLE.push({ ecc, mask, bits: formatBits(ecc, mask) });

/** Independent oracle: the nearest codeword and its distance. */
function nearestFormat(reading) {
  let best = null;
  for (const entry of FORMAT_TABLE) {
    const distance = popcount(entry.bits ^ reading);
    if (!best || distance < best.distance) best = { ...entry, distance };
  }
  return best;
}

describe('decodeFormat', () => {
  test('the 32 valid codewords differ pairwise in at least 7 bits (so 3 errors are always correctable)', () => {
    for (const a of FORMAT_TABLE) {
      for (const b of FORMAT_TABLE) {
        if (a !== b) assert.ok(popcount(a.bits ^ b.bits) >= 7, `${a.ecc}${a.mask} vs ${b.ecc}${b.mask}`);
      }
    }
  });

  test('an exact reading gives its level and mask with 0 bit errors', () => {
    for (const { ecc, mask, bits } of FORMAT_TABLE) {
      assert.deepEqual(decodeFormat([bits]), { ecc, mask, bitErrors: 0 });
    }
  });

  test('1, 2 and 3 flipped bits anywhere are corrected and counted', () => {
    for (const { ecc, mask, bits } of FORMAT_TABLE) {
      for (let a = 0; a < 15; a++) {
        assert.deepEqual(decodeFormat([flip(bits, [a])]), { ecc, mask, bitErrors: 1 }, `${ecc}${mask} bit ${a}`);
        for (let b = a + 1; b < 15; b++) {
          assert.deepEqual(decodeFormat([flip(bits, [a, b])]), { ecc, mask, bitErrors: 2 }, `${ecc}${mask} bits ${a},${b}`);
          for (let c = b + 1; c < 15; c += 4) {
            assert.deepEqual(decodeFormat([flip(bits, [a, b, c])]), { ecc, mask, bitErrors: 3 }, `${ecc}${mask} bits ${a},${b},${c}`);
          }
        }
      }
    }
  });

  test('every possible 15-bit reading agrees with the brute-force oracle', () => {
    for (let reading = 0; reading < 1 << 15; reading++) {
      const oracle = nearestFormat(reading);
      if (oracle.distance <= 3) {
        assert.deepEqual(decodeFormat([reading]), { ecc: oracle.ecc, mask: oracle.mask, bitErrors: oracle.distance }, `reading ${reading}`);
      } else {
        assert.throws(() => decodeFormat([reading]), FormatUnreadableError, `reading ${reading}`);
      }
    }
  });

  test('with two readings the closer one wins; one destroyed copy does not hurt', () => {
    const { ecc, mask, bits } = FORMAT_TABLE[13];
    const other = FORMAT_TABLE[20];
    assert.deepEqual(decodeFormat([flip(bits, [0, 1]), bits]), { ecc, mask, bitErrors: 0 });
    assert.deepEqual(decodeFormat([bits, flip(bits, [3])]), { ecc, mask, bitErrors: 0 });
    assert.deepEqual(decodeFormat([0, bits]), { ecc, mask, bitErrors: 0 });
    assert.deepEqual(decodeFormat([0x7fff, flip(bits, [2, 9])]), { ecc, mask, bitErrors: 2 });
    // Two exact but different readings: the first is as good as the second; the result must be one of them.
    const result = decodeFormat([other.bits, bits]);
    assert.equal(result.bitErrors, 0);
    assert.ok((result.ecc === ecc && result.mask === mask) || (result.ecc === other.ecc && result.mask === other.mask));
  });

  test('unreadable readings raise FormatUnreadableError, a QrDecodeError', () => {
    const unreadable = [];
    for (let reading = 0; reading < 1 << 15 && unreadable.length < 3; reading += 977) {
      if (nearestFormat(reading).distance > 3) unreadable.push(reading);
    }
    assert.equal(unreadable.length, 3);
    assert.throws(
      () => decodeFormat(unreadable),
      (err) => {
        assert.ok(err instanceof FormatUnreadableError);
        assert.ok(err instanceof QrDecodeError);
        assert.equal(err.name, 'FormatUnreadableError');
        assert.match(err.message, /format information/i);
        return true;
      },
    );
    assert.throws(() => decodeFormat([]), FormatUnreadableError);
  });
});

/** Every valid version codeword. */
const VERSION_TABLE = [];
for (let version = 7; version <= 40; version++) VERSION_TABLE.push({ version, bits: versionBits(version) });

function nearestVersion(reading) {
  let best = null;
  for (const entry of VERSION_TABLE) {
    const distance = popcount(entry.bits ^ reading);
    if (!best || distance < best.distance) best = { ...entry, distance };
  }
  return best;
}

describe('decodeVersion', () => {
  test('the 34 valid codewords differ pairwise in at least 8 bits', () => {
    for (const a of VERSION_TABLE) {
      for (const b of VERSION_TABLE) {
        if (a !== b) assert.ok(popcount(a.bits ^ b.bits) >= 8, `${a.version} vs ${b.version}`);
      }
    }
  });

  test('exact and up-to-3-bit-damaged readings decode to the version', () => {
    for (const { version, bits } of VERSION_TABLE) {
      assert.deepEqual(decodeVersion([bits]), { version, bitErrors: 0 });
      for (let a = 0; a < 18; a++) {
        assert.deepEqual(decodeVersion([flip(bits, [a])]), { version, bitErrors: 1 }, `v${version} bit ${a}`);
        for (let b = a + 1; b < 18; b += 3) {
          assert.deepEqual(decodeVersion([flip(bits, [a, b])]), { version, bitErrors: 2 }, `v${version} bits ${a},${b}`);
          for (let c = b + 1; c < 18; c += 5) {
            assert.deepEqual(decodeVersion([flip(bits, [a, b, c])]), { version, bitErrors: 3 }, `v${version} bits ${a},${b},${c}`);
          }
        }
      }
    }
  });

  test('a sample of all 18-bit readings agrees with the brute-force oracle', () => {
    for (let reading = 0; reading < 1 << 18; reading += 7) {
      const oracle = nearestVersion(reading);
      if (oracle.distance <= 3) {
        assert.deepEqual(decodeVersion([reading]), { version: oracle.version, bitErrors: oracle.distance }, `reading ${reading}`);
      } else {
        assert.throws(() => decodeVersion([reading]), FormatUnreadableError, `reading ${reading}`);
      }
    }
  });

  test('the closer of two readings wins', () => {
    const { version, bits } = VERSION_TABLE[10];
    assert.deepEqual(decodeVersion([0, bits]), { version, bitErrors: 0 });
    assert.deepEqual(decodeVersion([flip(bits, [1, 2, 3]), flip(bits, [5])]), { version, bitErrors: 1 });
  });

  test('unreadable version information raises FormatUnreadableError naming the version information', () => {
    assert.throws(
      () => decodeVersion([0, 0x3ffff]),
      (err) => {
        assert.ok(err instanceof FormatUnreadableError);
        assert.match(err.message, /version information/i);
        return true;
      },
    );
    assert.throws(() => decodeVersion([]), FormatUnreadableError);
  });
});
