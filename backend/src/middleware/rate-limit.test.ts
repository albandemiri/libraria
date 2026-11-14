import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { Request, Response } from 'express';
import { AppError } from './errors';
import { rateLimit, resetRateLimits } from './rate-limit';

function hit(handler: ReturnType<typeof rateLimit>, id: string) {
  const headers: Record<string, string> = {};
  let outcome: unknown = 'pending';
  const req = { params: { id } } as unknown as Request;
  const res = {
    set: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
  } as unknown as Response;
  handler(req, res, (error?: unknown) => {
    outcome = error ?? 'next';
  });
  return { headers, outcome };
}

describe('rateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
    mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  const make = () =>
    rateLimit({ name: 't', limit: 3, windowMs: 10_000, key: (req) => String(req.params.id) });

  it('allows the limit, then answers 429 RATE_LIMITED with Retry-After', () => {
    const handler = make();
    for (let i = 0; i < 3; i++) assert.equal(hit(handler, 'a').outcome, 'next');
    const blocked = hit(handler, 'a');
    assert.ok(blocked.outcome instanceof AppError);
    assert.equal(blocked.outcome.status, 429);
    assert.equal(blocked.outcome.code, 'RATE_LIMITED');
    assert.equal(blocked.headers['retry-after'], '10');
  });

  it('slides: capacity returns as old hits leave the window', () => {
    const handler = make();
    hit(handler, 'a');
    mock.timers.tick(4_000);
    hit(handler, 'a');
    hit(handler, 'a');
    const blocked = hit(handler, 'a');
    assert.ok(blocked.outcome instanceof AppError);
    assert.equal(blocked.headers['retry-after'], '6');
    mock.timers.tick(6_000);
    assert.equal(hit(handler, 'a').outcome, 'next');
    assert.ok(hit(handler, 'a').outcome instanceof AppError);
  });

  it('keeps keys independent', () => {
    const handler = make();
    for (let i = 0; i < 3; i++) hit(handler, 'a');
    assert.ok(hit(handler, 'a').outcome instanceof AppError);
    assert.equal(hit(handler, 'b').outcome, 'next');
  });

  it('keeps limiter names independent', () => {
    const first = make();
    const second = rateLimit({
      name: 'other',
      limit: 3,
      windowMs: 10_000,
      key: (req) => String(req.params.id),
    });
    for (let i = 0; i < 3; i++) hit(first, 'a');
    assert.equal(hit(second, 'a').outcome, 'next');
  });
});
