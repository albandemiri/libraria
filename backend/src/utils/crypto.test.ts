import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { decryptAsset, encryptAsset } from './crypto';

describe('DRM Crypto (AES-256-GCM)', () => {
  const secretKey = crypto.randomBytes(32);
  const sampleEpubContent = Buffer.from('PK\x03\x04Sample EPUB content for Libraria');

  it('encrypts and successfully decrypts content with valid key and authTag', () => {
    const { ciphertext, iv, authTag } = encryptAsset(sampleEpubContent, secretKey);

    assert.notDeepEqual(ciphertext, sampleEpubContent);
    assert.equal(iv.length, 12);
    assert.equal(authTag.length, 16);

    const decrypted = decryptAsset(ciphertext, secretKey, iv, authTag);
    assert.deepEqual(decrypted, sampleEpubContent);
  });

  it('fails decryption if ciphertext is tampered with', () => {
    const { ciphertext, iv, authTag } = encryptAsset(sampleEpubContent, secretKey);

    // Tamper with one byte
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 0xff;

    assert.throws(() => {
      decryptAsset(tampered, secretKey, iv, authTag);
    });
  });

  it('fails decryption if authTag is invalid', () => {
    const { ciphertext, iv } = encryptAsset(sampleEpubContent, secretKey);
    const bogusAuthTag = crypto.randomBytes(16);

    assert.throws(() => {
      decryptAsset(ciphertext, secretKey, iv, bogusAuthTag);
    });
  });
});
