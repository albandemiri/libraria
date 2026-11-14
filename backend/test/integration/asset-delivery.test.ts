import './asset-delivery.env';
import {
  buy,
  client,
  createBook,
  createPublisher,
  createReadyAsset,
  createUser,
  pool,
  resetDatabase,
  startTestServer,
  type TestServer,
  type TestUser,
} from './harness';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { clearAccountStatusCache } from '../../src/auth/account-status';
import { purgeExpiredDownloadGrants } from '../../src/drm/asset-delivery.service';
import { PNG_1X1 } from '../../src/drm/epub/fixtures';
import {
  type ObjectStorage,
  objectStorage,
  setObjectStorageForTests,
} from '../../src/drm/object-storage';
import { setPublishHookForTests } from '../../src/routes/publisher';
import { consumeRateLimit, resetRateLimits } from '../../src/middleware/rate-limit';

let server: TestServer;
let api: ReturnType<typeof client>;
let origin: string;
let publisherId: string;
let bookId: string;
let assetId: string;
let buyer: TestUser;
let stranger: TestUser;
let admin: TestUser;
let deviceId: string;

const captured: string[] = [];
const realStdout = process.stdout.write.bind(process.stdout);
const realStderr = process.stderr.write.bind(process.stderr);

function capture(chunk: unknown): void {
  captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString());
}

