import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export class DecryptionError extends Error {
  constructor() {
    super('Asset decryption failed');
    this.name = 'DecryptionError';
  }
}

/** AAD binds the ciphertext to its asset, version and the key that wrapped the DEK. */
export function assetAad(a: { assetId: string; version: number; kmsKeyId: string }): Buffer {
  return Buffer.from(`${a.assetId}|${a.version}|AES-256-GCM|${a.kmsKeyId}`, 'utf8');
}

/** A fresh random 96-bit nonce per call: never reuse a nonce under one DEK. */
export function encryptAsset(
  plaintext: Buffer,
  dek: Buffer,
  aad: Buffer,
): { ciphertext: Buffer; nonce: Buffer; authTag: Buffer } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

export function decryptAsset(
  ciphertext: Buffer,
  dek: Buffer,
  nonce: Buffer,
  authTag: Buffer,
  aad: Buffer,
): Buffer {
  try {
    if (authTag.length !== TAG_BYTES) throw new Error('bad tag length');
    const decipher = createDecipheriv(ALGORITHM, dek, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}
