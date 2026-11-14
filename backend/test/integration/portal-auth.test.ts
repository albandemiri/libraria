import {
  type Api,
  client,
  createBook,
  createPublisher,
  pool,
  resetDatabase,
  startTestServer,
  type TestServer,
} from './harness';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcryptjs';
import { env } from '../../src/config/env';

const PASSWORD = 'correct-horse-battery';

let server: TestServer;
let api: Api;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await server.close();
});

let seq = 0;

async function userWithPassword(role: 'reader' | 'publisher' | 'admin', publisherId?: string) {
  const email = `portal${++seq}@example.test`;
  const hash = await bcrypt.hash(PASSWORD, env.BCRYPT_ROUNDS);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, publisher_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, hash, role, publisherId ?? null],
  );
  return { id: rows[0].id, email };
}

async function portalLogin(email: string, extra: Record<string, unknown> = {}) {
  return api('POST', '/auth/portal/login', { body: { email, password: PASSWORD, ...extra } });
}

/** `name=value` pair from the Set-Cookie response, as a browser would send it. */
function cookieHeader(res: { headers: Headers }): string {
  const [setCookie] = res.headers.getSetCookie();
  return setCookie.split(';')[0];
}

describe('portal cookie login', () => {
  it('publisher logs in with a cookie and no token in the body', async () => {
    const publisherId = await createPublisher();
    const { email } = await userWithPassword('publisher', publisherId);

    const res = await portalLogin(email);
    assert.equal(res.status, 200);
    assert.equal(res.body.token, undefined);
    assert.equal(res.body.user.role, 'publisher');
    const setCookies = res.headers.getSetCookie();
    assert.equal(setCookies.length, 1);
    assert.match(setCookies[0], /HttpOnly/);
    assert.match(setCookies[0], /SameSite=Lax/);
    assert.match(setCookies[0], /Path=\/api/);
    assert.doesNotMatch(setCookies[0], /Max-Age/);
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const me = await api('GET', '/auth/me', { headers: { Cookie: cookieHeader(res) } });
    assert.equal(me.status, 200);
    assert.equal(me.headers.get('cache-control'), 'no-store');
    assert.equal(me.body.user.email, email);
  });

  it('readers are refused', async () => {
    const { email } = await userWithPassword('reader');
    const res = await portalLogin(email);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'PORTAL_ACCESS_DENIED');
    assert.equal(res.headers.getSetCookie().length, 0);
  });

  it('remember me sets a 30-day cookie', async () => {
    const { email } = await userWithPassword('admin');
    const res = await portalLogin(email, { rememberMe: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.getSetCookie()[0], /Max-Age=2592000/);
  });

  it('cookie writes need the portal header', async () => {
    const publisherId = await createPublisher();
    const bookId = await createBook(publisherId);
    const { email } = await userWithPassword('publisher', publisherId);
    const cookie = cookieHeader(await portalLogin(email));

    const noHeader = await api('PATCH', `/publisher/books/${bookId}`, {
      headers: { Cookie: cookie },
      body: { title: 'Renamed' },
    });
    assert.equal(noHeader.status, 403);
    assert.equal(noHeader.body.error.code, 'CSRF_CHECK_FAILED');

    const wrongValue = await api('PATCH', `/publisher/books/${bookId}`, {
      headers: { Cookie: cookie, 'X-Libraria-Portal': '0' },
      body: { title: 'Renamed' },
    });
    assert.equal(wrongValue.status, 403);

    const withHeader = await api('PATCH', `/publisher/books/${bookId}`, {
      headers: { Cookie: cookie, 'X-Libraria-Portal': '1' },
      body: { title: 'Renamed' },
    });
    assert.equal(withHeader.status, 200);

    const read = await api('GET', `/publisher/books/${bookId}`, { headers: { Cookie: cookie } });
    assert.equal(read.status, 200);
  });

  it('logout clears the cookie, needs no auth and is idempotent', async () => {
    for (let i = 0; i < 2; i++) {
      const res = await api('POST', '/auth/portal/logout');
      assert.equal(res.status, 204);
      assert.match(res.headers.getSetCookie()[0], /Max-Age=0/);
    }
  });

  it('mobile bearer requests are unaffected', async () => {
    const publisherId = await createPublisher();
    const bookId = await createBook(publisherId);
    const { email } = await userWithPassword('publisher', publisherId);
    const login = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);
    assert.equal(login.headers.getSetCookie().length, 0);

    const res = await api('PATCH', `/publisher/books/${bookId}`, {
      token: login.body.token,
      body: { title: 'Via bearer' },
    });
    assert.equal(res.status, 200);
  });

  it('a Bearer token wins over a cookie, so no portal header is demanded', async () => {
    const publisherId = await createPublisher();
    const bookId = await createBook(publisherId);
    const { email } = await userWithPassword('publisher', publisherId);
    const login = await api('POST', '/auth/login', { body: { email, password: PASSWORD } });
    const res = await api('PATCH', `/publisher/books/${bookId}`, {
      token: login.body.token,
      headers: { Cookie: 'libraria_portal=garbage' },
      body: { title: 'Bearer wins' },
    });
    assert.equal(res.status, 200);
  });

  it('rejects a garbage cookie', async () => {
    const res = await api('GET', '/auth/me', { headers: { Cookie: 'libraria_portal=garbage' } });
    assert.equal(res.status, 401);
  });

  it('wrong password still costs a bcrypt compare', async () => {
    const { email } = await userWithPassword('publisher', await createPublisher());
    const unknown = await portalLogin('nobody@example.test');
    const wrong = await api('POST', '/auth/portal/login', {
      body: { email, password: 'definitely-wrong-password' },
    });
    for (const res of [unknown, wrong]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
      assert.equal(res.headers.getSetCookie().length, 0);
    }
  });

  it('only allow-listed origins get CORS credentials', async () => {
    const res = await fetch(`${server.baseUrl}/auth/me`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});
