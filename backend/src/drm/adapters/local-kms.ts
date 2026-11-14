import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyManagement } from '../key-management.service';

const KEY_ID = 'local';
const KEY_VERSION = 'v1';
const AAD = Buffer.from('libraria-dek-v1', 'utf8');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const DEK_BYTES = 32;

/**
 * Development KMS: wraps DEKs with AES-256-GCM under a KEK from configuration.
 * Wrapped format: nonce(12) | tag(16) | ciphertext(32).
 */
export class LocalKms implements KeyManagement {
  private readonly kek: Buffer;

  constructor(kek: Buffer) {
    if (kek.length !== 32) throw new Error('Local KMS key must be 32 bytes');
    this.kek = Buffer.from(kek);
  }

  async generateDataKey() {
    const plaintext = randomBytes(DEK_BYTES);
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.kek, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrapped = Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    return { plaintext, wrapped, keyId: KEY_ID, keyVersion: KEY_VERSION };
  }

  async unwrap(wrapped: Buffer, keyId: string, keyVersion: string): Promise<Buffer> {
    if (keyId !== KEY_ID || keyVersion !== KEY_VERSION) {
      throw new Error(`Unknown KMS key ${keyId}/${keyVersion}`);
    }
    if (wrapped.length !== NONCE_BYTES + TAG_BYTES + DEK_BYTES) {
      throw new Error('Malformed wrapped key');
    }
    const nonce = wrapped.subarray(0, NONCE_BYTES);
    const tag = wrapped.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
    const ciphertext = wrapped.subarray(NONCE_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.kek, nonce, {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }
}
