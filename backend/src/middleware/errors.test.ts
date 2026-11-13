import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError, type ErrorBody, errorHandler, notFoundHandler } from './errors';

function run(handler: (res: Response) => void) {
  const captured: { status?: number; body?: ErrorBody } = {};
  const res = {
    headersSent: false,
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(body: ErrorBody) {
      captured.body = body;
      return this;
    },
  } as unknown as Response;
  handler(res);
  return captured;
}

const req = { requestId: 'req-test-123' } as Request;
const next: NextFunction = () => {};

describe('error responses', () => {
  it('includes code, message and requestId for AppError', () => {
    const { status, body } = run((res) =>
      errorHandler(new AppError(409, 'Already owned', 'ALREADY_OWNED'), req, res, next),
    );
    assert.equal(status, 409);
    assert.deepEqual(body, {
      error: { code: 'ALREADY_OWNED', message: 'Already owned', requestId: 'req-test-123' },
    });
  });

  it('maps Zod errors to VALIDATION_FAILED with field details', () => {
    const result = z.object({ email: z.email() }).safeParse({ email: 'nope' });
    assert.ok(!result.success);
    const { status, body } = run((res) => errorHandler(result.error, req, res, next));
    assert.equal(status, 400);
    assert.equal(body?.error.code, 'VALIDATION_FAILED');
    assert.equal(body?.error.details?.[0].path, 'email');
  });

  it('maps body-parser JSON failures to MALFORMED_JSON', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      expose: true,
      type: 'entity.parse.failed',
    });
    const { status, body } = run((res) => errorHandler(parseError, req, res, next));
    assert.equal(status, 400);
    assert.equal(body?.error.code, 'MALFORMED_JSON');
  });

  it('maps oversized bodies to PAYLOAD_TOO_LARGE', () => {
    const tooLarge = Object.assign(new Error('too large'), {
      status: 413,
      expose: true,
      type: 'entity.too.large',
    });
    const { status, body } = run((res) => errorHandler(tooLarge, req, res, next));
    assert.equal(status, 413);
    assert.equal(body?.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('maps unknown routes to ROUTE_NOT_FOUND', () => {
    const { status, body } = run((res) => notFoundHandler(req, res));
    assert.equal(status, 404);
    assert.equal(body?.error.code, 'ROUTE_NOT_FOUND');
    assert.equal(body?.error.requestId, 'req-test-123');
  });
});
