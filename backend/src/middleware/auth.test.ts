/// <reference path="../types/express.d.ts" />
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { setAccountStatusLoader } from '../auth/account-status';
import { signAccessToken } from '../auth/tokens';
import { authContext, requireAuth, requireRole } from './auth';
import { AppError } from './errors';

function createMockReq(headers: Record<string, string> = {}): Request {
  return {
    get: (name: string) => headers[name.toLowerCase()] ?? undefined,
  } as unknown as Request;
}

function createMockRes(): Response {
  return {} as unknown as Response;
}

/** Runs requireAuth and resolves with whatever it passed to next(). */
function run(req: Request): Promise<unknown> {
  return new Promise((resolve) => {
    requireAuth(req, createMockRes(), (err?: unknown) => resolve(err));
  });
}

describe('Auth Middleware', () => {
  afterEach(() => setAccountStatusLoader());

  const validContext = {
    userId: '123e4567-e89b-12d3-a456-426614174000',
    role: 'reader' as const,
    publisherId: null,
  };

  it('rejects requests without Authorization header', async () => {
    const req = createMockReq();

    setAccountStatusLoader(async () => 'active');
    const capturedError = await run(req);

    assert.ok(capturedError instanceof AppError);
    assert.equal(capturedError.status, 401);
    assert.equal(capturedError.code, 'UNAUTHENTICATED');
    assert.equal(capturedError.message, 'Missing bearer token');
  });

  it('rejects requests with malformed Authorization header', async () => {
    const req = createMockReq({ authorization: 'Basic 12345' });

    setAccountStatusLoader(async () => 'active');
    const capturedError = await run(req);

    assert.ok(capturedError instanceof AppError);
    assert.equal(capturedError.status, 401);
    assert.equal(capturedError.code, 'UNAUTHENTICATED');
  });

  it('rejects requests with invalid token', async () => {
    const req = createMockReq({ authorization: 'Bearer invalid.token' });

    setAccountStatusLoader(async () => 'active');
    const capturedError = await run(req);

    assert.ok(capturedError instanceof AppError);
    assert.equal(capturedError.status, 401);
    assert.equal(capturedError.code, 'UNAUTHENTICATED');
    assert.equal(capturedError.message, 'Invalid or expired token');
  });

  it('populates req.auth when token is valid', async () => {
    const token = signAccessToken(validContext);
    const req = createMockReq({ authorization: `Bearer ${token}` });

    setAccountStatusLoader(async () => 'active');
    const capturedError = await run(req);

    assert.equal(capturedError, undefined);
    assert.deepEqual(req.auth, validContext);
    assert.deepEqual(authContext(req), validContext);
  });

  it('enforces role requirements', async () => {
    const token = signAccessToken(validContext);
    const req = createMockReq({ authorization: `Bearer ${token}` });
    const res = createMockRes();

    setAccountStatusLoader(async () => 'active');
    await run(req);

    const publisherOnly = requireRole('publisher', 'admin');
    let capturedError: unknown;
    publisherOnly(req, res, (err?: unknown) => {
      capturedError = err;
    });

    assert.ok(capturedError instanceof AppError);
    assert.equal(capturedError.status, 403);
    assert.equal(capturedError.code, 'FORBIDDEN');
  });

  it('rejects a suspended account with 403 ACCOUNT_SUSPENDED', async () => {
    const req = createMockReq({ authorization: `Bearer ${signAccessToken(validContext)}` });
    setAccountStatusLoader(async () => 'suspended');
    const error = await run(req);
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 403);
    assert.equal(error.code, 'ACCOUNT_SUSPENDED');
  });

  it('rejects a deleted account with 401', async () => {
    const req = createMockReq({ authorization: `Bearer ${signAccessToken(validContext)}` });
    setAccountStatusLoader(async () => null);
    const error = await run(req);
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 401);
  });
});
