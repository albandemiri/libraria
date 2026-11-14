import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { cors } from './cors';

function run(allowed: string[], method: string, origin?: string) {
  const headers: Record<string, string> = {};
  let status = 0;
  let nextCalled = false;
  const req = {
    method,
    get: (name: string) => (name.toLowerCase() === 'origin' ? origin : undefined),
  } as unknown as Request;
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    append: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
    sendStatus: (s: number) => {
      status = s;
    },
  } as unknown as Response;
  cors(allowed)(req, res, () => {
    nextCalled = true;
  });
  return { headers, status, nextCalled };
}

describe('cors', () => {
  const allowed = ['https://portal.example'];

  it('grants credentials to an allowed origin', () => {
    const r = run(allowed, 'GET', 'https://portal.example');
    assert.equal(r.headers['access-control-allow-origin'], 'https://portal.example');
    assert.equal(r.headers['access-control-allow-credentials'], 'true');
    assert.equal(r.headers.vary, 'Origin');
    assert.equal(r.nextCalled, true);
  });

  it('answers preflight from an allowed origin with 204 and method/header lists', () => {
    const r = run(allowed, 'OPTIONS', 'https://portal.example');
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-allow-methods'], 'GET,POST,PATCH,PUT,DELETE');
    assert.equal(
      r.headers['access-control-allow-headers'],
      'Content-Type,X-Libraria-Portal,X-Request-Id',
    );
  });

  it('gives other origins no CORS headers', () => {
    const r = run(allowed, 'GET', 'https://evil.example');
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.headers['access-control-allow-credentials'], undefined);
    assert.equal(r.nextCalled, true);
  });

  it('answers a preflight from another origin with a bare 204', () => {
    const r = run(allowed, 'OPTIONS', 'https://evil.example');
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-allow-origin'], undefined);
    assert.equal(r.headers['access-control-allow-methods'], undefined);
  });

  it('never reflects when the allowlist is empty or origin is "null"', () => {
    assert.equal(
      run([], 'GET', 'https://a.example').headers['access-control-allow-origin'],
      undefined,
    );
    assert.equal(run(allowed, 'GET', 'null').headers['access-control-allow-origin'], undefined);
  });
});
