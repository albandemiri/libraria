import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  type Api,
  type ApiResponse,
  buy,
  client,
  createBook,
  createPublisher,
  createUser,
  pool,
  resetDatabase,
  startTestServer,
  type TestServer,
  type TestUser,
} from './harness';
import bcrypt from 'bcryptjs';
import { app } from '../../src/app';
import { env } from '../../src/config/env';
import { resetRateLimits } from '../../src/middleware/rate-limit';

/** Admin console API: publishers, invites, platform figures, books and readers. */

let server: TestServer;
let api: Api;
let admin: TestUser;

const PASSWORD = 'Sup3r-secret-pw';

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  admin = await createUser({ role: 'admin' });
});

after(async () => {
  await server.close();
});

const code = (res: { body: { error: { code: string } } }) => res.body.error.code;

async function auditRows(action: string) {
  const { rows } = await pool.query(
    'SELECT actor_id, resource_type, resource_id, metadata FROM audit_events WHERE action = $1 ORDER BY id',
    [action],
  );
  return rows as Array<{
    actor_id: string | null;
    resource_type: string;
    resource_id: string;
    metadata: Record<string, unknown>;
  }>;
}

async function newPublisher(name = 'Botimet Drita') {
  const res = await api('POST', '/admin/publishers', {
    token: admin.token,
    body: { name, contactEmail: 'info@drita.test', country: 'AL' },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.publisher as { id: string; name: string };
}

async function invite(publisherId: string, email = 'editor@drita.test', displayName?: string) {
  const res = await api('POST', `/admin/publishers/${publisherId}/invites`, {
    token: admin.token,
    body: { email, ...(displayName ? { displayName } : {}) },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const link: string = res.body.link;
  const token = decodeURIComponent(link.split('#token=')[1]);
  return { invite: res.body.invite, link, token };
}

const accept = (token: string, extra: Record<string, unknown> = {}) =>
  api('POST', '/auth/invites/accept', {
    body: { token, password: PASSWORD, displayName: 'Era Hoxha', ...extra },
  });

const inspect = (token: string) => api('POST', '/auth/invites/inspect', { body: { token } });

/** Waits until `count` backends are blocked on a lock, so a race test is deterministic. */
async function waitForLockWaiters(count: number): Promise<void> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if (Number(rows[0].n) >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`no ${count} backend(s) ever waited on a lock`);
}

// ---------------------------------------------------------------------------
// Publishers
// ---------------------------------------------------------------------------

describe('admin publishers', () => {
  it('creates a publisher, audits it, and lists it with rate, country and book count', async () => {
    const created = await newPublisher();
    assert.equal(created.name, 'Botimet Drita');
    const rows = await auditRows('publisher.created');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_id, admin.id);
    assert.equal(rows[0].resource_id, created.id);

    const withRate = await createPublisher('Ura', { commissionBps: 2500 });
    await createBook(withRate);
    await createBook(withRate, { available: false });

    const res = await api('GET', '/admin/publishers', { token: admin.token });
    assert.equal(res.status, 200);
    const byName = Object.fromEntries(
      res.body.publishers.map((p: { name: string }) => [p.name, p]),
    );
    assert.deepEqual(byName['Botimet Drita'], {
      id: created.id,
      name: 'Botimet Drita',
      country: 'AL',
      contactEmail: 'info@drita.test',
      currentRateBps: null,
      bookCount: 0,
      createdAt: byName['Botimet Drita'].createdAt,
    });
    assert.equal(byName.Ura.currentRateBps, 2500);
    assert.equal(byName.Ura.bookCount, 2);
    assert.equal(byName.Ura.country, null);
    // Sorted by name, and the id/name pair the portal picker uses is intact.
    assert.deepEqual(
      res.body.publishers.map((p: { name: string }) => p.name),
      ['Botimet Drita', 'Ura'],
    );
  });

  it('searches by name, treating the query as literal text', async () => {
    await createPublisher('Alpha Press');
    await createPublisher('100% Books');
    const alpha = await api('GET', '/admin/publishers?q=alph', { token: admin.token });
    assert.deepEqual(
      alpha.body.publishers.map((p: { name: string }) => p.name),
      ['Alpha Press'],
    );
    const percent = await api('GET', `/admin/publishers?q=${encodeURIComponent('%')}`, {
      token: admin.token,
    });
    assert.deepEqual(
      percent.body.publishers.map((p: { name: string }) => p.name),
      ['100% Books'],
    );
  });

  it('validates the body', async () => {
    const post = (body: unknown) => api('POST', '/admin/publishers', { token: admin.token, body });
    assert.equal((await post({ name: '', contactEmail: 'a@b.test', country: 'AL' })).status, 400);
    assert.equal((await post({ name: 'X', contactEmail: 'nope', country: 'AL' })).status, 400);
    assert.equal((await post({ name: 'X', contactEmail: 'a@b.test', country: 'ALB' })).status, 400);
    assert.equal((await post({ name: 'X', contactEmail: 'a@b.test' })).status, 400);
  });

  it('patches fields, audits the change, and refuses an empty patch', async () => {
    const { id } = await newPublisher();
    const res = await api('PATCH', `/admin/publishers/${id}`, {
      token: admin.token,
      body: { name: 'Botimet Drita Sh.p.k.', country: 'xk' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.publisher.name, 'Botimet Drita Sh.p.k.');
    assert.equal(res.body.publisher.country, 'XK');
    assert.equal(res.body.publisher.contactEmail, 'info@drita.test');
    const rows = await auditRows('publisher.updated');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].resource_id, id);

    const empty = await api('PATCH', `/admin/publishers/${id}`, { token: admin.token, body: {} });
    assert.equal(empty.status, 400);
    assert.equal((await auditRows('publisher.updated')).length, 1);
  });

  it('shows team and open invites on the detail page', async () => {
    const { id } = await newPublisher();
    const staff = await createUser({ role: 'publisher', publisherId: id });
    const open = await invite(id, 'open@drita.test', 'Open Person');
    const expired = await invite(id, 'expired@drita.test');
    await pool.query(
      `UPDATE publisher_invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [expired.invite.id],
    );
    const revoked = await invite(id, 'revoked@drita.test');
    await api('DELETE', `/admin/invites/${revoked.invite.id}`, { token: admin.token });

    const res = await api('GET', `/admin/publishers/${id}`, { token: admin.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.publisher.id, id);
    assert.deepEqual(
      res.body.team.map((u: { id: string; email: string; status: string }) => [
        u.id,
        u.email,
        u.status,
      ]),
      [[staff.id, staff.email, 'active']],
    );
    assert.equal(res.body.invites.length, 1);
    assert.equal(res.body.invites[0].id, open.invite.id);
    assert.equal(res.body.invites[0].email, 'open@drita.test');
    assert.equal(res.body.invites[0].displayName, 'Open Person');
    assert.ok(res.body.invites[0].expiresAt);
    assert.equal('tokenHash' in res.body.invites[0], false);
    assert.equal(JSON.stringify(res.body).includes(open.token), false);
  });
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

describe('invites', () => {
  it('creates an invite whose link carries the token in the fragment and stores only a hash', async () => {
    const { id } = await newPublisher();
    const { invite: created, link, token } = await invite(id);

    assert.ok(link.startsWith(`${env.PORTAL_ORIGIN}/invite#token=`), link);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const { rows } = await pool.query(
      'SELECT token_hash, expires_at, created_by, created_at FROM publisher_invites WHERE id = $1',
      [created.id],
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].token_hash, createHash('sha256').update(token).digest());
    assert.equal(rows[0].created_by, admin.id);
    const days = (rows[0].expires_at - rows[0].created_at) / 86_400_000;
    assert.ok(Math.abs(days - 7) < 0.01, `expires after ${days} days`);

    const rowText = JSON.stringify((await pool.query('SELECT * FROM publisher_invites')).rows);
    assert.equal(rowText.includes(token), false, 'the raw token is never stored');

    const audits = await auditRows('invite.created');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].resource_id, created.id);
    assert.equal(audits[0].actor_id, admin.id);
  });

  it('revokes the open invite for the same publisher and email when re-issuing', async () => {
    const { id } = await newPublisher();
    const first = await invite(id, 'same@drita.test');
    const second = await invite(id, 'SAME@drita.test');
    assert.notEqual(first.token, second.token);

    const old = await inspect(first.token);
    assert.equal(old.status, 410);
    assert.equal(old.body.error.details.reason, 'revoked');
    assert.equal((await inspect(second.token)).status, 200);

    const open = await pool.query(
      `SELECT COUNT(*)::int AS n FROM publisher_invites
        WHERE accepted_at IS NULL AND revoked_at IS NULL`,
    );
    assert.equal(open.rows[0].n, 1);
    assert.equal((await auditRows('invite.revoked')).length, 1);
  });

  it('lets two publishers invite the same email, and re-issues an expired one', async () => {
    const a = await newPublisher('A Books');
    const b = await newPublisher('B Books');
    await invite(a.id, 'shared@x.test');
    await invite(b.id, 'shared@x.test');
    const expired = await invite(a.id, 'old@x.test');
    await pool.query(
      `UPDATE publisher_invites SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [expired.invite.id],
    );
    const again = await invite(a.id, 'old@x.test');
    assert.equal((await inspect(again.token)).status, 200);
    assert.equal((await inspect(expired.token)).body.error.details.reason, 'revoked');
  });

  it('cancels an invite, idempotently, and answers 404 for an unknown one', async () => {
    const { id } = await newPublisher();
    const { invite: created, token } = await invite(id);
    const del = () => api('DELETE', `/admin/invites/${created.id}`, { token: admin.token });
    assert.equal((await del()).status, 204);
    assert.equal((await del()).status, 204);
    assert.equal((await auditRows('invite.revoked')).length, 1, 'audited once');
    assert.equal((await inspect(token)).body.error.details.reason, 'revoked');
    const missing = await api('DELETE', `/admin/invites/${randomUUID()}`, { token: admin.token });
    assert.equal(missing.status, 404);
    assert.equal(code(missing), 'NOT_FOUND');
  });

  it('does not cancel an invite that was already accepted', async () => {
    const { id } = await newPublisher();
    const { invite: created, token } = await invite(id);
    assert.equal((await accept(token)).status, 200);
    const res = await api('DELETE', `/admin/invites/${created.id}`, { token: admin.token });
    assert.equal(res.status, 409);
    assert.equal(code(res), 'INVITE_ACCEPTED');
  });

  it('inspect returns the publisher, email and suggested name', async () => {
    const { id } = await newPublisher();
    const { token } = await invite(id, 'era@drita.test', 'Era');
    const res = await inspect(token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body, {
      email: 'era@drita.test',
      publisherName: 'Botimet Drita',
      displayName: 'Era',
      emailTaken: false,
    });
  });

  it('answers 410 INVITE_INVALID with a reason: unknown, expired, used and revoked', async () => {
    const { id } = await newPublisher();
    const reason = (res: ApiResponse) => {
      assert.equal(res.status, 410, JSON.stringify(res.body));
      assert.equal(code(res), 'INVITE_INVALID');
      return res.body.error.details.reason;
    };

    assert.equal(reason(await inspect('x'.repeat(43))), 'unknown');
    assert.equal(reason(await inspect('short')), 'unknown');
    assert.equal(reason(await accept('x'.repeat(43))), 'unknown');

    const expired = await invite(id, 'e@x.test');
    await pool.query(
      `UPDATE publisher_invites SET expires_at = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [expired.invite.id],
    );
    assert.equal(reason(await inspect(expired.token)), 'expired');
    assert.equal(reason(await accept(expired.token)), 'expired');
    assert.equal(
      Number(
        (await pool.query('SELECT COUNT(*) AS n FROM users WHERE role = $1', ['publisher'])).rows[0]
          .n,
      ),
      0,
    );

    const used = await invite(id, 'u@x.test');
    assert.equal((await accept(used.token)).status, 200);
    assert.equal(reason(await inspect(used.token)), 'used');
    assert.equal(reason(await accept(used.token)), 'used');

    const revoked = await invite(id, 'r@x.test');
    await api('DELETE', `/admin/invites/${revoked.invite.id}`, { token: admin.token });
    assert.equal(reason(await inspect(revoked.token)), 'revoked');
    assert.equal(reason(await accept(revoked.token)), 'revoked');
  });

  it('accept creates a publisher login tied to the house, signs in with the portal cookie, and audits', async () => {
    const { id } = await newPublisher();
    const { invite: created, token } = await invite(id, 'era@drita.test');
    const res = await accept(token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.email, 'era@drita.test');
    assert.equal(res.body.user.role, 'publisher');
    assert.equal(res.body.user.publisherId, id);
    assert.equal(res.body.user.displayName, 'Era Hoxha');
    assert.equal('token' in res.body, false, 'the session is a cookie, not a body field');

    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^libraria_portal=[^;]+;.*HttpOnly/);
    const me = await api('GET', '/auth/me', { headers: { Cookie: cookie.split(';')[0] } });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.id, res.body.user.id);

    const row = (
      await pool.query(
        'SELECT accepted_at, accepted_user_id FROM publisher_invites WHERE id = $1',
        [created.id],
      )
    ).rows[0];
    assert.ok(row.accepted_at);
    assert.equal(row.accepted_user_id, res.body.user.id);

    // The new password works for a normal portal login.
    const login = await api('POST', '/auth/portal/login', {
      body: { email: 'era@drita.test', password: PASSWORD },
    });
    assert.equal(login.status, 200);

    const audits = await auditRows('invite.accepted');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].resource_id, created.id);
    assert.equal(audits[0].actor_id, res.body.user.id);
  });

  it('refuses a weak password or a missing name without using the invite up', async () => {
    const { id } = await newPublisher();
    const { token } = await invite(id);
    assert.equal((await accept(token, { password: 'short' })).status, 400);
    assert.equal((await accept(token, { displayName: '' })).status, 400);
    assert.equal((await accept(token, { password: 'x'.repeat(80) })).status, 400);
    assert.equal((await inspect(token)).status, 200);
    assert.equal((await accept(token)).status, 200);
  });

  it('answers 409 EMAIL_TAKEN for a reader email and keeps the invite open', async () => {
    const { id } = await newPublisher();
    // The account appears after the invite was made (a race the create-time check cannot see).
    const { token } = await invite(id, 'late@reader.test');
    const reader = await createUser();
    await pool.query('UPDATE users SET email = $2 WHERE id = $1', [reader.id, 'late@reader.test']);
    const taken = await inspect(token);
    assert.equal(taken.status, 200);
    assert.equal(taken.body.emailTaken, true);
    const res = await accept(token);
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(code(res), 'EMAIL_TAKEN');
    assert.equal((await inspect(token)).status, 200, 'the invite is not consumed');
    const role = (await pool.query('SELECT role FROM users WHERE id = $1', [reader.id])).rows[0]
      .role;
    assert.equal(role, 'reader', 'accounts are never converted');
  });

  it('answers EMAIL_TAKEN for the second of two open invites to one email', async () => {
    const a = await newPublisher('A Books');
    const b = await newPublisher('B Books');
    const first = await invite(a.id, 'both@x.test');
    const second = await invite(b.id, 'both@x.test');
    assert.equal((await accept(first.token)).status, 200);
    const res = await accept(second.token);
    assert.equal(res.status, 409);
    assert.equal(code(res), 'EMAIL_TAKEN');
  });

  it('lets exactly one of two simultaneous accepts win; the other gets 410 used', async () => {
    const { id } = await newPublisher();
    const { invite: created, token } = await invite(id, 'race@drita.test');

    // Hold the invite row lock so both accepts reach it before either can proceed.
    const holder = await pool.connect();
    let results: Array<Awaited<ReturnType<typeof accept>>>;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM publisher_invites WHERE id = $1 FOR UPDATE', [created.id]);
      const first = accept(token, { displayName: 'First' });
      const second = accept(token, { displayName: 'Second' });
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
      results = await Promise.all([first, second]);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }

    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 410], JSON.stringify(results.map((r) => r.body)));
    const loser = results.find((r) => r.status === 410);
    assert.equal(code(loser as never), 'INVITE_INVALID');
    assert.equal(loser?.body.error.details.reason, 'used');
    const users = await pool.query('SELECT COUNT(*)::int AS n FROM users WHERE email = $1', [
      'race@drita.test',
    ]);
    assert.equal(users.rows[0].n, 1);
    assert.equal((await auditRows('invite.accepted')).length, 1);
  });

  it('an accepted invitee that is then suspended cannot sign in', async () => {
    const { id } = await newPublisher();
    const { token } = await invite(id, 'sus@drita.test');
    const accepted = await accept(token);
    const suspend = await api('PATCH', `/admin/users/${accepted.body.user.id}/status`, {
      token: admin.token,
      body: { status: 'suspended' },
    });
    assert.equal(suspend.status, 200);
    const login = await api('POST', '/auth/portal/login', {
      body: { email: 'sus@drita.test', password: PASSWORD },
    });
    assert.equal(login.status, 403);
    assert.equal(code(login), 'ACCOUNT_SUSPENDED');
    const cookie = (accepted.headers.get('set-cookie') ?? '').split(';')[0];
    assert.equal((await api('GET', '/auth/me', { headers: { Cookie: cookie } })).status, 403);
  });

  it('rate-limits inspect and accept', async () => {
    const bad = 'z'.repeat(43);
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const res = await inspect(bad);
      if (res.status === 429) limited++;
      else assert.equal(res.status, 410);
    }
    assert.ok(limited > 0, 'inspect is rate limited');
    resetRateLimits();
    limited = 0;
    for (let i = 0; i < 20; i++) {
      const res = await accept(bad);
      if (res.status === 429) {
        assert.equal(code(res), 'RATE_LIMITED');
        limited++;
      }
    }
    assert.ok(limited > 0, 'accept is rate limited');
  });
});

