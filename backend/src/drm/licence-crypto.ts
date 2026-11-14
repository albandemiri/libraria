import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createHash,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type KeyObject,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { env } from '../config/env';
import { canonicalJson } from './canonical-json';

export const WRAP_ALG = 'ECDH-ES+HKDF-SHA256+A256GCM';
const HKDF_INFO = Buffer.from('libraria-licence-v1', 'utf8');

export class InvalidDeviceKeyError extends Error {
  constructor() {
    super('Device public key must be a base64url P-256 SPKI public key');
    this.name = 'InvalidDeviceKeyError';
  }
}

export interface WrappedKey {
  alg: string;
  /** Ephemeral P-256 public key, SPKI DER, base64url. */
  epk: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

interface LicenceIds {
  licenceId: string;
  assetId: string;
  deviceId: string;
}

/** Fixed SPKI DER prefix of an uncompressed P-256 public key (0x04 point follows). */
const P256_SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d03010703420004',
  'hex',
);
const P256_SPKI_LENGTH = P256_SPKI_PREFIX.length + 64;

/**
 * Parses a base64url P-256 SPKI public key. The bytes are checked against the
 * fixed uncompressed-P-256 layout BEFORE OpenSSL sees them: a crafted key (for
 * example the point at infinity) can trip a native assertion in Node that
 * aborts the whole process, so key details are never read from unvalidated input.
 */
export function parseDevicePublicKey(spkiB64u: string): KeyObject {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(spkiB64u)) throw new Error('not base64url');
    const der = Buffer.from(spkiB64u, 'base64url');
    if (
      der.length !== P256_SPKI_LENGTH ||
      !der.subarray(0, P256_SPKI_PREFIX.length).equals(P256_SPKI_PREFIX)
    ) {
      throw new Error('not an uncompressed P-256 SPKI key');
    }
    // Throws if the point is not on the curve.
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    throw new InvalidDeviceKeyError();
  }
}

function deriveWrapKey(sharedSecret: Buffer, licenceId: string): Buffer {
  return Buffer.from(
    hkdfSync('sha256', sharedSecret, Buffer.from(licenceId, 'utf8'), HKDF_INFO, 32),
  );
}

function wrapAad(ids: LicenceIds): Buffer {
  return Buffer.from(`${ids.licenceId}|${ids.assetId}|${ids.deviceId}`, 'utf8');
}

/** Wraps a DEK for one device. Does not modify or zero the caller's `dek`. */
export function wrapDekForDevice(
  dek: Buffer,
  devicePublicKeySpkiB64u: string,
  ids: LicenceIds,
): WrappedKey {
  const devicePublic = parseDevicePublicKey(devicePublicKeySpkiB64u);
  const ephemeral = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: devicePublic });
  const wrapKey = deriveWrapKey(shared, ids.licenceId);
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', wrapKey, iv, { authTagLength: 16 });
    cipher.setAAD(wrapAad(ids));
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    return {
      alg: WRAP_ALG,
      epk: ephemeral.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      iv: iv.toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
  } finally {
    shared.fill(0);
    wrapKey.fill(0);
  }
}

/**
 * Client-side reference: what the app does with WebCrypto (ECDH P-256, HKDF
 * SHA-256, AES-256-GCM). Throws on any mismatch. The caller zeroes the result.
 */
export function unwrapDekForDevice(
  wrapped: WrappedKey,
  devicePrivateKey: KeyObject,
  ids: LicenceIds,
): Buffer {
  const epk = parseDevicePublicKey(wrapped.epk);
  const shared = diffieHellman({ privateKey: devicePrivateKey, publicKey: epk });
  const wrapKey = deriveWrapKey(shared, ids.licenceId);
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      wrapKey,
      Buffer.from(wrapped.iv, 'base64url'),
      {
        authTagLength: 16,
      },
    );
    decipher.setAAD(wrapAad(ids));
    decipher.setAuthTag(Buffer.from(wrapped.tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(wrapped.ciphertext, 'base64url')),
      decipher.final(),
    ]);
  } finally {
    shared.fill(0);
    wrapKey.fill(0);
  }
}

let signingKey: KeyObject | undefined;
function licenceSigningKey(): KeyObject {
  signingKey ??= createPrivateKey(env.LICENCE_SIGNING_PRIVATE_KEY);
  return signingKey;
}

/** Ed25519 over canonical JSON of the payload; returns base64url. Do not include `signature` in the payload. */
export function signLicence(payload: object): string {
  if ('signature' in payload) throw new Error('Licence payload must not contain a signature');
  return sign(null, Buffer.from(canonicalJson(payload), 'utf8'), licenceSigningKey()).toString(
    'base64url',
  );
}

export function verifyLicence(
  licence: object & { signature: string },
  publicKeyPem: string,
): boolean {
  const { signature, ...payload } = licence;
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(payload), 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

export function licenceSigningPublicKeyPem(): string {
  return createPublicKey(licenceSigningKey()).export({ type: 'spki', format: 'pem' }).toString();
}

/**
 * Identifies the licence signing key: the first 16 hex chars of SHA-256 over the public
 * key's SPKI DER. Carried (signed) in every licence so apps can pick the right key
 * after a rotation.
 */
export function licenceSigningKeyId(): string {
  const der = createPublicKey(licenceSigningKey()).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex').slice(0, 16);
}