before(async () => {
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    capture(chunk);
    return (realStdout as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    capture(chunk);
    return (realStderr as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  server = await startTestServer();
  api = client(server.baseUrl);
  origin = new URL(server.baseUrl).origin;
});

beforeEach(async () => {
  await resetDatabase();
  clearAccountStatusCache();
  resetRateLimits();
  publisherId = await createPublisher();
  bookId = await createBook(publisherId);
  assetId = (await pool.query('SELECT current_asset_id FROM books WHERE id = $1', [bookId])).rows[0]
    .current_asset_id;
  buyer = await createUser();
  stranger = await createUser();
  admin = await createUser({ role: 'admin' });
  await buy(api, buyer.token, [bookId]);
  deviceId = await registerDevice(buyer);
});

afterEach(() => {
  setObjectStorageForTests(null);
  setPublishHookForTests(null);
});

after(async () => {
  process.stdout.write = realStdout;
  process.stderr.write = realStderr;
  await server.close();
});

async function registerDevice(user: TestUser): Promise<string> {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const res = await api('POST', '/devices', {
    token: user.token,
    body: {
      platform: 'android',
      displayName: 'Phone',
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    },
  });
  assert.equal(res.status, 201);
  return res.body.device.id;
}

function authorize(user: TestUser, asset = assetId, device = deviceId) {
  return api('POST', `/assets/${asset}/download-authorizations`, {
    token: user.token,
    body: { deviceId: device },
  });
}

async function grant() {
  const res = await authorize(buyer);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { downloadUrl: string; expiresAt: string; sizeBytes: number; sha256: string };
}

async function lastLog(): Promise<{ decision: string; reason_code: string | null }> {
  const { rows } = await pool.query(
    'SELECT decision, reason_code FROM asset_access_logs ORDER BY created_at DESC, id DESC LIMIT 1',
  );
  return rows[0];
}

async function expectDenied(res: Awaited<ReturnType<typeof authorize>>, reason: string) {
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'ASSET_ACCESS_DENIED');
  assert.deepEqual(Object.keys(res.body.error).sort(), ['code', 'message', 'requestId']);
  assert.deepEqual(await lastLog(), { decision: 'deny', reason_code: reason });
}

describe('download authorization', () => {
  it('grants a URL; the bytes hash to sha256; ranges work', async () => {
    const g = await grant();
    assert.equal(g.downloadUrl.startsWith('/api/v1/asset-downloads/'), true);
    assert.ok(new Date(g.expiresAt).getTime() > Date.now());

    const full = await fetch(origin + g.downloadUrl);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('cache-control'), 'no-store');
    assert.equal(full.headers.get('content-type'), 'application/octet-stream');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('etag'), `"${g.sha256}"`);
    const bytes = Buffer.from(await full.arrayBuffer());
    assert.equal(bytes.length, g.sizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), g.sha256);

    // Reusable within its lifetime.
    const range = await fetch(origin + g.downloadUrl, { headers: { Range: 'bytes=0-15' } });
    assert.equal(range.status, 206);
    const part = Buffer.from(await range.arrayBuffer());
    assert.equal(part.length, 16);
    assert.deepEqual(part, bytes.subarray(0, 16));
    assert.equal(range.headers.get('content-range'), `bytes 0-15/${g.sizeBytes}`);

    const log = await pool.query(`SELECT 1 FROM asset_access_logs WHERE decision = 'allow'`);
    assert.equal(log.rowCount, 1);
  });

  it('stores only the token hash', async () => {
    const g = await grant();
    const token = g.downloadUrl.split('/').pop() as string;
    const { rows } = await pool.query('SELECT token_sha256, expires_at FROM download_grants');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token_sha256, createHash('sha256').update(token).digest('hex'));
    assert.equal(token.length, 43);
    const ttl = new Date(rows[0].expires_at).getTime() - Date.now();
    assert.ok(ttl > 4 * 60_000 && ttl <= 5 * 60_000);
  });

  it('handles suffix ranges, clamping, and bad ranges (Review Focus 5)', async () => {
    const g = await grant();
    const url = origin + g.downloadUrl;
    const size = g.sizeBytes;
    const get = async (range: string) => {
      const res = await fetch(url, { headers: { Range: range } });
      return { res, body: Buffer.from(await res.arrayBuffer()) };
    };

    const beyond = await get('bytes=999999999-');
    assert.equal(beyond.res.status, 416);
    assert.equal(beyond.res.headers.get('content-range'), `bytes */${size}`);
    assert.equal((await get(`bytes=${size}-`)).res.status, 416);
    assert.equal((await get('bytes=10-5')).res.status, 416);
    assert.equal((await get('bytes=-0')).res.status, 416);

    for (const malformed of ['bytes=abc', 'items=0-5', 'bytes=0-1,4-5', 'bytes=-', 'bytes=1-2-3']) {
      const { res, body } = await get(malformed);
      assert.equal(res.status, 200, malformed);
      assert.equal(body.length, size, malformed);
    }

    const clamped = await get('bytes=5-999999999');
    assert.equal(clamped.res.status, 206);
    assert.equal(clamped.body.length, size - 5);
    assert.equal(clamped.res.headers.get('content-range'), `bytes 5-${size - 1}/${size}`);

    const suffix = await get('bytes=-10');
    assert.equal(suffix.res.status, 206);
    assert.equal(suffix.body.length, 10);
    assert.equal(suffix.res.headers.get('content-range'), `bytes ${size - 10}-${size - 1}/${size}`);

    const bigSuffix = await get('bytes=-999999999');
    assert.equal(bigSuffix.res.status, 206);
    assert.equal(bigSuffix.body.length, size);
  });

  it('404s unknown, malformed and expired tokens', async () => {
    const g = await grant();
    const unknown = await api('GET', `/asset-downloads/${'A'.repeat(43)}`);
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error.code, 'NOT_FOUND');
    assert.equal((await api('GET', '/asset-downloads/nope')).status, 404);

    await pool.query(`UPDATE download_grants SET expires_at = NOW() - INTERVAL '1 second'`);
    const expired = await fetch(origin + g.downloadUrl);
    assert.equal(expired.status, 404);
    await expired.arrayBuffer();
  });

  it('stops serving a granted token once the book is withdrawn', async () => {
    const g = await grant();
    await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [bookId]);
    const res = await fetch(origin + g.downloadUrl);
    assert.equal(res.status, 404);
    await res.arrayBuffer();
  });

  it('stops serving a granted token if the asset is no longer ready', async () => {
    const g = await grant();
    await pool.query(`UPDATE book_assets SET state = 'failed' WHERE id = $1`, [assetId]);
    const res = await fetch(origin + g.downloadUrl);
    assert.equal(res.status, 404);
    await res.arrayBuffer();
  });

  it('denies without an entitlement: NO_ENTITLEMENT', async () => {
    const device = await registerDevice(stranger);
    await expectDenied(await authorize(stranger, assetId, device), 'NO_ENTITLEMENT');
  });

  it('denies after a refund: NO_ENTITLEMENT', async () => {
    const other = await createUser();
    const otherDevice = await registerDevice(other);
    const tx = await buy(api, other.token, [bookId]);
    assert.equal((await authorize(other, assetId, otherDevice)).status, 200);
    const refund = await api('POST', `/sandbox/transactions/${tx}/events`, {
      token: other.token,
      body: { kind: 'refund' },
    });
    assert.equal(refund.status, 200);
    await expectDenied(await authorize(other, assetId, otherDevice), 'NO_ENTITLEMENT');
  });

  it('a suspended account is stopped by requireAuth (403 ACCOUNT_SUSPENDED)', async () => {
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [buyer.id]);
    clearAccountStatusCache();
    const res = await authorize(buyer);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ACCOUNT_SUSPENDED');
  });

  it("denies another user's device: DEVICE_UNKNOWN (same as a missing one)", async () => {
    const strangerDevice = await registerDevice(stranger);
    await expectDenied(await authorize(buyer, assetId, strangerDevice), 'DEVICE_UNKNOWN');
    await expectDenied(
      await authorize(buyer, assetId, '11111111-1111-4111-8111-111111111111'),
      'DEVICE_UNKNOWN',
    );
  });

  it('denies a revoked device: DEVICE_REVOKED', async () => {
    const removed = await api('DELETE', `/devices/${deviceId}`, { token: buyer.token });
    assert.equal(removed.status, 204);
    await expectDenied(await authorize(buyer), 'DEVICE_REVOKED');
  });

  it('denies a withdrawn book: BOOK_WITHDRAWN', async () => {
    await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [bookId]);
    await expectDenied(await authorize(buyer), 'BOOK_WITHDRAWN');
  });

  it('denies an asset that is not ready or does not exist: ASSET_UNAVAILABLE', async () => {
    await pool.query(`UPDATE book_assets SET state = 'failed' WHERE id = $1`, [assetId]);
    await expectDenied(await authorize(buyer), 'ASSET_UNAVAILABLE');
    await expectDenied(
      await authorize(buyer, '22222222-2222-4222-8222-222222222222'),
      'ASSET_UNAVAILABLE',
    );
  });

  it('answers 409 ASSET_SUPERSEDED to the owner, 403 to a non-owner', async () => {
    const v2 = await createReadyAsset(bookId);
    const owner = await authorize(buyer);
    assert.equal(owner.status, 409);
    assert.equal(owner.body.error.code, 'ASSET_SUPERSEDED');
    assert.equal(owner.body.error.details.currentAssetId, v2.assetId);
    assert.equal(owner.body.error.details.version, 2);
    assert.equal(typeof owner.body.error.details.sizeBytes, 'number');
    assert.equal(typeof owner.body.error.details.sha256, 'string');

    const device = await registerDevice(stranger);
    await expectDenied(await authorize(stranger, assetId, device), 'NO_ENTITLEMENT');
    // The current version is still grantable.
    assert.equal((await authorize(buyer, v2.assetId)).status, 200);
  });

  it('keeps an unpublished book downloadable by its owner', async () => {
    await pool.query(`UPDATE books SET is_available = FALSE WHERE id = $1`, [bookId]);
    assert.equal((await authorize(buyer)).status, 200);
  });

  it('rejects a bad body with 400 and anonymous callers with 401', async () => {
    const res = await api('POST', `/assets/${assetId}/download-authorizations`, {
      token: buyer.token,
      body: { deviceId: 'nope' },
    });
    assert.equal(res.status, 400);
    const anon = await api('POST', `/assets/${assetId}/download-authorizations`, {
      body: { deviceId },
    });
    assert.equal(anon.status, 401);
  });
});

