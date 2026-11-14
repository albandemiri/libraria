import { createPrivateKey } from 'node:crypto';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

/** The value docker-compose falls back to so `docker compose up` works bare. */
const DEV_JWT_SECRET = 'dev-only-insecure-secret';

/**
 * Built-in development DRM secrets, like DEV_JWT_SECRET: published in the repo,
 * allowed outside production only. Both were generated randomly for this
 * purpose; nothing is derived from any other secret.
 */
const DEV_DRM_LOCAL_KEK = 'OhI9j5jZV6qL59ZQVGRsAUHlduS3kmxEGrq9uvASu3s=';
const DEV_LICENCE_SIGNING_PRIVATE_KEY =
  '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIGGhwCl2iLTohcCtEDBIjY/ZIsvpGiqmV3CFH4AuKxkg\n-----END PRIVATE KEY-----\n';

/** .env files and compose often carry PEMs with a literal backslash-n; "" means unset. */
function normalizePem(value: unknown): unknown {
  if (value === '' || value === undefined) return undefined;
  return typeof value === 'string' ? value.replaceAll('\\n', '\n') : value;
}

const DEV_KEK_BYTES = Buffer.from(DEV_DRM_LOCAL_KEK, 'base64');

/** Strict base64 of exactly 32 bytes (padding optional), and not all zeros. */
function isValidKek(value: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=?$/.test(value)) return false;
  return Buffer.from(value, 'base64').some((byte) => byte !== 0);
}

function isEd25519Pem(pem: string): boolean {
  try {
    return createPrivateKey(pem).asymmetricKeyType === 'ed25519';
  } catch {
    return false;
  }
}

/** Compose passes unset variables through as "", which means "not set". */
const DEV_SIGNING_KEY_DER = createPrivateKey(DEV_LICENCE_SIGNING_PRIVATE_KEY).export({
  type: 'pkcs8',
  format: 'der',
});

const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1).default('libraria_user'),
  POSTGRES_PASSWORD: z.string().min(1).default('libraria_password'),
  POSTGRES_DB: z.string().min(1).default('libraria'),

  JWT_SECRET: z.string().min(1).default(DEV_JWT_SECRET),
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),

  /** Comma-separated exact origins allowed to call the API with cookies (the portal). */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** Lifetime of a portal login without "Remember me". */
  PORTAL_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  /** Lifetime of a portal login with "Remember me". */
  PORTAL_REMEMBER_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /** Key management backend for asset DEKs. Only `local` exists; it is refused in production. */
  KMS_PROVIDER: z.enum(['local']).default('local'),
  /** Base64 of the 32-byte key-encryption key used by the local KMS. */
  DRM_LOCAL_KEK: z
    .preprocess((v) => (v === '' ? undefined : v), z.string().default(DEV_DRM_LOCAL_KEK))
    .refine(isValidKek, {
      message: 'DRM_LOCAL_KEK must be the base64 encoding of exactly 32 bytes, not all zero',
    }),
  /** Ed25519 PKCS#8 PEM used to sign device licences. */
  LICENCE_SIGNING_PRIVATE_KEY: z
    .preprocess(normalizePem, z.string().default(DEV_LICENCE_SIGNING_PRIVATE_KEY))
    .refine(isEd25519Pem, {
      message: 'LICENCE_SIGNING_PRIVATE_KEY must be an Ed25519 PKCS#8 PEM',
    }),
  /** Directory for the local object storage, relative to the backend working directory. */
  /** Object storage backend. Only `local` (development) exists so far; refused in production. */
  STORAGE_PROVIDER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['local']).default('local'),
  ),
  ASSET_STORAGE_DIR: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).default('./var/asset-storage'),
  ),
  /** `none` scans nothing (development only, refused in production); `clamav` uses clamd over TCP. */
  SCANNER: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['none', 'clamav']).default('none'),
  ),
  CLAMAV_HOST: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).default('localhost'),
  ),
  CLAMAV_PORT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().positive().default(3310),
  ),
  /** Seconds-long scans of 100 MB files need far more than the adapter's 10 s idle default. */
  CLAMAV_TIMEOUT_MS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1000).default(120_000),
  ),
  /** Hard limit of one asset upload, enforced while the body streams in. */
  ASSET_MAX_UPLOAD_BYTES: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().positive().default(104_857_600),
  ),
  /** Wall-clock limit of one EPUB validation; a job lock older than 3x this is reclaimed. */
  ASSET_PROCESSING_TIMEOUT_MS: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1000).default(60_000),
  ),
  /** How long a device licence stays valid before the app must renew it. */
  LICENCE_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),

  /**
   * `paddle`: real checkout through Paddle Billing.
   * `simulated`: no provider; payment is confirmed by signed sandbox webhooks
   *   (development and tests only, refused in production).
   * `disabled`: checkout is rejected.
   */
  PAYMENTS_MODE: z.enum(['paddle', 'simulated', 'disabled']).optional(),

  PADDLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  PADDLE_API_KEY: optionalSecret,
  PADDLE_WEBHOOK_SECRET: optionalSecret,

  /** Signs simulated-provider webhooks. Only used when PAYMENTS_MODE=simulated. */
  SIMULATED_WEBHOOK_SECRET: z.string().min(16).default('dev-only-simulated-webhook-secret'),

  /**
   * Maximum age of a webhook signature timestamp. Paddle's SDKs use 5s;
   * keep server clocks NTP-synced rather than raising this much.
   */
  WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(1).max(300).default(5),
});

