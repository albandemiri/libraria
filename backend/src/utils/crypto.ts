import crypto from 'node:crypto';

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Encrypts arbitrary content (e.g. an EPUB file) with AES-256-GCM.
 * AES-GCM provides both confidentiality and tamper evidence.
 *
 * @param data Raw content buffer
 * @param key 256-bit (32 bytes) encryption key
 */
export function encryptAsset(data: Buffer, key: Buffer): EncryptedPayload {
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (256 bits)');
  }

  // 12 bytes (96 bits) is the NIST standard nonce/IV length for GCM
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext, iv, authTag };
}

/**
 * Decrypts an AES-256-GCM ciphertext payload and validates authenticity.
 * Throws if the payload has been tampered with or the key/authTag is wrong.
 */
/**
 * Decrypts an AES-256-GCM ciphertext payload and validates authenticity.
 * Throws if the payload has been tampered with or the key/authTag is wrong.
 */
export function decryptAsset(
  ciphertext: Buffer,
  key: Buffer,
  iv: Buffer,
  authTag: Buffer,
): Buffer {
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes (256 bits)');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Derives a deterministic 256-bit AES key for a specific book title from the master secret.
 * In production this maps to a KMS / Key Management Service.
 */
export function deriveBookKey(bookId: string, masterSecret: string): Buffer {
  return crypto.createHmac('sha256', masterSecret).update(`libraria_drm:${bookId}`).digest();
}
