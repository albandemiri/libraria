import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { canonicalJson } from './canonical-json';
import {
  InvalidDeviceKeyError,
  licenceSigningKeyId,
  licenceSigningPublicKeyPem,
  parseDevicePublicKey,
  signLicence,
  unwrapDekForDevice,
  verifyLicence,
  wrapDekForDevice,
} from './licence-crypto';

const ids = { licenceId: 'lic-1', assetId: 'asset-1', deviceId: 'dev-1' };

function deviceKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
  return { spki, privateKey };
}

describe('device key wrapping', () => {
  it('wraps a DEK for a device and unwraps it with the private key', () => {
    const { spki, privateKey } = deviceKeys();
    const dek = randomBytes(32);
    const wrapped = wrapDekForDevice(dek, spki, ids);
    assert.equal(wrapped.alg, 'ECDH-ES+HKDF-SHA256+A256GCM');
    assert.ok(unwrapDekForDevice(wrapped, privateKey, ids).equals(dek));
  });

  it('uses a fresh ephemeral key and IV per wrap', () => {
    const { spki } = deviceKeys();
    const a = wrapDekForDevice(randomBytes(32), spki, ids);
    const b = wrapDekForDevice(randomBytes(32), spki, ids);
    assert.notEqual(a.epk, b.epk);
    assert.notEqual(a.iv, b.iv);
  });

  it('fails with another device private key', () => {
    const { spki } = deviceKeys();
    const wrapped = wrapDekForDevice(randomBytes(32), spki, ids);
    assert.throws(() => unwrapDekForDevice(wrapped, deviceKeys().privateKey, ids));
  });

  it('fails when any id in the AAD changes', () => {
    const { spki, privateKey } = deviceKeys();
    const wrapped = wrapDekForDevice(randomBytes(32), spki, ids);
    assert.throws(() => unwrapDekForDevice(wrapped, privateKey, { ...ids, licenceId: 'x' }));
    assert.throws(() => unwrapDekForDevice(wrapped, privateKey, { ...ids, assetId: 'x' }));
    assert.throws(() => unwrapDekForDevice(wrapped, privateKey, { ...ids, deviceId: 'x' }));
  });
});

describe('parseDevicePublicKey', () => {
  it('accepts a P-256 SPKI key', () => {
    assert.equal(parseDevicePublicKey(deviceKeys().spki).asymmetricKeyType, 'ec');
  });

  it('rejects garbage, wrong types and curves, private keys and empty input', () => {
    const ed = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' });
    const p384 = generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey.export({
      type: 'spki',
      format: 'der',
    });
    const priv = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      type: 'pkcs8',
      format: 'der',
    });
    for (const bad of [
      'not a key !!!',
      'AAAA',
      ed.toString('base64url'),
      p384.toString('base64url'),
      priv.toString('base64url'),
      '',
    ]) {
      assert.throws(() => parseDevicePublicKey(bad), InvalidDeviceKeyError, bad);
    }
  });
});

describe('parseDevicePublicKey: crafted keys', () => {
  const prefix = '3059301306072a8648ce3d020106082a8648ce3d03010703420004';
  const offCurve = Buffer.from(prefix + '01'.repeat(64), 'hex').toString('base64url');
  const infinity = 'MBkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDAgAA';

  it('rejects an off-curve point', () => {
    assert.throws(() => parseDevicePublicKey(offCurve), InvalidDeviceKeyError);
  });

  it('rejects the point at infinity without aborting the process', () => {
    const code = `
      const { parseDevicePublicKey, InvalidDeviceKeyError } = require('./src/drm/licence-crypto.ts');
      try { parseDevicePublicKey('${infinity}'); process.exit(2); }
      catch (e) { process.exit(e instanceof InvalidDeviceKeyError ? 0 : 3); }`;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '-e', code], {
      cwd: process.cwd(),
    });
    assert.equal(result.status, 0, String(result.stderr));
  });

  it('rejects an infinity ephemeral key when unwrapping', () => {
    const { spki, privateKey } = deviceKeys();
    const wrapped = wrapDekForDevice(randomBytes(32), spki, ids);
    assert.throws(
      () => unwrapDekForDevice({ ...wrapped, epk: infinity }, privateKey, ids),
      InvalidDeviceKeyError,
    );
  });
});

describe('licence signing', () => {
  it('refuses a payload that already has a signature', () => {
    assert.throws(() => signLicence({ a: 1, signature: 'x' }));
  });

  const licence = { licenceId: 'lic-1', expiresAt: '2030-01-01T00:00:00.000Z', n: { b: 1, a: 2 } };

  it('signs and verifies, and detects a 1 ms change', () => {
    const signature = signLicence(licence);
    const pem = licenceSigningPublicKeyPem();
    assert.equal(verifyLicence({ ...licence, signature }, pem), true);
    const tampered = { ...licence, expiresAt: '2030-01-01T00:00:00.001Z', signature };
    assert.equal(verifyLicence(tampered, pem), false);
  });

  it('is independent of key order', () => {
    const signature = signLicence(licence);
    const reordered = { n: { a: 2, b: 1 }, expiresAt: licence.expiresAt, licenceId: 'lic-1' };
    assert.equal(verifyLicence({ ...reordered, signature }, licenceSigningPublicKeyPem()), true);
  });
});

describe('canonicalJson strictness', () => {
  it('throws on Date, NaN, Infinity, bigint, undefined and class instances', () => {
    assert.throws(() => canonicalJson({ a: new Date() }));
    assert.throws(() => canonicalJson({ a: Number.NaN }));
    assert.throws(() => canonicalJson([Number.POSITIVE_INFINITY]));
    assert.throws(() => canonicalJson({ a: 1n }));
    assert.throws(() => canonicalJson(undefined));
    assert.throws(() => canonicalJson(new Map()));
  });

  it('includes an own __proto__ member', () => {
    const withProto = JSON.parse('{"a":1,"__proto__":{"x":1}}');
    assert.equal(canonicalJson(withProto), '{"__proto__":{"x":1},"a":1}');
    assert.notEqual(canonicalJson(withProto), canonicalJson({ a: 1 }));
  });
});

describe('canonicalJson', () => {
  it('sorts keys recursively without whitespace', () => {
    assert.equal(
      canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } }),
      '{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}',
    );
  });
});

describe('licence signing key id', () => {
  it('is 16 hex chars of SHA-256 over the public key SPKI DER, and stable', () => {
    const kid = licenceSigningKeyId();
    assert.match(kid, /^[0-9a-f]{16}$/);
    assert.equal(licenceSigningKeyId(), kid);
    const der = createPublicKey(licenceSigningPublicKeyPem()).export({
      type: 'spki',
      format: 'der',
    });
    assert.equal(createHash('sha256').update(der).digest('hex').slice(0, 16), kid);
  });
});
