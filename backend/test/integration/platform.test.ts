import { client, pool, startTestServer, type TestServer } from './harness';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { runMigrations } from '../../src/db/migrate';

let server: TestServer;
let api: ReturnType<typeof client>;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

after(async () => {
  await server.close();
});

describe('migrations', () => {
  it('records applied migrations and is a no-op when re-run', async () => {
    const { rows } = await pool.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    );
    assert.equal(rows[0]?.version, '0001');

    const result = await runMigrations(pool);
    assert.deepEqual(result.applied, []);
    assert.equal(result.alreadyApplied.length, rows.length);
  });
});

describe('API conventions (spec 6.1, 6.2)', () => {
  it('serves the API under /api/v1 only', async () => {
    const unversioned = await fetch(`${server.baseUrl.replace('/api/v1', '')}/books`);
    assert.equal(unversioned.status, 404);

    const versioned = await api('GET', '/books');
    assert.equal(versioned.status, 200);
  });

  it('returns code, message and requestId on errors, matching the response header', async () => {
    const res = await api('GET', '/no-such-route');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
    assert.equal(typeof res.body.error.message, 'string');
    assert.ok(res.body.error.requestId);
    assert.equal(res.headers.get('x-request-id'), res.body.error.requestId);
  });

  it('propagates a well-formed incoming X-Request-Id', async () => {
    const res = await api('GET', '/no-such-route', {
      headers: { 'X-Request-Id': 'client-trace-12345' },
    });
    assert.equal(res.body.error.requestId, 'client-trace-12345');
  });

  it('replaces an incoming X-Request-Id that could inject into logs', async () => {
    const res = await api('GET', '/no-such-route', {
      headers: { 'X-Request-Id': 'bad id with spaces {"level":"error"}' },
    });
    assert.notEqual(res.body.error.requestId, 'bad id with spaces {"level":"error"}');
  });

  it('rejects malformed JSON with MALFORMED_JSON, not a 500', async () => {
    const res = await api('POST', '/auth/login', { rawBody: '{"email": ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'MALFORMED_JSON');
  });

  it('rejects oversized bodies with PAYLOAD_TOO_LARGE', async () => {
    const res = await api('POST', '/auth/login', {
      rawBody: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(1_100_000) }),
    });
    assert.equal(res.status, 413);
    assert.equal(res.body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('does not advertise the framework', async () => {
    const res = await api('GET', '/books');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});