describe('invite token leakage', () => {
  it('never reaches a log line, the audit log or the stored rows', async () => {
    const lines: string[] = [];
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    const capture = (chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    };
    const level = (env as { LOG_LEVEL: string }).LOG_LEVEL;
    (env as { LOG_LEVEL: string }).LOG_LEVEL = 'debug';
    process.stdout.write = capture as typeof process.stdout.write;
    process.stderr.write = capture as typeof process.stderr.write;

    let tokens: string[];
    try {
      const { id } = await newPublisher();
      const a = await invite(id, 'leak-a@drita.test');
      const b = await invite(id, 'leak-b@drita.test');
      const c = await invite(id, 'leak-c@drita.test');
      tokens = [a.token, b.token, c.token];
      await inspect(a.token);
      assert.equal((await accept(a.token, { password: 'short' })).status, 400);
      assert.equal((await accept(a.token)).status, 200);
      assert.equal((await accept(a.token)).status, 410);
      await api('DELETE', `/admin/invites/${b.invite.id}`, { token: admin.token });
      await inspect(b.token);
      await api('GET', `/admin/publishers/${id}`, { token: admin.token });
    } finally {
      process.stdout.write = realOut;
      process.stderr.write = realErr;
      (env as { LOG_LEVEL: string }).LOG_LEVEL = level;
    }

    assert.ok(
      lines.some((line) => line.includes('request completed')),
      'requests were logged',
    );
    const logs = lines.join('');
    const audit = JSON.stringify((await pool.query('SELECT * FROM audit_events')).rows);
    const stored = JSON.stringify((await pool.query('SELECT * FROM publisher_invites')).rows);
    for (const token of tokens) {
      assert.equal(logs.includes(token), false, 'log line');
      assert.equal(audit.includes(token), false, 'audit row');
      assert.equal(stored.includes(token), false, 'stored row');
      assert.equal(logs.includes(encodeURIComponent(token)), false);
    }
  });

  it('only the create response carries the link', async () => {
    const { id } = await newPublisher();
    const { token } = await invite(id, 'once@drita.test');
    const texts = [
      JSON.stringify((await inspect(token)).body),
      JSON.stringify((await api('GET', `/admin/publishers/${id}`, { token: admin.token })).body),
      JSON.stringify((await api('GET', '/admin/publishers', { token: admin.token })).body),
    ];
    for (const text of texts) assert.equal(text.includes(token), false);
    const accepted = await accept(token);
    assert.equal(JSON.stringify(accepted.body).includes(token), false);
  });
});

