import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, resolveApiUrl } from './client';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('ApiError.reason', () => {
  const fail = (status: number, details: unknown) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'INVITE_INVALID', message: 'x', details } }),
            { status, headers: { 'Content-Type': 'application/json' } },
          ),
      ),
    );

  it('carries the reason of an object-shaped details (a 410 invite)', async () => {
    fail(410, { reason: 'expired' });
    const error = await api('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).reason).toBe('expired');
    expect((error as ApiError).details).toEqual([]);
  });

  it('is null when there is no reason, and field details still work', async () => {
    fail(400, [{ path: 'a', message: 'b' }]);
    const error = (await api('/x').catch((e: unknown) => e)) as ApiError;
    expect(error.reason).toBeNull();
    expect(error.details).toEqual([{ path: 'a', message: 'b' }]);
  });
});

describe('resolveApiUrl', () => {
  it('resolves a path against an absolute API base origin', () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.libraria.example/api/v1');
    expect(resolveApiUrl('/api/v1/books/b1/cover?v=2')).toBe(
      'https://api.libraria.example/api/v1/books/b1/cover?v=2',
    );
  });

  it('leaves the path unchanged for a relative base', () => {
    vi.stubEnv('VITE_API_BASE', '/api/v1');
    expect(resolveApiUrl('/api/v1/books/b1/cover?v=2')).toBe('/api/v1/books/b1/cover?v=2');
  });

  it('leaves an external legacy cover URL alone', () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.libraria.example/api/v1');
    expect(resolveApiUrl('https://covers.example/x.jpg')).toBe('https://covers.example/x.jpg');
  });
});