describe('rate limits', () => {
  it('429s the 11th authorization for one device and asset', async () => {
    for (let i = 0; i < 10; i++) assert.equal((await authorize(buyer)).status, 200);
    const res = await authorize(buyer);
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'RATE_LIMITED');
    assert.ok(res.headers.get('retry-after'));
    assert.equal((await lastLog()).reason_code, 'RATE_LIMITED');
  });

  it('applies the per-user backstop shared under drm-grants-user', async () => {
    for (let i = 0; i < 299; i++) {
      assert.equal(consumeRateLimit('drm-grants-user', buyer.id, 300, 3_600_000).allowed, true);
    }
    assert.equal((await authorize(buyer)).status, 200);
    const res = await authorize(buyer);
    assert.equal(res.status, 429);
    assert.equal(res.body.error.code, 'RATE_LIMITED');
  });
});

describe('takedown', () => {
  it('lets an admin withdraw (unpublishing) and reinstate (not republishing)', async () => {
    const withdraw = await api('POST', `/admin/books/${bookId}/withdraw`, {
      token: admin.token,
      body: { reason: 'Rights dispute' },
    });
    assert.equal(withdraw.status, 200);
    const { rows } = await pool.query(
      'SELECT withdrawn_at, withdrawn_reason, is_available FROM books WHERE id = $1',
      [bookId],
    );
    assert.ok(rows[0].withdrawn_at);
    assert.equal(rows[0].withdrawn_reason, 'Rights dispute');
    assert.equal(rows[0].is_available, false);
    await expectDenied(await authorize(buyer), 'BOOK_WITHDRAWN');

    const audited = await pool.query(
      `SELECT actor_id FROM audit_events WHERE action = 'book.withdrawn'`,
    );
    assert.equal(audited.rowCount, 1);
    assert.equal(audited.rows[0].actor_id, admin.id);

    const reinstate = await api('POST', `/admin/books/${bookId}/reinstate`, {
      token: admin.token,
    });
    assert.equal(reinstate.status, 200);
    assert.equal(reinstate.body.book.isAvailable, false);
    const restored = await pool.query(
      'SELECT withdrawn_at, is_available FROM books WHERE id = $1',
      [bookId],
    );
    assert.equal(restored.rows[0].withdrawn_at, null);
    assert.equal(restored.rows[0].is_available, false);
    assert.equal((await authorize(buyer)).status, 200);
    assert.equal(
      (await pool.query(`SELECT 1 FROM audit_events WHERE action = 'book.reinstated'`)).rowCount,
      1,
    );
  });

  it('validates the reason and requires an admin', async () => {
    for (const body of [{}, { reason: '' }, { reason: 'x'.repeat(501) }]) {
      const res = await api('POST', `/admin/books/${bookId}/withdraw`, {
        token: admin.token,
        body,
      });
      assert.equal(res.status, 400);
    }
    const forbidden = await api('POST', `/admin/books/${bookId}/withdraw`, {
      token: buyer.token,
      body: { reason: 'nope' },
    });
    assert.equal(forbidden.status, 403);
    const missing = await api(
      'POST',
      '/admin/books/33333333-3333-4333-8333-333333333333/withdraw',
      { token: admin.token, body: { reason: 'gone' } },
    );
    assert.equal(missing.status, 404);
  });

  it('refuses to publish a withdrawn book', async () => {
    await api('POST', `/admin/books/${bookId}/withdraw`, {
      token: admin.token,
      body: { reason: 'Rights dispute' },
    });
    const pub = await createUser({ role: 'publisher', publisherId });
    const res = await api('POST', `/publisher/books/${bookId}/publish`, { token: pub.token });
    assert.equal(res.status, 403);
    const { rows } = await pool.query('SELECT is_available FROM books WHERE id = $1', [bookId]);
    assert.equal(rows[0].is_available, false);
  });

  it('returns 404 for the cover of a withdrawn book', async () => {
    await objectStorage().put(`covers/${bookId}/${assetId}`, PNG_1X1);
    const ok = await fetch(`${server.baseUrl}/books/${bookId}/cover`);
    assert.equal(ok.status, 200);
    await ok.arrayBuffer();

    await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [bookId]);
    const gone = await fetch(`${server.baseUrl}/books/${bookId}/cover`);
    assert.equal(gone.status, 404);
    await gone.arrayBuffer();
  });
});

