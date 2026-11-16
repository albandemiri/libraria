import { describe, expect, it } from 'vitest';
import { action } from './language';

function post(fields: Record<string, string>, origin: string | null = 'http://localhost:5174') {
  const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
  if (origin) headers.set('Origin', origin);
  const request = new Request('http://localhost:5174/gjuha', {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields),
  });
  // biome-ignore lint/suspicious/noExplicitAny: only the request is used
  return action({ request, params: {}, context: {} } as any) as Promise<Response>;
}

describe('POST /gjuha', () => {
  it('keeps the path and query string and sets the cookie', async () => {
    const returnTo = '/eksploro/Fiction?sort=title&page=2';
    const res = await post({ lang: 'en', returnTo });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(returnTo);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('libraria_lang=en');
    expect(cookie).toContain('Max-Age=31536000');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('SameSite=Lax');
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'eksploro', ''])(
    'refuses returnTo %j',
    async (returnTo) => {
      const res = await post({ lang: 'sq', returnTo });
      expect(res.headers.get('Location')).toBe('/');
    },
  );

  it('sets no cookie for an unknown language', async () => {
    const res = await post({ lang: 'fr', returnTo: '/' });
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });

  it('rejects a cross-origin post with 403', async () => {
    await expect(post({ lang: 'en', returnTo: '/' }, 'https://evil.example')).rejects.toMatchObject(
      { status: 403 },
    );
  });
});
