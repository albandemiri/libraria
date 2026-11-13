import {
  client,
  createUser,
  pool,
  resetDatabase,
  startTestServer,
  type TestServer,
} from './harness';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';

let server: TestServer;
let api: ReturnType<typeof client>;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(resetDatabase);

after(async () => {
  await server.close();
});

const PASSWORD = 'correct-horse-battery';

describe('registration and login', () => {
  it('registers a reader, returns a working token, and never echoes the password hash', async () => {
    const res = await api('POST', '/auth/register', {
      body: { email: 'new@reader.test', password: PASSWORD, displayName: 'New Reader' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'reader');
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal(res.body.user.password_hash, undefined);

    const me = await api('GET', '/auth/me', { token: res.body.token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, 'new@reader.test');
  });

  it('ignores a self-assigned role (publisher/admin are provisioned out of band)', async () => {
    const res = await api('POST', '/auth/register', {
      body: { email: 'sneaky@reader.test', password: PASSWORD, role: 'admin' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.user.role, 'reader');

    const { rows } = await pool.query('SELECT role FROM users WHERE email = $1', [
      'sneaky@reader.test',
    ]);
    assert.equal(rows[0].role, 'reader');
  });

  it('rejects a duplicate email case-insensitively', async () => {
    await api('POST', '/auth/register', { body: { email: 'dup@reader.test', password: PASSWORD } });
    const res = await api('POST', '/auth/register', {
      body: { email: 'DUP@reader.test', password: PASSWORD },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  it('rejects weak passwords with field-level validation details', async () => {
    const res = await api('POST', '/auth/register', {
      body: { email: 'weak@reader.test', password: 'short' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    assert.equal(res.body.error.details[0].path, 'password');
  });

  it('logs in with correct credentials', async () => {
    await api('POST', '/auth/register', {
      body: { email: 'login@reader.test', password: PASSWORD },
    });
    const res = await api('POST', '/auth/login', {
      body: { email: 'login@reader.test', password: PASSWORD },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
  });

  it('gives the same answer for a wrong password and an unknown email (no enumeration)', async () => {
    await api('POST', '/auth/register', {
      body: { email: 'known@reader.test', password: PASSWORD },
    });

    const wrongPassword = await api('POST', '/auth/login', {
      body: { email: 'known@reader.test', password: 'not-the-password' },
    });
    const unknownEmail = await api('POST', '/auth/login', {
      body: { email: 'unknown@reader.test', password: 'not-the-password' },
    });

    assert.equal(wrongPassword.status, 401);
    assert.equal(unknownEmail.status, 401);
    assert.equal(wrongPassword.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(unknownEmail.body.error.code, wrongPassword.body.error.code);
    assert.equal(unknownEmail.body.error.message, wrongPassword.body.error.message);
  });
});

describe('token verification', () => {
  it('rejects requests without a token', async () => {
    const res = await api('GET', '/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  });

  it('rejects a token signed with a different secret', async () => {
    const user = await createUser();
    const forged = jwt.sign({ sub: user.id, role: 'admin', publisherId: null }, 'attacker-secret');
    const res = await api('GET', '/auth/me', { token: forged });
    assert.equal(res.status, 401);
  });

  it('rejects an expired token', async () => {
    const user = await createUser();
    const { env } = await import('../../src/config/env');
    const expired = jwt.sign(
      { sub: user.id, role: 'reader', publisherId: null, exp: Math.floor(Date.now() / 1000) - 60 },
      env.JWT_SECRET,
    );
    const res = await api('GET', '/auth/me', { token: expired });
    assert.equal(res.status, 401);
  });

  it('rejects an alg=none token', async () => {
    const user = await createUser();
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: user.id, role: 'admin', publisherId: null }),
    ).toString('base64url');
    const res = await api('GET', '/auth/me', { token: `${header}.${payload}.` });
    assert.equal(res.status, 401);
  });

  it('rejects a valid token for an account that has since been deleted', async () => {
    const user = await createUser();
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
    const res = await api('GET', '/auth/me', { token: user.token });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHENTICATED');
  });
});
