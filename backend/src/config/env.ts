import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

/** The value docker-compose falls back to so `docker compose up` works bare. */
const DEV_JWT_SECRET = 'dev-only-insecure-secret';

/** Compose passes unset variables through as "", which means "not set". */
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
  }

  if (env.PAYMENTS_MODE === 'paddle' && (!env.PADDLE_API_KEY || !env.PADDLE_WEBHOOK_SECRET)) {
    throw new Error('PAYMENTS_MODE=paddle requires PADDLE_API_KEY and PADDLE_WEBHOOK_SECRET.');
  }

  return env;
}

export const env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
