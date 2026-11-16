import { isRouteErrorResponse } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './api.server';
import { commitSession, getSession } from './session.server';

const API = 'http://localhost:3000/api/v1';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function unauthenticated(): Response {
  return json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in', requestId: 'r1' } });
}

async function requestWithToken(url: string, token?: string): Promise<Request> {
  const headers = new Headers();
  if (token) {
    const session = await getSession(new Request('http://localhost:5174/'));
    session.set('token', token);
    headers.set('Cookie', (await commitSession(session)).split(';')[0] as string);
  }
  return new Request(url, { headers });
}

function mockFetch(...responses: Response[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fn);
  return fn;
}

function authHeader(call: unknown[]): string | null {
  return new Headers((call[1] as RequestInit).headers).get('Authorization');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('sends no Authorization header for a guest', async () => {
    const fetchMock = mockFetch(json(200, { ok: true }));
    const { data, setCookie } = await apiFetch<{ ok: boolean }>(
      await requestWithToken('http://localhost:5174/'),
      '/books',
    );
    expect(data).toEqual({ ok: true });
    expect(setCookie).toBeUndefined();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/books`);
    expect(authHeader(fetchMock.mock.calls[0] as unknown[])).toBeNull();
  });

  it('sends Bearer <token> from the session', async () => {
    const fetchMock = mockFetch(json(200, {}));
    await apiFetch(await requestWithToken('http://localhost:5174/', 'tok-1'), '/books');
    expect(authHeader(fetchMock.mock.calls[0] as unknown[])).toBe('Bearer tok-1');
  });

  it('sends a JSON body with its content type', async () => {
    const fetchMock = mockFetch(json(201, {}));
    await apiFetch(await requestWithToken('http://localhost:5174/'), '/x', {
      method: 'POST',
      body: { a: 1 },
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"a":1}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('on 401 with optional auth: retries as guest and returns a destroying Set-Cookie', async () => {
    const fetchMock = mockFetch(unauthenticated(), json(200, { books: [] }));
    const { data, setCookie } = await apiFetch(
      await requestWithToken('http://localhost:5174/', 'stale'),
      '/books',
      { auth: 'optional' },
    );
    expect(data).toEqual({ books: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authHeader(fetchMock.mock.calls[1] as unknown[])).toBeNull();
    expect(setCookie).toMatch(/libraria_session=;/);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('on 401 with required auth: throws a redirect to /hyr?returnTo=<path>', async () => {
    mockFetch(unauthenticated());
    const request = await requestWithToken('http://localhost:5174/pagesa/abc?x=1&y=2', 'stale');
    const thrown = await apiFetch(request, '/me', { auth: 'required' }).catch((e) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(302);
    expect(thrown.headers.get('Location')).toBe(
      `/hyr?returnTo=${encodeURIComponent('/pagesa/abc?x=1&y=2')}`,
    );
    expect(thrown.headers.get('Set-Cookie')).toMatch(/libraria_session=;/);
  });

  it('required auth with no token redirects without calling the API', async () => {
    const fetchMock = mockFetch();
    const thrown = await apiFetch(await requestWithToken('http://localhost:5174/lista'), '/me', {
      auth: 'required',
    }).catch((e) => e);
    expect(thrown.headers.get('Location')).toBe('/hyr?returnTo=%2Flista');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auth 'none' sends no Authorization header and does not retry or redirect on 401", async () => {
    const fetchMock = mockFetch(unauthenticated());
    const err = await apiFetch(
      await requestWithToken('http://localhost:5174/', 'tok'),
      '/auth/login',
      {
        method: 'POST',
        body: {},
        auth: 'none',
      },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authHeader(fetchMock.mock.calls[0] as unknown[])).toBeNull();
  });

  it('maps an API error body to ApiError with code and status', async () => {
    mockFetch(json(404, { error: { code: 'NOT_FOUND', message: 'No such book', requestId: 'r' } }));
    const err = await apiFetch(await requestWithToken('http://localhost:5174/'), '/books/x').catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'No such book' });
    expect(isRouteErrorResponse(err)).toBe(false);
  });

  it('maps a non-JSON error body to a generic ApiError', async () => {
    mockFetch(new Response('Bad gateway', { status: 502 }));
    const err = await apiFetch(await requestWithToken('http://localhost:5174/'), '/x').catch(
      (e) => e,
    );
    expect(err).toMatchObject({ status: 502, code: 'UNKNOWN' });
  });
});
