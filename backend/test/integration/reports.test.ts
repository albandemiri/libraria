import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
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
import { env } from '../../src/config/env';
import { exportLimits } from '../../src/routes/reports';

/** Publisher portal reporting data (docs/superpowers/specs/2026-11-13-publisher-portal-design.md). */

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

/** Buyer token per transaction, so sandbox events act as the owner. */
const owners = new Map<string, string>();

async function sandbox(transactionId: string, body: Record<string, unknown>) {
  const res = await api('POST', `/sandbox/transactions/${transactionId}/events`, {
    token: owners.get(transactionId) ?? reader.token,
    body,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res;
}

/** Checks out one book, pays it in the sandbox, returns status and stored country. */
async function sell(extra: Record<string, unknown>) {
  const book = await createBook(await createPublisher(), { priceCents: 1000 });
  const res = await api('POST', '/checkout-sessions', {
    token: reader.token,
    body: { bookIds: [book] },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id: string = res.body.transaction.id;
  await sandbox(id, { kind: 'payment_succeeded', ...extra });
  const { rows } = await pool.query(
    'SELECT status, customer_country FROM transactions WHERE id = $1',
    [id],
  );
  return rows[0] as { status: string; customer_country: string | null };
}

describe('buyer country on sales', () => {
  it('defaults the sandbox buyer to DE', async () => {
    assert.deepEqual(await sell({}), { status: 'paid', customer_country: 'DE' });
  });

  it('normalises a lower-case country code', async () => {
    assert.deepEqual(await sell({ countryCode: 'al' }), {
      status: 'paid',
      customer_country: 'AL',
    });
  });

  it('stores NULL when the country is unknown', async () => {
    assert.deepEqual(await sell({ countryCode: null }), {
      status: 'paid',
      customer_country: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Reporting rules
// ---------------------------------------------------------------------------

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

interface SaleOptions {
  fee?: number | null;
  paidAt?: string;
  countryCode?: string | null;
}

/** Sells one book at exactly `cents` (no tax) and returns the transaction id. */
async function sellAtNet(bookId: string, cents: number, options: SaleOptions = {}) {
  const buyer = await createUser();
  const res = await api('POST', '/checkout-sessions', {
    token: buyer.token,
    body: { bookIds: [bookId] },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const id: string = res.body.transaction.id;
  owners.set(id, buyer.token);
  await settle(id, cents, options.fee === undefined ? 0 : options.fee);
  const country = options.countryCode === undefined ? 'DE' : options.countryCode;
  await pool.query('UPDATE transactions SET customer_country = $2 WHERE id = $1', [id, country]);
  if (options.paidAt) {
    await pool.query('UPDATE transactions SET paid_at = $2 WHERE id = $1', [id, options.paidAt]);
  }
  return id;
}

async function staff(publisherId: string) {
  return createUser({ role: 'publisher', publisherId });
}

const KEYS = [
  'grossCents',
  'refundsCents',
  'taxCents',
  'feeCents',
  'netCents',
  'commissionAtSaleCents',
  'commissionReversedCents',
  'commissionCents',
  'unsplitCents',
  'earningsAtSaleCents',
  'earningsReversedCents',
  'earningsCents',
  'copies',
  'refundedCopies',
] as const;

describe('GET /publisher/reports', () => {
  it('summary totals and series for a month', async () => {
    const publisher = await createPublisher();
    const book = await createBook(publisher, { priceCents: 1000 });
    await sellAtNet(book, 1000, { paidAt: '2026-11-03T10:00:00Z' });
    await sellAtNet(book, 1000, { paidAt: '2026-11-03T15:00:00Z' });
    await sellAtNet(book, 1000, { paidAt: '2026-11-20T10:00:00Z' });
    const owner = await staff(publisher);

    const res = await api(
      'GET',
      '/publisher/reports/summary?from=2026-10-01&to=2026-12-31&granularity=month',
      { token: owner.token },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.totals.grossCents, 3000);
    assert.equal(res.body.totals.earningsCents, 2400);
    assert.equal(res.body.totals.copies, 3);
    assert.deepEqual(
      res.body.series.map((p: { periodStart: string; copies: number; grossCents: number }) => [
        p.periodStart,
        p.copies,
        p.grossCents,
      ]),
      [
        ['2026-10-01', 0, 0],
        ['2026-11-01', 3, 3000],
        ['2026-12-01', 0, 0],
      ],
    );
  });

  it('UTC month edge', async () => {
    const publisher = await createPublisher();
    const book = await createBook(publisher, { priceCents: 1000 });
    await sellAtNet(book, 1000, { paidAt: '2026-11-30T23:30:00Z' });
    const owner = await staff(publisher);

    const nov = await api('GET', '/publisher/reports/summary?from=2026-11-01&to=2026-12-01', {
      token: owner.token,
    });
    const dec = await api('GET', '/publisher/reports/summary?from=2026-12-01&to=2027-01-01', {
      token: owner.token,
    });
    assert.equal(nov.body.totals.copies, 1);
    assert.equal(dec.body.totals.copies, 0);
  });

  it('earnings breakdown adds up after refunds and pending splits', async () => {
    const publisher = await createPublisher();
    const fullyRefunded = await createBook(publisher, { priceCents: 1000 });
    const partlyRefunded = await createBook(publisher, { priceCents: 1000 });
    const pending = await createBook(publisher, { priceCents: 1000 });
    const paidAt = '2026-11-05T10:00:00Z';
    const a = await sellAtNet(fullyRefunded, 1000, { fee: 50, paidAt });
    const b = await sellAtNet(partlyRefunded, 1000, { fee: 50, paidAt });
    await sellAtNet(pending, 1000, { fee: null, paidAt });
    await sandbox(a, { kind: 'refund' });
    await sandbox(b, { kind: 'refund', partialAmountCents: 300 });
    const owner = await staff(publisher);

    const res = await api('GET', '/publisher/reports/summary?from=2026-11-01&to=2026-12-01', {
      token: owner.token,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const t = res.body.totals;
    assert.equal(t.grossCents - t.taxCents - t.feeCents, t.netCents);
    assert.equal(t.netCents, t.commissionAtSaleCents + t.unsplitCents + t.earningsAtSaleCents);
    assert.equal(t.earningsCents, t.earningsAtSaleCents - t.earningsReversedCents);
    assert.equal(t.commissionCents, t.commissionAtSaleCents - t.commissionReversedCents);
    assert.equal(t.refundedCopies, 1);
    assert.equal(t.copies, 2, 'a fully refunded item is not a copy');
    assert.equal(t.refundsCents, 1300);
    assert.ok(t.unsplitCents > 0, 'the fee-less sale is unsplit');
  });

  it('by-book and by-country rows sum to the totals', async () => {
    const publisher = await createPublisher();
    const big = await createBook(publisher, { priceCents: 2000, title: 'Big' });
    const small = await createBook(publisher, { priceCents: 1000, title: 'Small' });
    const paidAt = '2026-11-05T10:00:00Z';
    await sellAtNet(big, 2000, { countryCode: 'AL', paidAt });
    await sellAtNet(big, 2000, { countryCode: 'XK', paidAt });
    await sellAtNet(small, 1000, { countryCode: null, paidAt });
    const refunded = await sellAtNet(small, 1000, { countryCode: 'AL', paidAt, fee: null });
    await sandbox(refunded, { kind: 'refund', partialAmountCents: 300 });
    const owner = await staff(publisher);
    const q = '?from=2026-11-01&to=2026-12-01';

    const summary = await api('GET', `/publisher/reports/summary${q}`, { token: owner.token });
    const byBook = await api('GET', `/publisher/reports/by-book${q}`, { token: owner.token });
    const byCountry = await api('GET', `/publisher/reports/by-country${q}`, {
      token: owner.token,
    });
    assert.equal(byBook.status, 200, JSON.stringify(byBook.body));
    assert.equal(byCountry.status, 200, JSON.stringify(byCountry.body));

    assert.deepEqual(
      byBook.body.rows.map((r: { book: { title: string } }) => r.book.title),
      ['Big', 'Small'],
    );
    assert.deepEqual(
      byCountry.body.rows.map((r: { country: string | null }) => r.country),
      ['AL', 'XK', null],
    );
    for (const key of KEYS) {
      const sum = (rows: Record<string, number>[]) => rows.reduce((acc, row) => acc + row[key], 0);
      assert.equal(sum(byBook.body.rows), summary.body.totals[key], `by-book ${key}`);
      assert.equal(sum(byCountry.body.rows), summary.body.totals[key], `by-country ${key}`);
    }
  });

  it("never shows another publisher's sales", async () => {
    const a = await createPublisher();
    const b = await createPublisher();
    await sellAtNet(await createBook(a, { priceCents: 1000 }), 1000, {
      paidAt: '2026-11-05T10:00:00Z',
    });
    await sellAtNet(await createBook(b, { priceCents: 2000 }), 2000, {
      paidAt: '2026-11-05T10:00:00Z',
    });
    const staffA = await staff(a);
    const q = '?from=2026-11-01&to=2026-12-01';

    const spoof = await api('GET', `/publisher/reports/summary${q}&publisherId=${b}`, {
      token: staffA.token,
    });
    assert.equal(spoof.body.totals.grossCents, 1000);

    const admin = await createUser({ role: 'admin' });
    const noScope = await api('GET', `/publisher/reports/summary${q}`, { token: admin.token });
    assert.equal(noScope.status, 400);
    assert.equal(noScope.body.error.code, 'PUBLISHER_ID_REQUIRED');
    const scoped = await api('GET', `/publisher/reports/summary${q}&publisherId=${b}`, {
      token: admin.token,
    });
    assert.equal(scoped.body.totals.grossCents, 2000);

    const asReader = await api('GET', `/publisher/reports/summary${q}`, { token: reader.token });
    assert.equal(asReader.status, 403);
  });

  it('rejects an invalid range', async () => {
    const owner = await staff(await createPublisher());
    const res = await api('GET', '/publisher/reports/by-book?from=2026-12-01&to=2026-11-01', {
      token: owner.token,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  });
});

// ---------------------------------------------------------------------------
// Sales ledger and CSV export
// ---------------------------------------------------------------------------

interface LedgerLine {
  paidAt: string;
  transactionId: string;
  book: { id: string; title: string };
  country: string | null;
  status: string;
  unitPriceCents: number;
  feeCents: number | null;
  commissionRateBps: number | null;
  commissionCents: number;
  earningsCents: number;
  refundedCents: number;
  split: string;
}

const RANGE = '?from=2026-11-01&to=2026-12-01';
const PAID = '2026-11-05T10:00:00Z';

async function csvExport(token: string, query: string) {
  const res = await fetch(`${server.baseUrl}/publisher/reports/sales.csv${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: res.status,
    headers: res.headers,
    text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer()),
  };
}

describe('GET /publisher/reports/sales', () => {
  it('sales lines sum to the summary totals', async () => {
    const publisher = await createPublisher();
    const a = await createBook(publisher, { priceCents: 1000 });
    const b = await createBook(publisher, { priceCents: 2000 });
    await sellAtNet(a, 1000, { fee: 50, paidAt: PAID });
    const refunded = await sellAtNet(b, 2000, { fee: 100, paidAt: PAID, countryCode: 'AL' });
    await sellAtNet(b, 2000, { fee: null, paidAt: '2026-11-06T10:00:00Z', countryCode: null });
    await sandbox(refunded, { kind: 'refund', partialAmountCents: 500 });
    const owner = await staff(publisher);

    const summary = await api('GET', `/publisher/reports/summary${RANGE}`, { token: owner.token });
    const sales = await api('GET', `/publisher/reports/sales${RANGE}&limit=200`, {
      token: owner.token,
    });
    assert.equal(sales.status, 200, JSON.stringify(sales.body));
    const lines: LedgerLine[] = sales.body.lines;
    assert.equal(lines.length, 3);
    assert.deepEqual(sales.body.pagination, { page: 1, limit: 200, total: 3, totalPages: 1 });
    const sum = (key: 'unitPriceCents' | 'earningsCents' | 'commissionCents' | 'refundedCents') =>
      lines.reduce((acc, line) => acc + line[key], 0);
    assert.equal(sum('unitPriceCents'), summary.body.totals.grossCents);
    assert.equal(sum('earningsCents'), summary.body.totals.earningsCents);
    assert.equal(sum('commissionCents'), summary.body.totals.commissionCents);
    assert.equal(sum('refundedCents'), summary.body.totals.refundsCents);
    assert.deepEqual(
      lines.map((l) => l.paidAt.slice(0, 10)),
      ['2026-11-06', '2026-11-05', '2026-11-05'],
    );
  });

  it('paginates deterministically and caps the page size', async () => {
    const publisher = await createPublisher();
    const book = await createBook(publisher, { priceCents: 1000 });
    for (let i = 0; i < 3; i++) await sellAtNet(book, 1000, { paidAt: PAID });
    const owner = await staff(publisher);
    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await api('GET', `/publisher/reports/sales${RANGE}&limit=1&page=${page}`, {
        token: owner.token,
      });
      assert.equal(res.body.pagination.totalPages, 3);
      seen.push(res.body.lines[0].transactionId);
    }
    assert.equal(new Set(seen).size, 3);
    const over = await api('GET', `/publisher/reports/sales${RANGE}&limit=201`, {
      token: owner.token,
    });
    assert.equal(over.status, 400);
  });

  it('a line shows its own book status in a multi-publisher order', async () => {
    const a = await createPublisher();
    const b = await createPublisher();
    const bookA = await createBook(a, { priceCents: 1000 });
    const bookB = await createBook(b, { priceCents: 1000 });
    const id = await buy(api, reader.token, [bookA, bookB]);
    owners.set(id, reader.token);
    await pool.query('UPDATE transactions SET paid_at = $2 WHERE id = $1', [id, PAID]);
    await sandbox(id, { kind: 'refund', bookIds: [bookB] });
    const staffA = await staff(a);
    const staffB = await staff(b);

    const linesA = await api('GET', `/publisher/reports/sales${RANGE}`, { token: staffA.token });
    assert.equal(linesA.body.lines.length, 1);
    assert.equal(linesA.body.lines[0].status, 'paid');
    const summaryA = await api('GET', `/publisher/reports/summary${RANGE}`, {
      token: staffA.token,
    });
    assert.equal(summaryA.body.totals.refundsCents, 0);

    const linesB = await api('GET', `/publisher/reports/sales${RANGE}`, { token: staffB.token });
    assert.equal(linesB.body.lines[0].status, 'refunded');
  });

  it('pending split is labelled', async () => {
    const publisher = await createPublisher();
    const book = await createBook(publisher, { priceCents: 1000 });
    await sellAtNet(book, 1000, { fee: null, paidAt: PAID });
    const owner = await staff(publisher);
    const res = await api('GET', `/publisher/reports/sales${RANGE}`, { token: owner.token });
    const line: LedgerLine = res.body.lines[0];
    assert.equal(line.split, 'pending');
    assert.equal(line.feeCents, null);
    assert.equal(line.commissionRateBps, 2000);
    assert.equal(line.commissionCents, 0);
  });

  it('filters by status, book and unknown country', async () => {
    const publisher = await createPublisher();
    const one = await createBook(publisher, { priceCents: 1000 });
    const two = await createBook(publisher, { priceCents: 1000 });
    const refunded = await sellAtNet(one, 1000, { paidAt: PAID, countryCode: 'AL' });
    await sellAtNet(two, 1000, { paidAt: PAID, countryCode: null });
    await sandbox(refunded, { kind: 'refund' });
    const owner = await staff(publisher);
    const get = async (query: string) =>
      api('GET', `/publisher/reports/sales${RANGE}${query}`, { token: owner.token });

    const byStatus = await get('&status=refunded');
    assert.equal(byStatus.body.lines.length, 1);
    assert.equal(byStatus.body.lines[0].country, 'AL');
    const unknown = await get('&country=unknown');
    assert.equal(unknown.body.lines.length, 1);
    assert.equal(unknown.body.lines[0].country, null);
    const al = await get('&country=al');
    assert.equal(al.body.lines.length, 1);
    const byBook = await get(`&bookId=${two}`);
    assert.equal(byBook.body.lines.length, 1);
    assert.equal(byBook.body.lines[0].book.id, two);
    const badBook = await get('&bookId=not-a-uuid');
    assert.equal(badBook.status, 400);
    assert.equal(badBook.body.error.code, 'VALIDATION_FAILED');
    const badStatus = await get('&status=nope');
    assert.equal(badStatus.status, 400);
  });

  it('breaks ties in by-book and by-country deterministically', async () => {
    const publisher = await createPublisher();
    const zed = await createBook(publisher, { priceCents: 1000, title: 'Zed' });
    const abe = await createBook(publisher, { priceCents: 1000, title: 'Abe' });
    await sellAtNet(zed, 1000, { paidAt: PAID, countryCode: 'XK' });
    await sellAtNet(abe, 1000, { paidAt: PAID, countryCode: 'AL' });
    await sellAtNet(abe, 1000, { paidAt: PAID, countryCode: null });
    const owner = await staff(publisher);
    const byBook = await api('GET', `/publisher/reports/by-book${RANGE}`, { token: owner.token });
    assert.deepEqual(
      byBook.body.rows.map((r: { book: { title: string } }) => r.book.title),
      ['Abe', 'Zed'],
    );
    const byCountry = await api('GET', `/publisher/reports/by-country${RANGE}`, {
      token: owner.token,
    });
    assert.deepEqual(
      byCountry.body.rows.map((r: { country: string | null }) => r.country),
      ['AL', 'XK', null],
    );

    const tied = await createPublisher();
    const x = await createBook(tied, { priceCents: 1000, title: 'Same' });
    const y = await createBook(tied, { priceCents: 1000, title: 'Same' });
    await sellAtNet(x, 1000, { paidAt: PAID });
    await sellAtNet(y, 1000, { paidAt: PAID });
    const tiedOwner = await staff(tied);
    const rows = await api('GET', `/publisher/reports/by-book${RANGE}`, {
      token: tiedOwner.token,
    });
    assert.deepEqual(
      rows.body.rows.map((r: { book: { id: string } }) => r.book.id),
      [x, y].sort(),
    );
  });
});

describe('report hardening', () => {
  it('reports and the CSV are never cached', async () => {
    const publisher = await createPublisher();
    const owner = await staff(publisher);
    const json = await api('GET', `/publisher/reports/summary${RANGE}`, { token: owner.token });
    assert.equal(json.status, 200);
    assert.equal(json.headers.get('cache-control'), 'no-store');
    const csv = await csvExport(owner.token, RANGE);
    assert.equal(csv.status, 200);
    assert.equal(csv.headers.get('cache-control'), 'no-store');
  });

  it('a huge page is a validation error, not a server error', async () => {
    const publisher = await createPublisher();
    const owner = await staff(publisher);
    const res = await api('GET', `/publisher/reports/sales${RANGE}&page=999999999999`, {
      token: owner.token,
    });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  });
});

describe('GET /publisher/reports/sales.csv', () => {
  it('CSV export in Albanian', async () => {
    const publisher = await createPublisher();
    const book = await createBook(publisher, { priceCents: 999, title: 'Tom, "Jerry"' });
    const formula = await createBook(publisher, { priceCents: 999, title: '=SUM(A1)' });
    await sellAtNet(book, 999, { fee: 0, paidAt: PAID });
    await sellAtNet(formula, 999, { fee: 0, paidAt: '2026-11-04T10:00:00Z' });
    const owner = await staff(publisher);

    const res = await csvExport(owner.token, `${RANGE}&lang=sq`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(
      res.headers.get('content-disposition'),
      'attachment; filename="libraria-sales-2026-11-01-2026-12-01.csv"',
    );
    assert.ok(res.text.startsWith('﻿Data e pagesës,'), res.text.slice(0, 40));
    const rows = res.text.slice(1).trimEnd().split('\r\n');
    assert.equal(rows.length, 3);
    assert.ok(rows[1].includes(',"Tom, ""Jerry""",'), rows[1]);
    assert.ok(rows[2].includes(",'=SUM(A1),"), rows[2]);
    assert.ok(rows[1].includes(',9.99,'), rows[1]);
    assert.ok(rows[1].endsWith(',done'), rows[1]);
  });

  it('defaults to English and validates lang', async () => {
    const owner = await staff(await createPublisher());
    const en = await csvExport(owner.token, RANGE);
    assert.ok(en.text.startsWith('﻿Paid at,Transaction ID'), en.text);
    const bad = await csvExport(owner.token, `${RANGE}&lang=fr`);
    assert.equal(bad.status, 400);
  });

  it('CSV export is tenant scoped', async () => {
    const a = await createPublisher();
    const b = await createPublisher();
    await sellAtNet(await createBook(a, { priceCents: 1000, title: 'Mine' }), 1000, {
      paidAt: PAID,
    });
    await sellAtNet(await createBook(b, { priceCents: 1000, title: 'Theirs' }), 1000, {
      paidAt: PAID,
    });
    const staffA = await staff(a);
    const res = await csvExport(staffA.token, `${RANGE}&publisherId=${b}`);
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('Mine'));
    assert.ok(!res.text.includes('Theirs'));
  });

  it('refuses an export over the row cap with EXPORT_TOO_LARGE', async () => {
    const publisher = await createPublisher();
    const book = await createBook(publisher, { priceCents: 1000 });
    await sellAtNet(book, 1000, { paidAt: PAID });
    await sellAtNet(book, 1000, { paidAt: PAID });
    const owner = await staff(publisher);
    const previous = exportLimits.maxRows;
    exportLimits.maxRows = 1;
    try {
      const res = await csvExport(owner.token, RANGE);
      assert.equal(res.status, 422);
      assert.equal(JSON.parse(res.text).error.code, 'EXPORT_TOO_LARGE');
    } finally {
      exportLimits.maxRows = previous;
    }
  });
});
