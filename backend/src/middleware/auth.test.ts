/// <reference path="../types/express.d.ts" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
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

describe('Auth Middleware', () => {
  const validContext = {
    userId: '123e4567-e89b-12d3-a456-426614174000',
    role: 'reader' as const,
    publisherId: null,
  };

  it('rejects requests without Authorization header', () => {
    const req = createMockReq();
    const res = createMockRes();

    let capturedError: unknown;
    requireAuth(req, res, (err?: unknown) => {
      capturedError = err;
    });

    assert.ok(capturedError instanceof AppError);
    assert.equal(capturedError.status, 401);
    assert.equal(capturedError.code, 'unauthenticated');
    assert.equal(capturedError.message, 'Missing bearer token');
  });

  it('rejects requests with malformed Authorization header', () => {
    const req = createMockReq({ authorization: 'Basic 12345' });
    const res = createMockRes();

    let capturedError: unknown;
    requireAuth(req, res, (err?: unknown) => {
      capturedError = err;
    });

    assert.ok(capturedError instanceof AppError);
    assert.equal(capturedError.status, 401);
    assert.equal(capturedError.code, 'unauthenticated');
  });

  it('rejects requests with invalid token', () => {
    const req = createMockReq({ authorization: 'Bearer invalid.token' });
    const res = createMockRes();

    let capturedError: unknown;
    requireAuth(req, res, (err?: unknown) => {
      capturedError = err;
    });

    assert.ok(capturedError instanceof AppError);
    assert.equal(capturedError.status, 401);
    assert.equal(capturedError.code, 'unauthenticated');
    assert.equal(capturedError.message, 'Invalid or expired token');
  });

  it('populates req.auth when token is valid', () => {
    const token = signAccessToken(validContext);
    const req = createMockReq({ authorization: `Bearer ${token}` });
    const res = createMockRes();

    let capturedError: unknown;
    requireAuth(req, res, (err?: unknown) => {
      capturedError = err;
    });

    assert.equal(capturedError, undefined);
    assert.deepEqual(req.auth, validContext);
    assert.deepEqual(authContext(req), validContext);
  });

  it('enforces role requirements', () => {
    const token = signAccessToken(validContext);
    const req = createMockReq({ authorization: `Bearer ${token}` });
    const res = createMockRes();

    requireAuth(req, res, () => {});

    const publisherOnly = requireRole('publisher', 'admin');
    let capturedError: unknown;
    publisherOnly(req, res, (err?: unknown) => {
      capturedError = err;
    });

    assert.ok(capturedError instanceof AppError);
    assert.equal(capturedError.status, 403);
    assert.equal(capturedError.code, 'forbidden');
  });
});
