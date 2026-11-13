import './payments-disabled.env';
import {
  client,
  createBook,
  createPublisher,
  createUser,
  pool,
  startTestServer,
  type TestServer,
} from './harness';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

let server: TestServer;
let api: ReturnType<typeof client>;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

after(async () => {
  await server.close();
});

describe('checkout with PAYMENTS_MODE=disabled (the production default)', () => {
  it('refuses to complete a purchase and grants nothing', async () => {
    const bookId = await createBook(await createPublisher());
    const reader = await createUser();

    const res = await api('POST', '/transactions', { token: reader.token, body: { bookId } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'PAYMENTS_UNAVAILABLE');

    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM transactions)::int AS transactions,
              (SELECT COUNT(*) FROM user_libraries)::int AS library`,
    );
    assert.deepEqual(rows[0], { transactions: 0, library: 0 });
  });
});
