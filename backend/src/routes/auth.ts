import bcrypt from 'bcryptjs';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { signAccessToken, UserRole } from '../auth/tokens';
import { env } from '../config/env';
import { pool } from '../db/pool';
import { authContext } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errors';

export const authRouter = Router();

/**
 * bcrypt only considers the first 72 bytes of input, silently ignoring the
 * rest. Rejecting longer passwords is honest; accepting and truncating is not.
 */
const BCRYPT_MAX_BYTES = 72;

const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .refine(
    (value) => Buffer.byteLength(value, 'utf8') <= BCRYPT_MAX_BYTES,
    `Password must be at most ${BCRYPT_MAX_BYTES} bytes`,
  );

const registerSchema = z.object({
  email: z.email().max(254).trim(),
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100).optional(),
});

const loginSchema = z.object({
  email: z.email().max(254).trim(),
  password: z.string().min(1),
});

interface UserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  publisher_id: string | null;
  created_at: Date;
}

function publicUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    publisherId: row.publisher_id,
    createdAt: row.created_at,
  };
}

/**
 * A bcrypt hash of a value nobody knows, compared against when the email is
 * unknown. Without it, "no such user" returns measurably faster than "wrong
 * password" and the endpoint becomes an account-existence oracle.
 */
const DUMMY_HASH = bcrypt.hashSync('unused-placeholder-password', env.BCRYPT_ROUNDS);

const UNIQUE_VIOLATION = '23505';

authRouter.post('/register', async (req: Request, res: Response) => {
  const { email, password, displayName } = registerSchema.parse(req.body);

  const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

  try {
    // Role is deliberately not accepted from the request body. Publisher and
    // admin accounts are provisioned out of band, never self-assigned.
    const result = await pool.query<UserRow>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name, role, publisher_id, created_at`,
      [email, passwordHash, displayName ?? null],
    );

    const user = result.rows[0];
    res.status(201).json({
      user: publicUser(user),
      token: signAccessToken({
        userId: user.id,
        role: user.role,
        publisherId: user.publisher_id,
      }),
    });
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === UNIQUE_VIOLATION
    ) {
      throw new AppError(409, 'An account with that email already exists', 'email_taken');
    }
    throw error;
  }
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password } = loginSchema.parse(req.body);

  const result = await pool.query<UserRow & { password_hash: string }>(
    `SELECT id, email, password_hash, display_name, role, publisher_id, created_at
       FROM users
      WHERE email = $1`,
    [email],
  );

  const user = result.rows[0];
  const matches = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);

  // One message for both failure modes, so the response cannot be used to
  // enumerate registered emails.
  if (!user || !matches) {
    throw new AppError(401, 'Invalid email or password', 'invalid_credentials');
  }

  res.json({
    user: publicUser(user),
    token: signAccessToken({
      userId: user.id,
      role: user.role,
      publisherId: user.publisher_id,
    }),
  });
});

authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  const { userId } = authContext(req);

  const result = await pool.query<UserRow>(
    `SELECT id, email, display_name, role, publisher_id, created_at
       FROM users
      WHERE id = $1`,
    [userId],
  );

  const user = result.rows[0];
  // The token verified, but the account has since been deleted.
  if (!user) {
    throw new AppError(401, 'Account no longer exists', 'unauthenticated');
  }

  res.json({ user: publicUser(user) });
});