describe('library asset field', () => {
  it('carries the current ready asset, and null after withdrawal', async () => {
    const { rows } = await pool.query(
      'SELECT version, ciphertext_size_bytes, ciphertext_sha256 FROM book_assets WHERE id = $1',
      [assetId],
    );
    const expected = {
      assetId,
      version: rows[0].version,
      sizeBytes: Number(rows[0].ciphertext_size_bytes),
      sha256: rows[0].ciphertext_sha256,
    };
    const list = await api('GET', '/library', { token: buyer.token });
    assert.deepEqual(list.body.books[0].asset, expected);
    const one = await api('GET', `/library/${bookId}`, { token: buyer.token });
    assert.deepEqual(one.body.book.asset, expected);

    await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [bookId]);
    const listAfter = await api('GET', '/library', { token: buyer.token });
    assert.equal(listAfter.body.books[0].asset, null);
    const oneAfter = await api('GET', `/library/${bookId}`, { token: buyer.token });
    assert.equal(oneAfter.body.book.asset, null);
  });
});

describe('log redaction', () => {
  it('never logs a download token or the token path segment', async () => {
    const g = await grant();
    const token = g.downloadUrl.split('/').pop() as string;
    await (await fetch(origin + g.downloadUrl)).arrayBuffer();
    await (await fetch(origin + g.downloadUrl, { headers: { Range: 'bytes=0-3' } })).arrayBuffer();
    await (await fetch(`${origin}/api/v1/asset-downloads/${'B'.repeat(43)}`)).arrayBuffer();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const log = captured.join('');
    assert.ok(log.includes('request completed'), 'request log must be active for this test');
    assert.ok(log.includes('/asset-downloads/'), 'the route is still logged');
    assert.equal(log.includes(token), false);
    assert.equal(log.includes('B'.repeat(43)), false);
  });
});

