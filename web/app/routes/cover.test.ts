import { afterEach, describe, expect, it, vi } from 'vitest';
import { commitSession, getSession } from '../server/session.server';
import { loader } from './cover';

async function req(url: string, token?: string): Promise<Request> {
  const headers = new Headers();
  if (token) {
    const session = await getSession(new Request('http://localhost:5174/'));
    session.set('token', token);
    headers.set('Cookie', (await commitSession(session)).split(';')[0] as string);
  }
  return new Request(url, { headers });
}

const ID = '1c48198d-b462-5197-888f-6c816b3963b3';

const run = (request: Request, id = ID) =>
  // biome-ignore lint/suspicious/noExplicitAny: only request and params are used
  loader({ request, params: { id }, context: {} } as any);

afterEach(() => vi.unstubAllGlobals());

describe('cover route', () => {
  it('forwards the session token and copies Cache-Control', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('IMG', {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': '3',
          'Cache-Control': 'private, max-age=60',
          'Set-Cookie': 'x=1',
          ETag: '"e"',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await run(await req(`http://localhost:5174/kopertina/${ID}?v=2&size=thumb`, 'tok'));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:3000/api/v1/books/${ID}/cover?v=2&size=thumb`);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('ETag')).toBeNull();
    expect(await res.text()).toBe('IMG');
  });

  it('sends no Authorization for a guest and ignores unknown params', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('x', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await run(await req(`http://localhost:5174/kopertina/${ID}?size=huge&other=1`));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://localhost:3000/api/v1/books/${ID}/cover`);
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('maps an upstream 404 to 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 404 })));
    const res = await run(await req(`http://localhost:5174/kopertina/${ID}`));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([401, 403])('maps upstream %i to an uncached 404', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status })));
    const res = await run(await req(`http://localhost:5174/kopertina/${ID}`));
    expect(res.status).toBe(404);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('answers an uncached 502 for upstream 5xx and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 500 })));
    const res = await run(await req(`http://localhost:5174/kopertina/${ID}`));
    expect(res.status).toBe(502);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('answers 502 on a network error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    const res = await run(await req(`http://localhost:5174/kopertina/${ID}`));
    expect(res.status).toBe(502);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it.each(['abc', '../x', '1c48198d-b462-5197-888f-6c816b3963b'])(
    'answers an uncached 404 for the non-UUID id %j without calling the API',
    async (id) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const log = vi.spyOn(console, 'error');
      const res = await run(await req('http://localhost:5174/kopertina/x'), id);
      expect(res.status).toBe(404);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    },
  );

  it('does not invent Cache-Control when upstream sends none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 200 })));
    const res = await run(await req(`http://localhost:5174/kopertina/${ID}`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBeNull();
  });
});
