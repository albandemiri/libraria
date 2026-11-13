import {
  client,
  createBook,
  createPublisher,
  createUser,
  pool,
  resetDatabase,
  startTestServer,
  type TestServer,
} from './harness';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Pins down the CURRENT simulated checkout (PAYMENTS_MODE=simulated), so the
 * Commerce MVP rewrite (spec 7.1) starts from known behaviour. When the real
 * provider flow lands, the "grants immediately" assertions here must flip:
 * entitlement may only follow a verified webhook.
 */

let server: TestServer;
let api: ReturnType<typeof client>;
let publisherId: string;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  publisherId = await createPublisher();
});

after(async () => {
  await server.close();
});

describe('simulated checkout', () => {
  it('records a completed sim_ transaction at the catalogue price and grants the book', async () => {
    const bookId = await createBook(publisherId, { priceCents: 1299 });
    const reader = await createUser();

    const res = await api('POST', '/transactions', {
      token: reader.token,
      // A client-sent amount must be ignored; the server prices from the DB.
      body: { bookId, amountCents: 1 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.transaction.status, 'completed');
    assert.equal(res.body.transaction.amount.amountCents, 1299);
    assert.match(res.body.transaction.paymentGatewayRef, /^sim_/);

    const { rows } = await pool.query(
      'SELECT transaction_id FROM user_libraries WHERE user_id = $1 AND book_id = $2',
      [reader.id, bookId],
    );
    assert.equal(rows[0]?.transaction_id, res.body.transaction.id);
  });

  it('refuses to sell the same book twice to one user', async () => {
    const bookId = await createBook(publisherId);
    const reader = await createUser();

    await api('POST', '/transactions', { token: reader.token, body: { bookId } });
    const again = await api('POST', '/transactions', { token: reader.token, body: { bookId } });

    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'ALREADY_OWNED');
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM transactions');
    assert.equal(rows[0].n, 1);
  });

  it('does not sell unpublished or unknown books', async () => {
    const draft = await createBook(publisherId, { available: false });
    const reader = await createUser();

    for (const bookId of [draft, '00000000-0000-4000-8000-000000000000']) {
      const res = await api('POST', '/transactions', { token: reader.token, body: { bookId } });
      assert.equal(res.status, 404);
    }
  });

  it('scopes idempotency keys per user, so equal keys from two users do not collide', async () => {
    const bookId = await createBook(publisherId);
    const alice = await createUser();
    const bob = await createUser();

    const a = await api('POST', '/transactions', {
      token: alice.token,
      body: { bookId, idempotencyKey: 'checkout-1' },
    });
    const b = await api('POST', '/transactions', {
      token: bob.token,
      body: { bookId, idempotencyKey: 'checkout-1' },
    });

    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
  });

  it('requires authentication', async () => {
    const bookId = await createBook(publisherId);
    const res = await api('POST', '/transactions', { body: { bookId } });
    assert.equal(res.status, 401);
  });
});

describe('purchase history', () => {
  it("never shows one user's transactions to another", async () => {
    const bookId = await createBook(publisherId);
    const buyer = await createUser();
    const other = await createUser();

    const purchase = await api('POST', '/transactions', { token: buyer.token, body: { bookId } });
    const id = purchase.body.transaction.id;

    const list = await api('GET', '/transactions', { token: other.token });
    assert.deepEqual(list.body.transactions, []);

    const receipt = await api('GET', `/transactions/${id}`, { token: other.token });
    assert.equal(receipt.status, 404);

    const own = await api('GET', `/transactions/${id}`, { token: buyer.token });
    assert.equal(own.status, 200);
  });
});
