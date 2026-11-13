import {
  type Api,
  buy,
  client,
  createBook,
  createPublisher,
  createUser,
  pool,
  resetDatabase,
  SIMULATED_SIGNATURE_HEADER,
  signWebhook,
  startTestServer,
  type TestServer,
  type TestUser,
} from './harness';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { env } from '../../src/config/env';

/**
 * Commerce MVP (spec 7, 13.1 #3 and #4): access is granted only by a
 * verified provider event, exactly once, and revoked by refunds and lost
 * chargebacks.
 */

let server: TestServer;
let api: Api;
let publisherId: string;
let reader: TestUser;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  publisherId = await createPublisher();
  reader = await createUser();
});

after(async () => {
  await server.close();
});

async function checkout(user: TestUser, bookIds: string[], idempotencyKey?: string) {
  return api('POST', '/checkout-sessions', {
    token: user.token,
    body: { bookIds, ...(idempotencyKey && { idempotencyKey }) },
  });
}

async function sandbox(user: TestUser, transactionId: string, body: Record<string, unknown>) {
  return api('POST', `/sandbox/transactions/${transactionId}/events`, { token: user.token, body });
}

async function canRead(user: TestUser, bookId: string): Promise<boolean> {
  const res = await api('GET', `/library/${bookId}/key`, { token: user.token });
  return res.status === 200;
}

async function status(transactionId: string): Promise<string> {
  const { rows } = await pool.query('SELECT status FROM transactions WHERE id = $1', [
    transactionId,
  ]);
  return rows[0].status;
}

/** A signed simulated-provider webhook body, as the provider would POST it. */
function webhook(
  transactionId: string,
  event: Record<string, unknown>,
  eventId: string = randomUUID(),
) {
  return Buffer.from(
    JSON.stringify({
      providerEventId: `evt_${eventId}`,
      eventType: `simulated.${event.kind}`,
      occurredAt: new Date().toISOString(),
      providerTransactionId: null,
      internalTransactionId: transactionId,
      event,
    }),
  );
}

async function postWebhook(raw: Buffer, signature?: string) {
  const res = await fetch(`${server.baseUrl}/webhooks/simulated`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(signature !== undefined && { [SIMULATED_SIGNATURE_HEADER]: signature }),
    },
    // Exact bytes: the signature covers them.
    body: new Uint8Array(raw),
  });
  return { status: res.status, body: await res.json() };
}

const paymentFor = (cents: number) => ({
  kind: 'payment_succeeded',
  totals: {
    currency: 'EUR',
    subtotalCents: cents,
    taxCents: 0,
    totalCents: cents,
    feeCents: 0,
    earningsCents: cents,
  },
  lineItems: [],
});

