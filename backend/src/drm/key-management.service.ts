import { env } from '../config/env';
import { LocalKms } from './adapters/local-kms';

export interface KeyManagement {
  /** A fresh random DEK, plus the same DEK wrapped under the master key. Callers must zero `plaintext` after use. */
  generateDataKey(): Promise<{
    plaintext: Buffer;
    wrapped: Buffer;
    keyId: string;
    keyVersion: string;
  }>;
  unwrap(wrapped: Buffer, keyId: string, keyVersion: string): Promise<Buffer>;
}

let instance: KeyManagement | undefined;

export function keyManagement(): KeyManagement {
  if (!instance) {
    switch (env.KMS_PROVIDER) {
      case 'local':
        instance = new LocalKms(Buffer.from(env.DRM_LOCAL_KEK, 'base64'));
        break;
    }
  }
  return instance;
}
