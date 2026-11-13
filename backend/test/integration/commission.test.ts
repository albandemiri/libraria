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
 * Platform commission (docs/superpowers/specs/2026-11-13-platform-commission-design.md):
 * per-publisher dated rates, snapshotted on each sale, split on payment and
 * reversed on refunds.
 */

let server: TestServer;
let api: Api;
let reader: TestUser;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  reader = await createUser();
});

after(async () => {
  await server.close();
});

async function checkout(user: TestUser, bookIds: string[]) {
  return api('POST', '/checkout-sessions', { token: user.token, body: { bookIds } });
}

async function itemRates(transactionId: string): Promise<Record<string, number>> {
  const { rows } = await pool.query(
    'SELECT book_id, commission_rate_bps FROM transaction_items WHERE transaction_id = $1',
    [transactionId],
  );
  return Object.fromEntries(rows.map((row) => [row.book_id, row.commission_rate_bps]));
}

async function sandbox(transactionId: string, body: Record<string, unknown>) {
  const res = await api('POST', `/sandbox/transactions/${transactionId}/events`, {
    token: reader.token,
    body,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
}

/** Settles a pending checkout with a signed webhook reporting exact totals. */
async function settle(transactionId: string, cents: number, fee: number | null = 0) {
  const raw = Buffer.from(
    JSON.stringify({
      providerEventId: `evt_${randomUUID()}`,
      eventType: 'simulated.payment_succeeded',
      occurredAt: new Date().toISOString(),
      providerTransactionId: null,
      internalTransactionId: transactionId,
      event: {
        kind: 'payment_succeeded',
        totals: {
          currency: 'EUR',
          subtotalCents: cents,
          taxCents: 0,
          totalCents: cents,
          feeCents: fee,
          earningsCents: fee === null ? null : cents - fee,
        },
        lineItems: [],
      },
    }),
  );
  const res = await fetch(`${server.baseUrl}/webhooks/simulated`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [SIMULATED_SIGNATURE_HEADER]: signWebhook(raw, env.SIMULATED_WEBHOOK_SECRET),
    },
    body: new Uint8Array(raw),
  });
  const body = await res.json();
  assert.equal(body.outcome, 'applied', JSON.stringify(body));
}

/** Checks out one book and settles it at its price with no tax or fee. */
async function sellAtNet(bookId: string, cents: number, fee: number | null = 0) {
  const res = await checkout(reader, [bookId]);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await settle(res.body.transaction.id, cents, fee);
  return res.body.transaction.id as string;
}

interface Shares {
  rate: number | null;
  platform: number | null;
  publisher: number | null;
  platformReversed: number;
  publisherReversed: number;
}

async function shares(transactionId: string, bookId: string): Promise<Shares> {
  const { rows } = await pool.query(
    `SELECT commission_rate_bps, platform_commission_cents, publisher_earnings_cents,
            platform_commission_reversed_cents, publisher_earnings_reversed_cents
       FROM transaction_items WHERE transaction_id = $1 AND book_id = $2`,
    [transactionId, bookId],
  );
  const row = rows[0];
  const num = (value: string | null) => (value === null ? null : Number(value));
  return {
    rate: row.commission_rate_bps,
    platform: num(row.platform_commission_cents),
    publisher: num(row.publisher_earnings_cents),
    platformReversed: Number(row.platform_commission_reversed_cents),
    publisherReversed: Number(row.publisher_earnings_reversed_cents),
  };
}

async function transactionCount(): Promise<number> {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM transactions');
  return rows[0].n;
}