describe('checkout', () => {
  it('creates a pending transaction priced from the catalogue, and grants nothing', async () => {
    const bookId = await createBook(publisherId, { priceCents: 1299 });

    const res = await checkout(reader, [bookId]);
    assert.equal(res.status, 201);
    assert.equal(res.body.transaction.status, 'pending');
    assert.equal(res.body.transaction.total.amountCents, 1299);
    assert.equal(res.body.transaction.total.currency, 'EUR');
    assert.equal(res.body.checkout.provider, 'simulated');
    assert.equal(res.body.transaction.items[0].book.id, bookId);

    assert.equal(await canRead(reader, bookId), false);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM entitlements');
    assert.equal(rows[0].n, 0);
  });

  it('snapshots price and publisher, so later catalogue edits do not rewrite the sale', async () => {
    const bookId = await createBook(publisherId, { priceCents: 500 });
    const res = await checkout(reader, [bookId]);

    const otherPublisher = await createPublisher();
    await pool.query('UPDATE books SET price_cents = 9999, publisher_id = $2 WHERE id = $1', [
      bookId,
      otherPublisher,
    ]);

    const { rows } = await pool.query(
      'SELECT unit_price_cents, publisher_id FROM transaction_items WHERE transaction_id = $1',
      [res.body.transaction.id],
    );
    assert.equal(Number(rows[0].unit_price_cents), 500);
    assert.equal(rows[0].publisher_id, publisherId);
  });

  it('buys several books, from several publishers, in one transaction', async () => {
    const other = await createPublisher();
    const a = await createBook(publisherId, { priceCents: 499 });
    const b = await createBook(other, { priceCents: 1299 });

    const id = await buy(api, reader.token, [a, b]);

    assert.equal(await status(id), 'paid');
    assert.ok(await canRead(reader, a));
    assert.ok(await canRead(reader, b));

    const { rows } = await pool.query(
      `SELECT publisher_id, unit_price_cents, tax_cents, provider_fee_cents, net_cents
         FROM transaction_items WHERE transaction_id = $1 ORDER BY unit_price_cents`,
      [id],
    );
    assert.deepEqual(
      rows.map((row) => row.publisher_id),
      [publisherId, other],
    );
    // Every cent of the gross is accounted for: tax + provider fee + net.
    for (const row of rows) {
      assert.equal(
        Number(row.tax_cents) + Number(row.provider_fee_cents) + Number(row.net_cents),
        Number(row.unit_price_cents),
      );
    }
  });

  it('rejects books already owned, unpublished or unknown', async () => {
    const owned = await createBook(publisherId);
    await buy(api, reader.token, [owned]);
    const draft = await createBook(publisherId, { available: false });

    const again = await checkout(reader, [owned]);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'ALREADY_OWNED');

    assert.equal((await checkout(reader, [draft])).status, 404);
    assert.equal((await checkout(reader, [randomUUID()])).status, 404);
  });

  it('returns the same checkout for a retried idempotency key', async () => {
    const bookId = await createBook(publisherId);
    const first = await checkout(reader, [bookId], 'retry-key-001');
    const retry = await checkout(reader, [bookId], 'retry-key-001');

    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.transaction.id, first.body.transaction.id);

    const otherBook = await createBook(publisherId);
    const misuse = await checkout(reader, [otherBook], 'retry-key-001');
    assert.equal(misuse.status, 409);
    assert.equal(misuse.body.error.code, 'IDEMPOTENCY_KEY_REUSED');

    // Keys are per user.
    const someoneElse = await createUser();
    assert.equal((await checkout(someoneElse, [bookId], 'retry-key-001')).status, 201);
  });

  it('serialises concurrent retries of the same idempotency key into one transaction', async () => {
    const bookId = await createBook(publisherId);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => checkout(reader, [bookId], 'concurrent-key')),
    );
    const ids = new Set(results.map((res) => res.body.transaction?.id));
    assert.equal(ids.size, 1);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM transactions');
    assert.equal(rows[0].n, 1);
  });

  it('no longer accepts the old instant-purchase endpoint', async () => {
    const bookId = await createBook(publisherId);
    const res = await api('POST', '/transactions', { token: reader.token, body: { bookId } });
    assert.equal(res.status, 404);
  });
});

