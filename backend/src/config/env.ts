import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

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
});

function load() {
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;

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
  }

  return env;
}

export const env = load();

export const isProduction = env.NODE_ENV === 'production';