describe('commission rate at checkout', () => {
  it('snapshots the publisher rate in force on each item', async () => {
    const a = await createBook(await createPublisher(undefined, { commissionBps: 2000 }));
    const b = await createBook(await createPublisher(undefined, { commissionBps: 1500 }));

    const res = await checkout(reader, [a, b]);
    assert.equal(res.status, 201);
    assert.deepEqual(await itemRates(res.body.transaction.id), { [a]: 2000, [b]: 1500 });
  });

  it('refuses checkout when a publisher has no rate', async () => {
    const book = await createBook(await createPublisher(undefined, { commissionBps: null }));

    const res = await checkout(reader, [book]);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'BOOK_NOT_FOR_SALE');
    assert.equal(await transactionCount(), 0);
  });

  it('refuses the whole cart if any publisher lacks a rate', async () => {
    const priced = await createBook(await createPublisher());
    const unpriced = await createBook(await createPublisher(undefined, { commissionBps: null }));

    const res = await checkout(reader, [priced, unpriced]);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'BOOK_NOT_FOR_SALE');
    assert.equal(await transactionCount(), 0);
  });

  it('ignores a rate scheduled for the future', async () => {
    const publisherId = await createPublisher(undefined, { commissionBps: 2000 });
    await pool.query(
      `INSERT INTO publisher_commission_rates (publisher_id, rate_bps, effective_from)
       VALUES ($1, 500, CURRENT_TIMESTAMP + interval '1 day')`,
      [publisherId],
    );
    const book = await createBook(publisherId);

    const res = await checkout(reader, [book]);
    assert.equal(res.status, 201);
    assert.deepEqual(await itemRates(res.body.transaction.id), { [book]: 2000 });
  });
});

describe('commission on sales', () => {
  it('splits net between Libraria and the publisher at the snapshotted rate', async () => {
    const book = await createBook(await createPublisher(), { priceCents: 1000 });
    const id = await sellAtNet(book, 1000);

    assert.deepEqual(await shares(id, book), {
      rate: 2000,
      platform: 200,
      publisher: 800,
      platformReversed: 0,
      publisherReversed: 0,
    });
  });

  it('accounts for every cent of every item', async () => {
    const a = await createBook(await createPublisher(), { priceCents: 999 });
    const b = await createBook(await createPublisher(undefined, { commissionBps: 1500 }), {
      priceCents: 1299,
    });
    // Default sandbox totals: VAT-inclusive prices and a 5% + 50c fee.
    const id = await buy(api, reader.token, [a, b]);

    const { rows } = await pool.query(
      `SELECT unit_price_cents, tax_cents, provider_fee_cents,
              platform_commission_cents, publisher_earnings_cents
         FROM transaction_items WHERE transaction_id = $1`,
      [id],
    );
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.ok(Number(row.platform_commission_cents) > 0);
      assert.equal(
        Number(row.tax_cents) +
          Number(row.provider_fee_cents) +
          Number(row.platform_commission_cents) +
          Number(row.publisher_earnings_cents),
        Number(row.unit_price_cents),
      );
    }
  });

  it('keeps past sales at their old rate after a contract change', async () => {
    const publisherId = await createPublisher();
    const a = await createBook(publisherId, { priceCents: 1000 });
    const b = await createBook(publisherId, { priceCents: 1000 });

    const first = await sellAtNet(a, 1000);
    await pool.query(
      `INSERT INTO publisher_commission_rates (publisher_id, rate_bps, effective_from)
       VALUES ($1, 1000, CURRENT_TIMESTAMP)`,
      [publisherId],
    );
    const second = await sellAtNet(b, 1000);

    const before = await shares(first, a);
    assert.equal(before.rate, 2000);
    assert.equal(before.platform, 200);
    assert.equal(before.publisher, 800);
    const after = await shares(second, b);
    assert.equal(after.rate, 1000);
    assert.equal(after.platform, 100);
    assert.equal(after.publisher, 900);
  });

  it('leaves shares null when the provider fee is unreported', async () => {
    const book = await createBook(await createPublisher(), { priceCents: 1000 });
    const id = await sellAtNet(book, 1000, null);

    const result = await shares(id, book);
    assert.equal(result.platform, null);
    assert.equal(result.publisher, null);
    const { rows } = await pool.query(
      'SELECT status, review_reason FROM transactions WHERE id = $1',
      [id],
    );
    assert.equal(rows[0].status, 'paid');
    // Never a silent 0%: a person must see that this sale was not split.
    assert.match(rows[0].review_reason ?? '', /commission not split/);
  });

  it('reverses both shares on a full refund', async () => {
    const book = await createBook(await createPublisher(), { priceCents: 1000 });
    const id = await sellAtNet(book, 1000);
    await sandbox(id, { kind: 'refund' });

    const result = await shares(id, book);
    assert.equal(result.platformReversed, 200);
    assert.equal(result.publisherReversed, 800);
  });

  it('reverses shares proportionally across several partial refunds without drift', async () => {
    const book = await createBook(await createPublisher(), { priceCents: 1000 });
    const id = await sellAtNet(book, 1000);

    await sandbox(id, { kind: 'refund', partialAmountCents: 300 });
    await sandbox(id, { kind: 'refund', partialAmountCents: 300 });
    let result = await shares(id, book);
    assert.equal(result.platformReversed, 120);
    assert.equal(result.publisherReversed, 480);

    await sandbox(id, { kind: 'refund' });
    result = await shares(id, book);
    assert.equal(result.platformReversed, 200);
    assert.equal(result.publisherReversed, 800);
  });

  it('reverses everything on a lost chargeback', async () => {
    const book = await createBook(await createPublisher(), { priceCents: 1000 });
    const id = await sellAtNet(book, 1000);
    await sandbox(id, { kind: 'chargeback' });

    const result = await shares(id, book);
    assert.equal(result.platformReversed, 200);
    assert.equal(result.publisherReversed, 800);
  });
});