describe('payment webhooks (spec 7.2, 13.1 #3)', () => {
  it('grants access on a correctly signed webhook', async () => {
    const bookId = await createBook(publisherId, { priceCents: 700 });
    const id = (await checkout(reader, [bookId])).body.transaction.id;
    const raw = webhook(id, paymentFor(700));

    const res = await postWebhook(raw, signWebhook(raw, env.SIMULATED_WEBHOOK_SECRET));

    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, 'applied');
    assert.equal(await status(id), 'paid');
    assert.ok(await canRead(reader, bookId));
  });

  it('rejects forged, unsigned and stale webhooks without granting anything', async () => {
    const bookId = await createBook(publisherId, { priceCents: 700 });
    const id = (await checkout(reader, [bookId])).body.transaction.id;
    const raw = webhook(id, paymentFor(700));
    const stale = new Date(Date.now() - 10 * 60 * 1000);

    for (const signature of [
      undefined,
      signWebhook(raw, 'attacker-guessed-secret'),
      signWebhook(raw, env.SIMULATED_WEBHOOK_SECRET, stale),
    ]) {
      const res = await postWebhook(raw, signature);
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_SIGNATURE');
    }

    // A valid signature over a different body does not transfer.
    const other = webhook(id, paymentFor(700));
    const res = await postWebhook(raw, signWebhook(other, env.SIMULATED_WEBHOOK_SECRET));
    assert.equal(res.status, 401);

    assert.equal(await status(id), 'pending');
    assert.equal(await canRead(reader, bookId), false);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM payment_events');
    assert.equal(rows[0].n, 0);
  });

  it('processes a replayed or concurrently duplicated event exactly once', async () => {
    const bookId = await createBook(publisherId, { priceCents: 700 });
    const id = (await checkout(reader, [bookId])).body.transaction.id;
    const raw = webhook(id, paymentFor(700));
    const signature = signWebhook(raw, env.SIMULATED_WEBHOOK_SECRET);

    const results = await Promise.all([1, 2, 3].map(() => postWebhook(raw, signature)));
    const replay = await postWebhook(raw, signature);

    const outcomes = [...results, replay].map((res) => res.body.outcome).sort();
    assert.deepEqual(outcomes, ['applied', 'duplicate', 'duplicate', 'duplicate']);

    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM payment_events)::int AS events,
              (SELECT COUNT(*) FROM entitlements)::int AS entitlements`,
    );
    assert.deepEqual(rows[0], { events: 1, entitlements: 1 });
  });

  it('withholds access when the provider reports a different amount', async () => {
    const bookId = await createBook(publisherId, { priceCents: 1299 });
    const id = (await checkout(reader, [bookId])).body.transaction.id;

    const res = await sandbox(reader, id, { kind: 'payment_succeeded', overrideTotalCents: 1 });
    assert.match(res.body.result.detail, /withheld/);

    const { rows } = await pool.query(
      'SELECT status, review_reason FROM transactions WHERE id = $1',
      [id],
    );
    assert.equal(rows[0].status, 'paid');
    assert.match(rows[0].review_reason, /amount mismatch/);
    assert.equal(await canRead(reader, bookId), false);
  });

  it('records an event for an unknown transaction without failing the delivery', async () => {
    const raw = webhook(randomUUID(), paymentFor(700));
    const res = await postWebhook(raw, signWebhook(raw, env.SIMULATED_WEBHOOK_SECRET));
    assert.equal(res.status, 200);
    assert.equal(res.body.outcome, 'ignored');
  });

  it('only accepts webhooks for the active provider', async () => {
    const res = await fetch(`${server.baseUrl}/webhooks/paddle`, { method: 'POST', body: '{}' });
    assert.equal(res.status, 404);
  });

  it("does not let a user drive the sandbox for someone else's transaction", async () => {
    const bookId = await createBook(publisherId);
    const id = (await checkout(reader, [bookId])).body.transaction.id;
    const intruder = await createUser();

    const res = await sandbox(intruder, id, { kind: 'payment_succeeded' });
    assert.equal(res.status, 404);
    assert.equal(await status(id), 'pending');
  });
});

describe('transaction lifecycle (spec Appendix A)', () => {
  it('honours a payment that succeeds after a failed attempt', async () => {
    const bookId = await createBook(publisherId);
    const id = (await checkout(reader, [bookId])).body.transaction.id;

    await sandbox(reader, id, { kind: 'payment_failed' });
    assert.equal(await status(id), 'failed');

    await sandbox(reader, id, { kind: 'payment_succeeded' });
    assert.equal(await status(id), 'paid');
    assert.ok(await canRead(reader, bookId));
  });

  it('ignores a late failure event after payment', async () => {
    const bookId = await createBook(publisherId);
    const id = await buy(api, reader.token, [bookId]);

    const res = await sandbox(reader, id, { kind: 'payment_failed' });
    assert.equal(res.body.result.outcome, 'ignored');
    assert.equal(await status(id), 'paid');
    assert.ok(await canRead(reader, bookId));
  });

  it('never pays a cancelled checkout', async () => {
    const bookId = await createBook(publisherId);
    const id = (await checkout(reader, [bookId])).body.transaction.id;

    await sandbox(reader, id, { kind: 'checkout_cancelled' });
    const late = await sandbox(reader, id, { kind: 'payment_succeeded' });

    assert.equal(late.body.result.outcome, 'ignored');
    assert.equal(await status(id), 'cancelled');
    assert.equal(await canRead(reader, bookId), false);
  });

  it('flags a second paid checkout for a book already owned, without a second grant', async () => {
    const bookId = await createBook(publisherId);
    const first = (await checkout(reader, [bookId])).body.transaction.id;
    const second = (await checkout(reader, [bookId])).body.transaction.id;

    await sandbox(reader, first, { kind: 'payment_succeeded' });
    await sandbox(reader, second, { kind: 'payment_succeeded' });

    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM entitlements WHERE status = 'active')::int AS active,
              (SELECT review_reason FROM transactions WHERE id = $1) AS review`,
      [second],
    );
    assert.equal(rows[0].active, 1);
    assert.match(rows[0].review, /duplicate purchase/);
  });
});

