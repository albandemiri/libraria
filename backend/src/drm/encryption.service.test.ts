import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { assetAad, DecryptionError, decryptAsset, encryptAsset } from './encryption.service';

const aad = assetAad({ assetId: 'asset-1', version: 1, kmsKeyId: 'local' });

function flip(buf: Buffer): Buffer {
  const copy = Buffer.from(buf);
  copy[0] = (copy[0] ?? 0) ^ 1;
  return copy;
}

describe('encryption.service', () => {
  it('round-trips 1 MB of random bytes', () => {
    const dek = randomBytes(32);
    const plaintext = randomBytes(1024 * 1024);
    const { ciphertext, nonce, authTag } = encryptAsset(plaintext, dek, aad);
    assert.equal(nonce.length, 12);
    assert.equal(authTag.length, 16);
    assert.ok(!ciphertext.equals(plaintext));
    assert.ok(decryptAsset(ciphertext, dek, nonce, authTag, aad).equals(plaintext));
  });

  it('rejects a flipped bit in ciphertext, nonce, tag or AAD', () => {
    const dek = randomBytes(32);
    const { ciphertext, nonce, authTag } = encryptAsset(randomBytes(256), dek, aad);
    assert.throws(() => decryptAsset(flip(ciphertext), dek, nonce, authTag, aad), DecryptionError);
    assert.throws(() => decryptAsset(ciphertext, dek, flip(nonce), authTag, aad), DecryptionError);
    assert.throws(() => decryptAsset(ciphertext, dek, nonce, flip(authTag), aad), DecryptionError);
    assert.throws(() => decryptAsset(ciphertext, dek, nonce, authTag, flip(aad)), DecryptionError);
  });

  it('rejects a wrong key', () => {
    const { ciphertext, nonce, authTag } = encryptAsset(randomBytes(16), randomBytes(32), aad);
    assert.throws(
      () => decryptAsset(ciphertext, randomBytes(32), nonce, authTag, aad),
      DecryptionError,
    );
  });

  it('generates a distinct nonce for each of 10,000 encryptions', () => {
    const dek = randomBytes(32);
    const nonces = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      nonces.add(encryptAsset(Buffer.from('x'), dek, aad).nonce.toString('hex'));
    }
    assert.equal(nonces.size, 10_000);
  });

  it('builds the AAD as assetId|version|AES-256-GCM|kmsKeyId', () => {
    assert.ok(
      assetAad({ assetId: 'a', version: 2, kmsKeyId: 'local' }).equals(
        Buffer.from('a|2|AES-256-GCM|local'),
      ),
    );
  });
});