/**
 * Local object storage keeps encrypted assets on one machine's disk: development only.
 * A separate function so it stays testable while the KMS refusal (also always true
 * today) runs first.
 */
export function refuseLocalStorageInProduction(provider: string): void {
  if (provider === 'local') {
    throw new Error('STORAGE_PROVIDER=local is not allowed in production.');
  }
}

/** Exported for tests; the app uses the `env` singleton below. */
export function parseEnv(source: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const raw = parsed.data;
  const isProd = raw.NODE_ENV === 'production';

  const env = {
    ...raw,
    LOG_LEVEL: raw.LOG_LEVEL ?? (raw.NODE_ENV === 'test' ? 'warn' : 'info'),
    PAYMENTS_MODE: raw.PAYMENTS_MODE ?? (isProd ? 'disabled' : 'simulated'),
  } as const;

  // Fail loudly at boot rather than silently signing production tokens with a
  // secret that is published in the repo.
  if (env.NODE_ENV === 'production') {
    if (env.JWT_SECRET === DEV_JWT_SECRET) {
      throw new Error(
        'JWT_SECRET is still the development default. Set a real secret before running in production.',
      );
    }
    if (env.JWT_SECRET.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters in production.');
    }
    // Simulated checkout grants books without taking payment (spec 2.1, 14.1).
    if (env.PAYMENTS_MODE === 'simulated') {
      throw new Error('PAYMENTS_MODE=simulated is not allowed in production.');
    }

    if (Buffer.from(env.DRM_LOCAL_KEK, 'base64').equals(DEV_KEK_BYTES)) {
      throw new Error(
        'Refusing the development DRM_LOCAL_KEK in production. Set a real 32-byte key.',
      );
    }
    if (
      createPrivateKey(env.LICENCE_SIGNING_PRIVATE_KEY)
        .export({ type: 'pkcs8', format: 'der' })
        .equals(DEV_SIGNING_KEY_DER)
    ) {
      throw new Error(
        'Refusing the development LICENCE_SIGNING_PRIVATE_KEY in production. Set a real Ed25519 key.',
      );
    }
    // Without a scanner every upload would be treated as clean.
    if (env.SCANNER === 'none') {
      throw new Error('SCANNER=none is not allowed in production. Use SCANNER=clamav.');
    }
    // The local KMS keeps the KEK in the process environment: development only.
    if (env.KMS_PROVIDER === 'local') {
      throw new Error('KMS_PROVIDER=local is not allowed in production.');
    }
    refuseLocalStorageInProduction(env.STORAGE_PROVIDER);
  }

  if (env.PAYMENTS_MODE === 'paddle' && (!env.PADDLE_API_KEY || !env.PADDLE_WEBHOOK_SECRET)) {
    throw new Error('PAYMENTS_MODE=paddle requires PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET.');
  }

  return env;
}

export const env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