describe('refunds and chargebacks (spec 13.1 #4)', () => {
  it('revokes access on a full refund but keeps history and annotations', async () => {
    const bookId = await createBook(publisherId);
    const id = await buy(api, reader.token, [bookId]);
    await api('POST', `/library/${bookId}/bookmarks`, {
      token: reader.token,
      body: { location: 'epubcfi(/6/2!/4/2/1)' },
    });

    const res = await sandbox(reader, id, { kind: 'refund' });
    assert.equal(res.body.result.outcome, 'applied');
    assert.equal(await status(id), 'refunded');

    assert.equal(await canRead(reader, bookId), false);
    const library = await api('GET', '/library', { token: reader.token });
    assert.deepEqual(library.body.books, []);

    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM bookmarks)::int AS bookmarks,
              (SELECT status FROM entitlements) AS entitlement,
              (SELECT revocation_reason FROM entitlements) AS reason`,
    );
    assert.deepEqual(rows[0], { bookmarks: 1, entitlement: 'revoked', reason: 'refund' });

    // The receipt still exists and shows the refund.
    const receipt = await api('GET', `/transactions/${id}`, { token: reader.token });
    assert.equal(receipt.body.transaction.status, 'refunded');
    assert.equal(receipt.body.transaction.items[0].refunded, true);
  });

  it('lets a refunded customer buy the book again', async () => {
    const bookId = await createBook(publisherId);
    const first = await buy(api, reader.token, [bookId]);
    await sandbox(reader, first, { kind: 'refund' });

    await buy(api, reader.token, [bookId]);
    assert.ok(await canRead(reader, bookId));
  });

  it('refunds one book of a multi-book purchase', async () => {
    const keep = await createBook(publisherId, { priceCents: 500 });
    const refund = await createBook(publisherId, { priceCents: 900 });
    const id = await buy(api, reader.token, [keep, refund]);

    await sandbox(reader, id, { kind: 'refund', bookIds: [refund] });

    assert.equal(await status(id), 'partially_refunded');
    assert.ok(await canRead(reader, keep));
    assert.equal(await canRead(reader, refund), false);
  });

  it('keeps access after a partial (goodwill) refund', async () => {
    const bookId = await createBook(publisherId, { priceCents: 1000 });
    const id = await buy(api, reader.token, [bookId]);

    await sandbox(reader, id, { kind: 'refund', partialAmountCents: 300 });

    assert.equal(await status(id), 'partially_refunded');
    assert.ok(await canRead(reader, bookId));
    const { rows } = await pool.query('SELECT refunded_cents FROM transaction_items');
    assert.equal(Number(rows[0].refunded_cents), 300);
  });

  it('applies the same refund adjustment only once', async () => {
    const bookId = await createBook(publisherId, { priceCents: 1000 });
    const id = await buy(api, reader.token, [bookId]);
    const { rows: items } = await pool.query(
      'SELECT provider_line_item_id FROM transaction_items WHERE transaction_id = $1',
      [id],
    );
    const refund = {
      kind: 'refund',
      adjustmentId: 'adj_same',
      lines: [
        { providerLineItemId: items[0].provider_line_item_id, full: false, amountCents: 300 },
      ],
    };

    // Same adjustment, two different events (as with created + updated).
    for (const eventId of ['first', 'second']) {
      const raw = webhook(id, refund, eventId);
      await postWebhook(raw, signWebhook(raw, env.SIMULATED_WEBHOOK_SECRET));
    }

    const { rows } = await pool.query('SELECT refunded_cents FROM transaction_items');
    assert.equal(Number(rows[0].refunded_cents), 300);
  });

  it('keeps access during a dispute, restores state if won, revokes if lost', async () => {
    const won = await createBook(publisherId);
    const lost = await createBook(publisherId);
    const wonId = await buy(api, reader.token, [won]);
    const lostId = await buy(api, reader.token, [lost]);

    await sandbox(reader, wonId, { kind: 'dispute_opened' });
    assert.equal(await status(wonId), 'disputed');
    assert.ok(await canRead(reader, won));
    await sandbox(reader, wonId, { kind: 'dispute_won' });
    assert.equal(await status(wonId), 'paid');

    await sandbox(reader, lostId, { kind: 'dispute_opened' });
    await sandbox(reader, lostId, { kind: 'chargeback' });
    assert.equal(await status(lostId), 'refunded');
    assert.equal(await canRead(reader, lost), false);
    assert.ok(await canRead(reader, won));
  });
});

describe('publisher sales figures', () => {
  it('count paid sales and drop fully refunded ones', async () => {
    const staff = await createUser({ role: 'publisher', publisherId });
    const bookId = await createBook(publisherId, { priceCents: 1000 });
    const other = await createUser();

    const paid = await buy(api, reader.token, [bookId]);
    const refunded = await buy(api, other.token, [bookId]);
    await checkout(await createUser(), [bookId]); // pending: not a sale
    await sandbox(other, refunded, { kind: 'refund' });
    assert.equal(await status(paid), 'paid');

    const stats = await api('GET', '/publisher/stats', { token: staff.token });
    assert.equal(stats.body.stats.totalCopiesSold, 1);
    assert.equal(stats.body.stats.totalRevenueCents, 1000);
  });
});

describe('purchase history', () => {
  it("never shows one user's transactions to another", async () => {
    const bookId = await createBook(publisherId);
    const id = await buy(api, reader.token, [bookId]);
    const other = await createUser();

    const list = await api('GET', '/transactions', { token: other.token });
    assert.deepEqual(list.body.transactions, []);
    assert.equal((await api('GET', `/transactions/${id}`, { token: other.token })).status, 404);

    const own = await api('GET', `/transactions/${id}`, { token: reader.token });
    assert.equal(own.status, 200);
    assert.equal(own.body.transaction.checkoutUrl, null);
  });
});
