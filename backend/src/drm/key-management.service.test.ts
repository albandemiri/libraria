import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { env, parseEnv } from '../config/env';
import { LocalKms } from './adapters/local-kms';
import { keyManagement } from './key-management.service';

const kek = randomBytes(32);

describe('local KMS', () => {
  it('generates a data key and unwraps it to the same plaintext', async () => {
    const kms = new LocalKms(kek);
    const dk = await kms.generateDataKey();
    assert.equal(dk.plaintext.length, 32);
    assert.equal(dk.wrapped.length, 12 + 16 + 32);
    assert.equal(dk.keyId, 'local');
    assert.equal(dk.keyVersion, 'v1');
    const unwrapped = await kms.unwrap(dk.wrapped, dk.keyId, dk.keyVersion);
    assert.ok(unwrapped.equals(dk.plaintext));
  });

  it('fails to unwrap under a different KEK', async () => {
    const dk = await new LocalKms(kek).generateDataKey();
    await assert.rejects(new LocalKms(randomBytes(32)).unwrap(dk.wrapped, 'local', 'v1'));
  });

  it('fails to unwrap a tampered blob or unknown key id', async () => {
    const kms = new LocalKms(kek);
    const dk = await kms.generateDataKey();
    const bad = Buffer.from(dk.wrapped);
    bad[bad.length - 1] = (bad[bad.length - 1] ?? 0) ^ 1;
    await assert.rejects(kms.unwrap(bad, 'local', 'v1'));
    await assert.rejects(kms.unwrap(dk.wrapped, 'other', 'v1'));
  });

  it('gives different DEKs and wrapped blobs on each call', async () => {
    const kms = new LocalKms(kek);
    const a = await kms.generateDataKey();
    const b = await kms.generateDataKey();
    assert.ok(!a.plaintext.equals(b.plaintext));
    assert.ok(!a.wrapped.equals(b.wrapped));
  });

  it('derives nothing from JWT_SECRET: the KEK is identical whatever the secret', () => {
    const base = { NODE_ENV: 'test' };
    const one = parseEnv({ ...base, JWT_SECRET: 'first-secret-value-0123456789abcdef' });
    const two = parseEnv({ ...base, JWT_SECRET: 'a-completely-different-secret-value-1234567890' });
    assert.notEqual(one.JWT_SECRET, two.JWT_SECRET);
    assert.ok(
      Buffer.from(one.DRM_LOCAL_KEK, 'base64').equals(Buffer.from(two.DRM_LOCAL_KEK, 'base64')),
    );
    const explicit = randomBytes(32).toString('base64');
    const third = parseEnv({ ...base, JWT_SECRET: 'x'.repeat(40), DRM_LOCAL_KEK: explicit });
    assert.equal(third.DRM_LOCAL_KEK, explicit);
  });

  it('keyManagement() builds the local KMS only from DRM_LOCAL_KEK', async () => {
    const source = readFileSync(path.join(__dirname, 'key-management.service.ts'), 'utf8');
    assert.ok(!source.includes('JWT_SECRET'));
    assert.ok(source.includes("new LocalKms(Buffer.from(env.DRM_LOCAL_KEK, 'base64'))"));
    // Behaviourally: a data key from the service unwraps under a LocalKms built from the same KEK only.
    const dk = await keyManagement().generateDataKey();
    const sameKek = new LocalKms(Buffer.from(env.DRM_LOCAL_KEK, 'base64'));
    assert.ok((await sameKek.unwrap(dk.wrapped, dk.keyId, dk.keyVersion)).equals(dk.plaintext));
    await assert.rejects(new LocalKms(randomBytes(32)).unwrap(dk.wrapped, dk.keyId, dk.keyVersion));
  });

  it('keyManagement() returns a cached instance', () => {
    assert.equal(keyManagement(), keyManagement());
  });
});
