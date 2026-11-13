import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ quiet: true });

/** The value docker-compose falls back to so `docker compose up` works bare. */
const DEV_JWT_SECRET = 'dev-only-insecure-secret';

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
   * `simulated` completes checkouts without any payment provider and exists
   * only for development and tests. `disabled` rejects checkout. A real
   * provider mode arrives with the Commerce MVP (spec section 7).
   */
  PAYMENTS_MODE: z.enum(['simulated', 'disabled']).optional(),
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

  return env;
}

export const env = parseEnv(process.env);

export const isProduction = env.NODE_ENV === 'production';