// ---------------------------------------------------------------------------
// Platform reports
// ---------------------------------------------------------------------------

describe('platform reports', () => {
  const FROM = '2025-03-01';
  const TO = '2025-04-01';
  const PAID = '2025-03-10T12:00:00Z';

  async function sale(
    bookId: string,
    buyer: TestUser,
    refund?: { partialAmountCents?: number },
  ): Promise<void> {
    const id = await buy(api, buyer.token, [bookId]);
    await pool.query('UPDATE transactions SET paid_at = $2 WHERE id = $1', [id, PAID]);
    if (refund) {
      const res = await api('POST', `/sandbox/transactions/${id}/events`, {
        token: buyer.token,
        body: { kind: 'refund', ...refund },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
    }
  }

  it('platform totals equal the sum of the per-publisher rows, and each row equals the publisher summary', async () => {
    const buyer = await createUser();
    const rated = await createPublisher('Rated House', { commissionBps: 2000 });
    const other = await createPublisher('Other House', { commissionBps: 3000 });
    // Books cannot be sold without a rate, so the contract is removed after the sale.
    const unrated = await createPublisher('Unrated House');
    const empty = await createPublisher('Quiet House');
    const refunded = await createBook(rated, { priceCents: 1000 });
    const plain = await createBook(rated, { priceCents: 700 });
    const otherBook = await createBook(other, { priceCents: 1299 });
    const unsplit = await createBook(unrated, { priceCents: 800 });
    await sale(refunded, buyer, { partialAmountCents: 300 });
    await sale(plain, buyer);
    await sale(otherBook, buyer);
    await sale(unsplit, buyer);
    await pool.query(
      `UPDATE transaction_items
          SET commission_rate_bps = NULL, platform_commission_cents = NULL,
              publisher_earnings_cents = NULL
        WHERE publisher_id = $1`,
      [unrated],
    );
    await pool.query('DELETE FROM publisher_commission_rates WHERE publisher_id = $1', [unrated]);
    // Outside the period: must not be counted anywhere.
    const late = await createBook(rated, { priceCents: 555 });
    const lateId = await buy(api, buyer.token, [late]);
    await pool.query('UPDATE transactions SET paid_at = $2 WHERE id = $1', [
      lateId,
      '2025-05-01T00:00:00Z',
    ]);

    const query = `from=${FROM}&to=${TO}`;
    const summary = await api('GET', `/admin/reports/summary?${query}&granularity=week`, {
      token: admin.token,
    });
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    const byPublisher = await api('GET', `/admin/reports/by-publisher?${query}`, {
      token: admin.token,
    });
    assert.equal(byPublisher.status, 200, JSON.stringify(byPublisher.body));
    // biome-ignore lint/suspicious/noExplicitAny: rows are asserted key by key.
    const rows: Array<Record<string, any>> = byPublisher.body.rows;
    assert.equal(rows.length, 4, 'a publisher without sales still appears');
    const quiet = rows.find((r) => r.publisherId === empty);
    assert.equal(quiet?.grossCents, 0);
    assert.equal(quiet?.publisherName, 'Quiet House');
    assert.equal(rows[0].publisherName, 'Rated House', 'sorted by gross, highest first');

    const totals = summary.body.totals;
    assert.equal(totals.grossCents, 1700 + 1299 + 800);
    assert.equal(totals.refundsCents, 300);
    assert.ok(totals.unsplitCents > 0, 'the unrated sale is unsplit');
    for (const key of Object.keys(totals)) {
      const sum = rows.reduce((acc, row) => acc + Number(row[key]), 0);
      assert.equal(sum, totals[key], `rows sum to the total for ${key}`);
    }
    // The series adds up to the totals too.
    for (const key of ['grossCents', 'commissionCents', 'earningsCents', 'copies']) {
      const sum = summary.body.series.reduce(
        (acc: number, point: Record<string, number>) => acc + point[key],
        0,
      );
      assert.equal(sum, totals[key], `series sums to the total for ${key}`);
    }

    for (const row of rows) {
      const own = await api(
        'GET',
        `/publisher/reports/summary?${query}&publisherId=${row.publisherId}`,
        { token: admin.token },
      );
      assert.equal(own.status, 200);
      const { publisherId: _id, publisherName: _name, currentRateBps: _rate, ...metrics } = row;
      assert.deepEqual(metrics, own.body.totals, row.publisherName);
    }
    assert.equal(rows.find((r) => r.publisherId === unrated)?.currentRateBps, null);
    assert.equal(rows.find((r) => r.publisherId === other)?.currentRateBps, 3000);
  });

  it('validates the range', async () => {
    assert.equal((await api('GET', '/admin/reports/summary', { token: admin.token })).status, 400);
    assert.equal(
      (
        await api('GET', '/admin/reports/by-publisher?from=2025-03-02&to=2025-03-01', {
          token: admin.token,
        })
      ).status,
      400,
    );
  });
});

// ---------------------------------------------------------------------------
// Books across publishers
// ---------------------------------------------------------------------------

describe('GET /admin/books', () => {
  it('lists every publisher book with the publisher name, filters, sorts and pages', async () => {
    const a = await createPublisher('Alpha House');
    const b = await createPublisher('Beta House');
    const aOne = await createBook(a, { title: 'Dielli i Ri' });
    const aDraft = await createBook(a, { title: 'Draft Piece', available: false });
    const bOne = await createBook(b, { title: 'Lumi i Bardhe' });
    await createBook(b, { title: 'Hena', available: false });
    await pool.query(`UPDATE books SET withdrawn_at = NOW(), is_available = FALSE WHERE id = $1`, [
      bOne,
    ]);

    const all = await api('GET', '/admin/books?limit=50&sort=title&order=asc', {
      token: admin.token,
    });
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.deepEqual(
      all.body.books.map((x: { title: string }) => x.title),
      ['Dielli i Ri', 'Draft Piece', 'Hena', 'Lumi i Bardhe'],
    );
    const first = all.body.books[0];
    assert.equal(first.publisherName, 'Alpha House');
    assert.equal(first.publisherId, a);
    assert.ok('metrics' in first && 'status' in first && 'price' in first);
    assert.equal(all.body.pagination.total, 4);

    const byPublisher = await api('GET', `/admin/books?publisherId=${b}`, { token: admin.token });
    assert.equal(byPublisher.body.books.length, 2);
    assert.ok(
      byPublisher.body.books.every(
        (x: { publisherName: string }) => x.publisherName === 'Beta House',
      ),
    );

    const withdrawn = await api('GET', '/admin/books?status=withdrawn', { token: admin.token });
    assert.deepEqual(
      withdrawn.body.books.map((x: { id: string }) => x.id),
      [bOne],
    );
    const drafts = await api('GET', '/admin/books?status=draft', { token: admin.token });
    assert.equal(drafts.body.books.length, 2);
    assert.ok(drafts.body.books.some((x: { id: string }) => x.id === aDraft));

    const search = await api('GET', '/admin/books?q=dielli', { token: admin.token });
    assert.deepEqual(
      search.body.books.map((x: { id: string }) => x.id),
      [aOne],
    );
    const literal = await api('GET', `/admin/books?q=${encodeURIComponent('%')}`, {
      token: admin.token,
    });
    assert.equal(literal.body.books.length, 0);

    const paged = await api('GET', '/admin/books?limit=3&page=2&sort=title&order=asc', {
      token: admin.token,
    });
    assert.equal(paged.body.books.length, 1);
    assert.equal(paged.body.pagination.totalPages, 2);

    assert.equal(
      (await api('GET', '/admin/books?status=bogus', { token: admin.token })).status,
      400,
    );
    const unknownPublisher = await api('GET', `/admin/books?publisherId=${randomUUID()}`, {
      token: admin.token,
    });
    assert.equal(unknownPublisher.status, 200);
    assert.equal(unknownPublisher.body.books.length, 0);
  });

  it('keeps archived books out of "all" and finds them by status', async () => {
    const a = await createPublisher('Alpha House');
    const id = await createBook(a);
    await pool.query(`UPDATE books SET archived_at = NOW(), is_available = FALSE WHERE id = $1`, [
      id,
    ]);
    assert.equal((await api('GET', '/admin/books', { token: admin.token })).body.books.length, 0);
    const archived = await api('GET', '/admin/books?status=archived', { token: admin.token });
    assert.equal(archived.body.books.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

describe('admin readers', () => {
  it('needs 3 characters for a prefix, and always allows an exact email', async () => {
    const reader = await createUser();
    const short = await api('GET', '/admin/readers?q=us', { token: admin.token });
    assert.equal(short.status, 400);
    assert.equal(code(short), 'VALIDATION_FAILED');
    assert.equal((await api('GET', '/admin/readers', { token: admin.token })).status, 400);

    const prefix = await api('GET', `/admin/readers?q=${reader.email.slice(0, 6)}`, {
      token: admin.token,
    });
    assert.equal(prefix.status, 200, JSON.stringify(prefix.body));
    assert.deepEqual(
      prefix.body.readers.map((r: { id: string }) => r.id),
      [reader.id],
    );
    const exact = await api(
      'GET',
      `/admin/readers?q=${encodeURIComponent(reader.email.toUpperCase())}`,
      { token: admin.token },
    );
    assert.equal(exact.body.readers.length, 1);
    assert.deepEqual(Object.keys(exact.body.readers[0]).sort(), [
      'createdAt',
      'displayName',
      'email',
      'id',
      'status',
    ]);
    const short2 = await api('GET', '/admin/readers?q=a@b', { token: admin.token });
    assert.equal(short2.status, 200);
    assert.equal(short2.body.readers.length, 0);
  });

  it('returns reader accounts only, at most 20, with literal matching', async () => {
    for (let i = 0; i < 25; i++) {
      await pool.query(`INSERT INTO users (email, password_hash) VALUES ($1, 'x')`, [
        `bulk${String(i).padStart(2, '0')}@many.test`,
      ]);
    }
    const publisher = await createPublisher();
    await pool.query(
      `INSERT INTO users (email, password_hash, role, publisher_id) VALUES ('bulk-staff@many.test', 'x', 'publisher', $1)`,
      [publisher],
    );
    const res = await api('GET', '/admin/readers?q=bulk', { token: admin.token });
    assert.equal(res.body.readers.length, 20);
    assert.ok(res.body.readers.every((r: { email: string }) => r.email !== 'bulk-staff@many.test'));
    const staff = await api('GET', '/admin/readers?q=bulk-staff@many.test', { token: admin.token });
    assert.equal(staff.body.readers.length, 0, 'a publisher login is not a reader');
    const wild = await api('GET', `/admin/readers?q=${encodeURIComponent('b%k')}`, {
      token: admin.token,
    });
    assert.equal(wild.body.readers.length, 0);
  });

  it('shows a reader page and writes reader.viewed', async () => {
    const reader = await createUser();
    const publisher = await createPublisher();
    const book = await createBook(publisher);
    await buy(api, reader.token, [book]);
    await pool.query(
      `INSERT INTO devices (user_id, platform, display_name, public_key_spki)
       VALUES ($1, 'android', 'Phone', 'spki-1')`,
      [reader.id],
    );
    const device = (await pool.query('SELECT id FROM devices WHERE user_id = $1', [reader.id]))
      .rows[0];
    await pool.query('INSERT INTO device_removals (user_id, device_id) VALUES ($1, $2)', [
      reader.id,
      device.id,
    ]);

    const res = await api('GET', `/admin/readers/${reader.id}`, { token: admin.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.reader.id, reader.id);
    assert.equal(res.body.reader.email, reader.email);
    assert.equal(res.body.reader.status, 'active');
    assert.equal(res.body.booksOwned, 1);
    assert.equal(res.body.removalsThisYear, 1);
    assert.equal(res.body.devices.length, 1);
    assert.equal(res.body.devices[0].displayName, 'Phone');
    assert.equal('passwordHash' in res.body.reader, false);

    const audits = await auditRows('reader.viewed');
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actor_id, admin.id);
    assert.equal(audits[0].resource_id, reader.id);

    await api('GET', `/admin/readers/${reader.id}`, { token: admin.token });
    assert.equal((await auditRows('reader.viewed')).length, 2);
  });

  it('answers 404 for an unknown id or a non-reader account, without auditing', async () => {
    const staffPublisher = await createPublisher();
    const staff = await createUser({ role: 'publisher', publisherId: staffPublisher });
    for (const id of [randomUUID(), staff.id, admin.id]) {
      const res = await api('GET', `/admin/readers/${id}`, { token: admin.token });
      assert.equal(res.status, 404, id);
      assert.equal(code(res), 'NOT_FOUND');
    }
    assert.equal((await auditRows('reader.viewed')).length, 0);
  });
});

// ---------------------------------------------------------------------------
// Access control and missing ids, across every new route
// ---------------------------------------------------------------------------

describe('access control', () => {
  it('refuses publisher and reader accounts on every admin route, and anonymous callers', async () => {
    const { id } = await newPublisher();
    const { invite: created } = await invite(id, 'acl@drita.test');
    const staff = await createUser({ role: 'publisher', publisherId: id });
    const reader = await createUser();
    const range = 'from=2025-03-01&to=2025-04-01';
    const routes: Array<[string, string, unknown?]> = [
      ['GET', '/admin/publishers'],
      ['POST', '/admin/publishers', { name: 'X', contactEmail: 'a@b.test', country: 'AL' }],
      ['PATCH', `/admin/publishers/${id}`, { name: 'Y' }],
      ['GET', `/admin/publishers/${id}`],
      ['POST', `/admin/publishers/${id}/invites`, { email: 'new@x.test' }],
      ['DELETE', `/admin/invites/${created.id}`],
      ['GET', `/admin/reports/summary?${range}`],
      ['GET', `/admin/reports/by-publisher?${range}`],
      ['GET', '/admin/books'],
      ['GET', '/admin/readers?q=abc'],
      ['GET', `/admin/readers/${reader.id}`],
    ];
    for (const [method, path, body] of routes) {
      const hasBody = body !== undefined ? { body } : {};
      assert.equal(
        (await api(method, path, { token: staff.token, ...hasBody })).status,
        403,
        `${method} ${path} as publisher`,
      );
      assert.equal(
        (await api(method, path, { token: reader.token, ...hasBody })).status,
        403,
        `${method} ${path} as reader`,
      );
      assert.equal((await api(method, path, hasBody)).status, 401, `${method} ${path} anonymous`);
    }
    // Nothing was changed by the refused calls.
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM publishers')).rows[0].n), 1);
    assert.equal(
      (await pool.query('SELECT name FROM publishers WHERE id = $1', [id])).rows[0].name,
      'Botimet Drita',
    );
    assert.equal(
      (await pool.query('SELECT revoked_at FROM publisher_invites WHERE id = $1', [created.id]))
        .rows[0].revoked_at,
      null,
    );
  });

  it('answers a clean 404, never a 500, for unknown ids', async () => {
    const missing = randomUUID();
    const calls: Array<[string, string, unknown?]> = [
      ['PATCH', `/admin/publishers/${missing}`, { name: 'Y' }],
      ['GET', `/admin/publishers/${missing}`],
      ['POST', `/admin/publishers/${missing}/invites`, { email: 'new@x.test' }],
      ['DELETE', `/admin/invites/${missing}`],
      ['GET', `/admin/readers/${missing}`],
      ['PATCH', `/admin/users/${missing}/status`, { status: 'suspended' }],
      ['POST', `/admin/books/${missing}/withdraw`, { reason: 'x' }],
      ['POST', `/admin/books/${missing}/reinstate`],
      ['GET', `/admin/publishers/${missing}/commission-rates`],
      ['POST', `/admin/publishers/${missing}/commission-rates`, { rateBps: 1000 }],
    ];
    for (const [method, path, body] of calls) {
      const res = await api(method, path, {
        token: admin.token,
        ...(body !== undefined ? { body } : {}),
      });
      assert.equal(res.status, 404, `${method} ${path}: ${JSON.stringify(res.body)}`);
      assert.equal(code(res), 'NOT_FOUND', `${method} ${path}`);
    }
    // A malformed id is a validation error, not a crash.
    assert.equal(
      (await api('GET', '/admin/publishers/not-a-uuid', { token: admin.token })).status,
      400,
    );
    assert.equal(
      (await api('DELETE', '/admin/invites/not-a-uuid', { token: admin.token })).status,
      400,
    );
  });

  it('validates the invite body', async () => {
    const { id } = await newPublisher();
    const post = (body: unknown) =>
      api('POST', `/admin/publishers/${id}/invites`, { token: admin.token, body });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ email: 'nope' })).status, 400);
    assert.equal((await post({ email: 'a@b.test', displayName: 'x'.repeat(101) })).status, 400);
  });
});

// ---------------------------------------------------------------------------
// Fix round: proxies, rate-limit keys, early checks, scope, logs
// ---------------------------------------------------------------------------

/** Runs `work` with every log line captured, at debug level. */
async function captureLogs(work: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  const capture = (chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  };
  const level = (env as { LOG_LEVEL: string }).LOG_LEVEL;
  (env as { LOG_LEVEL: string }).LOG_LEVEL = 'debug';
  process.stdout.write = capture as typeof process.stdout.write;
  process.stderr.write = capture as typeof process.stderr.write;
  try {
    await work();
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    (env as { LOG_LEVEL: string }).LOG_LEVEL = level;
  }
  return lines.join('');
}

describe('invite rate limits and proxies', () => {
  const inspectFrom = (ip: string) =>
    api('POST', '/auth/invites/inspect', {
      body: { token: 'p'.repeat(43) },
      headers: { 'X-Forwarded-For': ip },
    });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    let limited = 0;
    for (let i = 0; i < 35; i++) {
      if ((await inspectFrom(`203.0.113.${i + 1}`)).status === 429) limited++;
    }
    assert.ok(limited > 0, 'forged client addresses share one budget');
  });

  it('gives different forwarded clients their own budget when the proxy is trusted', async () => {
    app.set('trust proxy', 1);
    try {
      for (let i = 0; i < 35; i++) {
        const res = await inspectFrom(`203.0.113.${i + 1}`);
        assert.equal(res.status, 410, `client ${i}`);
      }
      let limited = 0;
      for (let i = 0; i < 35; i++) {
        if ((await inspectFrom('198.51.100.7')).status === 429) limited++;
      }
      assert.ok(limited > 0, 'one forwarded client is still limited');
    } finally {
      app.set('trust proxy', false);
    }
  });

  it('keys accept attempts on the token as well as the address', async () => {
    const a = 'a'.repeat(43);
    const b = 'b'.repeat(43);
    let limitedA = 0;
    for (let i = 0; i < 12; i++) {
      if ((await accept(a)).status === 429) limitedA++;
    }
    assert.ok(limitedA > 0, 'hammering one token is limited');
    assert.equal((await accept(b)).status, 410, 'another token from the same address is not');
  });

  it('hashes the password only for a plausibly open invite', async () => {
    const { id } = await newPublisher();
    const realHash = bcrypt.hash;
    let hashes = 0;
    // biome-ignore lint/suspicious/noExplicitAny: counting calls to the real function.
    (bcrypt as any).hash = (...args: Parameters<typeof realHash>) => {
      hashes++;
      return realHash(...args);
    };
    try {
      const expired = await invite(id, 'cheap-e@x.test');
      await pool.query(
        `UPDATE publisher_invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
        [expired.invite.id],
      );
      const revoked = await invite(id, 'cheap-r@x.test');
      await api('DELETE', `/admin/invites/${revoked.invite.id}`, { token: admin.token });
      for (const token of ['q'.repeat(43), 'short', expired.token, revoked.token]) {
        assert.equal((await accept(token)).status, 410);
      }
      assert.equal(hashes, 0, 'no bcrypt for dead invites');
      const open = await invite(id, 'cheap-o@x.test');
      assert.equal((await accept(open.token)).status, 200);
      assert.equal(hashes, 1);
      assert.equal((await accept(open.token)).status, 410);
      assert.equal(hashes, 1, 'a used invite is refused before hashing');
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restoring the real function.
      (bcrypt as any).hash = realHash;
    }
  });
});

describe('invites for taken emails', () => {
  it('refuses to create an invite for an email that already has an account', async () => {
    const { id } = await newPublisher();
    const reader = await createUser();
    const otherPublisher = await createPublisher('Other');
    const staff = await createUser({ role: 'publisher', publisherId: otherPublisher });
    for (const email of [reader.email, reader.email.toUpperCase(), staff.email]) {
      const res = await api('POST', `/admin/publishers/${id}/invites`, {
        token: admin.token,
        body: { email },
      });
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(code(res), 'EMAIL_TAKEN');
    }
    const rows = await pool.query('SELECT COUNT(*)::int AS n FROM publisher_invites');
    assert.equal(rows.rows[0].n, 0);
    assert.equal((await auditRows('invite.created')).length, 0);
  });

  it('keeps the token out of the logs on the EMAIL_TAKEN path', async () => {
    const { id } = await newPublisher();
    const { token } = await invite(id, 'taken-later@x.test');
    await pool.query(`INSERT INTO users (email, password_hash) VALUES ('taken-later@x.test', 'x')`);
    const logs = await captureLogs(async () => {
      assert.equal((await inspect(token)).body.emailTaken, true);
      const res = await accept(token);
      assert.equal(res.status, 409);
      assert.equal(code(res), 'EMAIL_TAKEN');
    });
    assert.ok(logs.includes('request completed'));
    assert.equal(logs.includes(token), false);
    const audit = JSON.stringify((await pool.query('SELECT * FROM audit_events')).rows);
    assert.equal(audit.includes(token), false);
  });

  it('keeps the token out of the logs when an unhandled error becomes a 500', async () => {
    const { id } = await newPublisher();
    const { token } = await invite(id, 'boom@x.test');
    await pool.query(
      `CREATE OR REPLACE FUNCTION fail_user_insert() RETURNS trigger AS $body$
       BEGIN RAISE EXCEPTION 'forced failure'; END $body$ LANGUAGE plpgsql`,
    );
    await pool.query(
      'CREATE TRIGGER fail_user_insert BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION fail_user_insert()',
    );
    let logs = '';
    try {
      logs = await captureLogs(async () => {
        const res = await accept(token);
        assert.equal(res.status, 500, JSON.stringify(res.body));
        assert.equal(JSON.stringify(res.body).includes(token), false);
      });
    } finally {
      await pool.query('DROP TRIGGER IF EXISTS fail_user_insert ON users');
      await pool.query('DROP FUNCTION IF EXISTS fail_user_insert()');
    }
    assert.ok(logs.includes('unhandled error'), 'the failure was logged');
    assert.equal(logs.includes(token), false);
    assert.equal((await inspect(token)).status, 200, 'the failed accept did not use the invite up');
  });
});

describe('empty search and country shape', () => {
  it('treats an empty q as no filter on publishers and books', async () => {
    const p = await createPublisher('Alpha House');
    await createBook(p);
    const pubs = await api('GET', '/admin/publishers?q=', { token: admin.token });
    assert.equal(pubs.status, 200, JSON.stringify(pubs.body));
    assert.equal(pubs.body.publishers.length, 1);
    const books = await api('GET', '/admin/books?q=', { token: admin.token });
    assert.equal(books.status, 200, JSON.stringify(books.body));
    assert.equal(books.body.books.length, 1);
  });

  it('refuses a malformed country in the database too', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO publishers (name, contact_email, country) VALUES ('X', 'x@x.test', 'al')`,
      ),
      /publishers_country_shape/,
    );
  });
});

describe('platform scope', () => {
  it('a publisher account sees only its own figures, never the platform ones', async () => {
    const buyer = await createUser();
    const mine = await createPublisher('Mine');
    const theirs = await createPublisher('Theirs');
    const mineBook = await createBook(mine, { priceCents: 500 });
    const theirBook = await createBook(theirs, { priceCents: 900 });
    for (const book of [mineBook, theirBook]) {
      const id = await buy(api, buyer.token, [book]);
      await pool.query('UPDATE transactions SET paid_at = $2 WHERE id = $1', [
        id,
        '2025-03-10T12:00:00Z',
      ]);
    }
    const staff = await createUser({ role: 'publisher', publisherId: mine });
    const range = 'from=2025-03-01&to=2025-04-01';
    for (const suffix of [
      '',
      `&publisherId=${theirs}`,
      '&publisherId=null',
      '&publisherId=platform',
    ]) {
      const res = await api('GET', `/publisher/reports/summary?${range}${suffix}`, {
        token: staff.token,
      });
      if (res.status === 200) assert.equal(res.body.totals.grossCents, 500, suffix);
      else assert.equal(res.status, 400, suffix);
    }
    const platform = await api('GET', `/admin/reports/summary?${range}`, { token: admin.token });
    assert.equal(platform.body.totals.grossCents, 1400);
  });
});