describe('streaming proxy', () => {
  function spyStorage() {
    const real = objectStorage();
    const calls = {
      get: 0,
      getRange: 0,
      stream: [] as Array<{ start: number; end: number } | undefined>,
    };
    const spy: ObjectStorage = {
      put: (k, d) => real.put(k, d),
      get: (k) => {
        calls.get++;
        return real.get(k);
      },
      getRange: (k, a, b) => {
        calls.getRange++;
        return real.getRange(k, a, b);
      },
      createReadStream: (k, range) => {
        calls.stream.push(range);
        return real.createReadStream(k, range);
      },
      head: (k) => real.head(k),
      list: (p) => real.list(p),
      delete: (k) => real.delete(k),
    };
    setObjectStorageForTests(spy);
    return calls;
  }

  it('streams full and ranged bodies without buffering them via get/getRange', async () => {
    const g = await grant();
    const calls = spyStorage();
    const full = await fetch(origin + g.downloadUrl);
    const bytes = Buffer.from(await full.arrayBuffer());
    assert.equal(createHash('sha256').update(bytes).digest('hex'), g.sha256);
    const open = await fetch(origin + g.downloadUrl, { headers: { Range: 'bytes=0-' } });
    assert.equal(open.status, 206);
    assert.equal(Buffer.from(await open.arrayBuffer()).length, g.sizeBytes);
    const part = await fetch(origin + g.downloadUrl, { headers: { Range: 'bytes=2-9' } });
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(2, 10));
    assert.equal(calls.get, 0);
    assert.equal(calls.getRange, 0);
    assert.deepEqual(calls.stream, [
      undefined,
      { start: 0, end: g.sizeBytes - 1 },
      { start: 2, end: 9 },
    ]);
  });

  it('answers HEAD with headers and no body, reading nothing', async () => {
    const g = await grant();
    const calls = spyStorage();
    const res = await fetch(origin + g.downloadUrl, { method: 'HEAD' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), String(g.sizeBytes));
    assert.equal(res.headers.get('etag'), `"${g.sha256}"`);
    assert.equal((await res.arrayBuffer()).byteLength, 0);
    assert.equal(calls.get + calls.getRange + calls.stream.length, 0);
  });

  it('survives client aborts and keeps serving', async () => {
    const g = await grant();
    for (let i = 0; i < 5; i++) {
      const controller = new AbortController();
      const res = await fetch(origin + g.downloadUrl, { signal: controller.signal });
      controller.abort();
      await res.arrayBuffer().catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const again = await fetch(origin + g.downloadUrl);
    assert.equal(again.status, 200);
    assert.equal(Buffer.from(await again.arrayBuffer()).length, g.sizeBytes);
  });
});

