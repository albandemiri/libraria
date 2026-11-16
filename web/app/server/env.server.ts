import { z } from 'zod';

// Optional local overrides (see .env.example); real environment variables win.
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

/** The value used when SESSION_SECRET is unset, so `npm run dev` works bare. */
export const DEV_SESSION_SECRET = 'dev-only-web-session-secret';

/** Compose passes unset variables through as "", which means "not set". */
const emptyAsUnset = (value: unknown) => (value === '' ? undefined : value);

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_URL: z.preprocess(emptyAsUnset, z.url().default('http://localhost:3000')),
    SESSION_SECRET: z.preprocess(emptyAsUnset, z.string().min(1).default(DEV_SESSION_SECRET)),
    PUBLIC_ORIGIN: z.preprocess(emptyAsUnset, z.url().default('http://localhost:5174')),
    PAYMENTS_MODE: z.preprocess(emptyAsUnset, z.enum(['simulated', 'paddle']).default('simulated')),
    PADDLE_CLIENT_TOKEN: z.preprocess(emptyAsUnset, z.string().min(1).optional()),
    PADDLE_ENVIRONMENT: z.preprocess(
      emptyAsUnset,
      z.enum(['sandbox', 'production']).default('sandbox'),
    ),
    PORTAL_URL: z.preprocess(emptyAsUnset, z.url().default('http://localhost:5173')),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && value.SESSION_SECRET === DEV_SESSION_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET must be set to a real secret in production',
      });
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid web environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
