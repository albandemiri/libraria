import jwt, { SignOptions } from 'jsonwebtoken';
import { z } from 'zod';
import { env } from '../config/env';

export const userRoles = ['reader', 'publisher', 'admin'] as const;
export type UserRole = (typeof userRoles)[number];

/** What a verified request knows about its caller. */
export interface AuthContext {
  userId: string;
  role: UserRole;
  publisherId: string | null;
}

/**
 * Claims are validated on the way back in as well as out. A token can be
 * correctly signed and still carry a payload from an older schema.
 */
const claimsSchema = z.object({
  sub: z.string().uuid(),
  role: z.enum(userRoles),
  publisherId: z.string().uuid().nullable().default(null),
});

export function signAccessToken(context: AuthContext): string {
  const options: SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as SignOptions['expiresIn'],
  };

  return jwt.sign(
    { sub: context.userId, role: context.role, publisherId: context.publisherId },
    env.JWT_SECRET,
    options,
  );
}

/** Returns the caller's context, or null if the token is absent/invalid/expired. */
export function verifyAccessToken(token: string): AuthContext | null {
  let payload: unknown;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    return null;
  }

  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) {
    return null;
  }

  return {
    userId: claims.data.sub,
    role: claims.data.role,
    publisherId: claims.data.publisherId,
  };
}