describe('commission rates API', () => {
  const ratesPath = (publisherId: string) => `/admin/publishers/${publisherId}/commission-rates`;

  it('lets an admin add a dated rate and list the history', async () => {
    const admin = await createUser({ role: 'admin' });
    const publisherId = await createPublisher();

    const created = await api('POST', ratesPath(publisherId), {
      token: admin.token,
      body: { rateBps: 1500, contractReference: 'Contract 2026/7' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.rate.rateBps, 1500);
    assert.equal(created.body.rate.inForce, true);

    const list = await api('GET', ratesPath(publisherId), { token: admin.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.publisherId, publisherId);
    assert.deepEqual(
      list.body.rates.map((rate: { rateBps: number; inForce: boolean }) => [
        rate.rateBps,
        rate.inForce,
      ]),
      [
        [1500, true],
        [2000, false],
      ],
    );
  });

  it('refuses non-admins', async () => {
    const publisherId = await createPublisher();
    const staff = await createUser({ role: 'publisher', publisherId });

    for (const token of [staff.token, reader.token]) {
      const res = await api('POST', ratesPath(publisherId), { token, body: { rateBps: 0 } });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
    const anonymous = await api('POST', ratesPath(publisherId), { body: { rateBps: 0 } });
    assert.equal(anonymous.status, 401);
  });

  it('returns 404 for an unknown publisher and 409 for a duplicate start date', async () => {
    const admin = await createUser({ role: 'admin' });
    const unknown = randomUUID();

    const missing = await api('POST', ratesPath(unknown), {
      token: admin.token,
      body: { rateBps: 2000 },
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
    const missingList = await api('GET', ratesPath(unknown), { token: admin.token });
    assert.equal(missingList.status, 404);

    const publisherId = await createPublisher(); // has a rate from 2020-01-01
    const duplicate = await api('POST', ratesPath(publisherId), {
      token: admin.token,
      body: { rateBps: 1000, effectiveFrom: '2020-01-01T00:00:00Z' },
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error.code, 'COMMISSION_RATE_EXISTS');
  });

  it('shows a publisher only their own contract', async () => {
    const own = await createPublisher();
    const other = await createPublisher(undefined, { commissionBps: 900 });
    const staff = await createUser({ role: 'publisher', publisherId: own });

    const res = await api('GET', `/publisher/contract?publisherId=${other}`, {
      token: staff.token,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.publisherId, own);
    assert.equal(res.body.current.rateBps, 2000);
    assert.equal(res.body.history.length, 1);
    assert.equal(JSON.stringify(res.body).includes('createdBy'), false);
  });

  it('returns current: null for a publisher without a rate', async () => {
    const publisherId = await createPublisher(undefined, { commissionBps: null });
    const staff = await createUser({ role: 'publisher', publisherId });

    const res = await api('GET', '/publisher/contract', { token: staff.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.current, null);
    assert.deepEqual(res.body.history, []);
  });
});

describe('publisher earnings in portal stats', () => {
  it('reports publisher earnings and Libraria commission in stats', async () => {
    const publisherId = await createPublisher();
    const staff = await createUser({ role: 'publisher', publisherId });
    const kept = await createBook(publisherId, { priceCents: 1000 });
    const refunded = await createBook(publisherId, { priceCents: 1000 });
    const feeUnknown = await createBook(publisherId, { priceCents: 1000 });

    await sellAtNet(kept, 1000);
    await sandbox(await sellAtNet(refunded, 1000), { kind: 'refund' });
    await sellAtNet(feeUnknown, 1000, null);

    const stats = await api('GET', '/publisher/stats', { token: staff.token });
    assert.equal(stats.status, 200);
    assert.equal(stats.body.stats.totalEarningsCents, 800);
    assert.equal(stats.body.stats.totalPlatformCommissionCents, 200);

    const books = await api('GET', '/publisher/books', { token: staff.token });
    const byId = new Map(
      books.body.books.map((book: { id: string; metrics: { earningsCents: number } }) => [
        book.id,
        book.metrics.earningsCents,
      ]),
    );
    assert.equal(byId.get(kept), 800);
    assert.equal(byId.get(refunded), 0);
    assert.equal(byId.get(feeUnknown), 0);
  });
});

describe('storefront availability', () => {
  it('marks books of publishers without a rate as not for sale', async () => {
    const priced = await createBook(await createPublisher());
    const unpriced = await createBook(await createPublisher(undefined, { commissionBps: null }));
    const later = await createPublisher(undefined, {
      effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const notYet = await createBook(later);

    const list = await api('GET', '/books');
    const forSale = new Map(
      list.body.books.map((book: { id: string; forSale: boolean }) => [book.id, book.forSale]),
    );
    assert.equal(forSale.get(priced), true);
    assert.equal(forSale.get(unpriced), false);
    assert.equal(forSale.get(notYet), false);

    const detail = await api('GET', `/books/${unpriced}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.book.forSale, false);
    assert.equal((await api('GET', `/books/${priced}`)).body.book.forSale, true);
  });
});

describe('commission edge cases', () => {
  it('returns 404 when an admin asks for the contract of an unknown publisher', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await api('GET', `/publisher/contract?publisherId=${randomUUID()}`, {
      token: admin.token,
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('reverses only the refunded line of a multi-book order', async () => {
    const a = await createBook(await createPublisher(), { priceCents: 1000 });
    const b = await createBook(await createPublisher(), { priceCents: 1000 });
    // Default sandbox payment: reports per-line items, so refunds map to lines.
    const id = await buy(api, reader.token, [a, b]);

    await sandbox(id, { kind: 'refund', bookIds: [b] });
    const kept = await shares(id, a);
    const gone = await shares(id, b);
    assert.deepEqual([kept.platformReversed, kept.publisherReversed], [0, 0]);
    assert.ok((gone.platform ?? 0) > 0);
    assert.deepEqual(
      [gone.platformReversed, gone.publisherReversed],
      [gone.platform, gone.publisher],
    );
  });

  it('keeps partial-refund reversals when a later dispute is won', async () => {
    const book = await createBook(await createPublisher(), { priceCents: 1000 });
    const id = await sellAtNet(book, 1000);
    await sandbox(id, { kind: 'refund', partialAmountCents: 300 });
    await sandbox(id, { kind: 'dispute_opened' });
    await sandbox(id, { kind: 'dispute_won' });

    const result = await shares(id, book);
    assert.deepEqual([result.platformReversed, result.publisherReversed], [60, 240]);
    const { rows } = await pool.query('SELECT status FROM transactions WHERE id = $1', [id]);
    assert.equal(rows[0].status, 'partially_refunded');
  });

  it('gives Libraria nothing when the fee exceeds the price', async () => {
    const book = await createBook(await createPublisher(), { priceCents: 50 });
    const id = await sellAtNet(book, 50, 70);

    const result = await shares(id, book);
    assert.equal(result.platform, 0);
    assert.equal(result.publisher, -20);
  });

  it('shows per-book earnings on the publisher book detail', async () => {
    const publisherId = await createPublisher();
    const staff = await createUser({ role: 'publisher', publisherId });
    const book = await createBook(publisherId, { priceCents: 1000 });
    await sellAtNet(book, 1000);

    const res = await api('GET', `/publisher/books/${book}`, { token: staff.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.book.metrics.earningsCents, 800);
  });
});