describe('review fixes', () => {
  it('buckets the limiter by canonical (lower-case) ids', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await api(
        'POST',
        `/assets/${i % 2 ? assetId.toUpperCase() : assetId}/download-authorizations`,
        {
          token: buyer.token,
          body: { deviceId: i % 3 ? deviceId.toUpperCase() : deviceId },
        },
      );
      assert.equal(res.status, 200, String(i));
    }
    const res = await api('POST', `/assets/${assetId.toUpperCase()}/download-authorizations`, {
      token: buyer.token,
      body: { deviceId: deviceId.toUpperCase() },
    });
    assert.equal(res.status, 429);
  });

  it('does not republish a book withdrawn between the check and the update', async () => {
    const pub = await createUser({ role: 'publisher', publisherId });
    await pool.query('UPDATE books SET is_available = FALSE WHERE id = $1', [bookId]);
    setPublishHookForTests(async () => {
      await pool.query(
        `UPDATE books SET withdrawn_at = NOW(), withdrawn_reason = 'race' WHERE id = $1`,
        [bookId],
      );
    });
    const res = await api('POST', `/publisher/books/${bookId}/publish`, { token: pub.token });
    assert.equal(res.status, 403);
    const { rows } = await pool.query('SELECT is_available FROM books WHERE id = $1', [bookId]);
    assert.equal(rows[0].is_available, false);
  });

  it('a lapsed device with no free slot gets 409 DEVICE_LIMIT_REACHED with the counted devices', async () => {
    await pool.query(
      `UPDATE devices SET last_seen_at = NOW() - INTERVAL '100 days' WHERE id = $1`,
      [deviceId],
    );
    for (let i = 0; i < 5; i++) await registerDevice(buyer);
    for (const action of ['download-authorizations', 'decryption-authorizations']) {
      const res = await api('POST', `/assets/${assetId}/${action}`, {
        token: buyer.token,
        body: { deviceId },
      });
      assert.equal(res.status, 409, action);
      assert.equal(res.body.error.code, 'DEVICE_LIMIT_REACHED');
      assert.equal(res.body.error.details.devices.length, 5);
      assert.equal(
        res.body.error.details.devices.every((d: { counted: boolean }) => d.counted),
        true,
      );
      assert.deepEqual(await lastLog(), { decision: 'deny', reason_code: 'DEVICE_LIMIT_REACHED' });
    }
  });

  it('a stranger or a non-entitled caller never sees DEVICE_LIMIT_REACHED', async () => {
    await pool.query(
      `UPDATE devices SET last_seen_at = NOW() - INTERVAL '100 days' WHERE id = $1`,
      [deviceId],
    );
    for (let i = 0; i < 5; i++) await registerDevice(buyer);
    const other = await createUser();
    const res = await authorize(other);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'ASSET_ACCESS_DENIED');
  });

  it('purges download grants expired for more than a day, and nothing else', async () => {
    for (let i = 0; i < 3; i++) await grant();
    const { rows } = await pool.query('SELECT id FROM download_grants ORDER BY created_at, id');
    assert.equal(rows.length, 3);
    // 0: expired two days ago, 1: expired an hour ago, 2: still live.
    await pool.query(
      `UPDATE download_grants SET expires_at = NOW() - INTERVAL '2 days' WHERE id = $1`,
      [rows[0].id],
    );
    await pool.query(
      `UPDATE download_grants SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`,
      [rows[1].id],
    );
    assert.equal(await purgeExpiredDownloadGrants(), 1);
    const left = await pool.query('SELECT id FROM download_grants');
    assert.equal(
      left.rows.some((r) => r.id === rows[0].id),
      false,
    );
    assert.equal(left.rows.length, 2);
    assert.equal(await purgeExpiredDownloadGrants(), 0);
  });
});
