import './asset-delivery.env';
import {
  buy,
  client,
  createBook,
  createPublisher,
  createUser,
  pool,
  resetDatabase,
  sampleEpub,
  startTestServer,
  type TestServer,
  type TestUser,
} from './harness';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { clearAccountStatusCache } from '../../src/auth/account-status';
import { activateAsset, ingestNow, processNextJob } from '../../src/drm/asset-ingestion.service';
import { assetAad, decryptAsset } from '../../src/drm/encryption.service';
import { unwrapDekForDevice, verifyLicence } from '../../src/drm/licence-crypto';
import { licenceStatuses, setIssuanceHookForTests } from '../../src/drm/licence.service';
import { resetRateLimits } from '../../src/middleware/rate-limit';

let server: TestServer;
let api: ReturnType<typeof client>;
let origin: string;
let bookId: string;
let assetId: string;
let buyer: TestUser;
let stranger: TestUser;
let staff: TestUser;
let device: Device;

interface Device {
  id: string;
  privateKey: KeyObject;
}

const ZERO_ID = '00000000-0000-4000-8000-000000000000';

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
  captured.length = 0;
  const publisherId = await createPublisher();
  bookId = await createBook(publisherId);
  assetId = (await pool.query('SELECT current_asset_id FROM books WHERE id = $1', [bookId])).rows[0]
    .current_asset_id;
  buyer = await createUser();
  stranger = await createUser();
  staff = await createUser({ role: 'admin' });
  await buy(api, buyer.token, [bookId]);
  device = await registerDevice(buyer);
});

afterEach(() => {
  setIssuanceHookForTests(null);
});

after(async () => {
  process.stdout.write = realStdout;
  process.stderr.write = realStderr;
  await server.close();
});

async function registerDevice(user: TestUser): Promise<Device> {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const res = await api('POST', '/devices', {
    token: user.token,
    body: {
      platform: 'android',
      displayName: 'Phone',
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    },
  });
  assert.equal(res.status, 201);
  return { id: res.body.device.id, privateKey };
}

function requestLicence(user = buyer, asset = assetId, deviceId = device.id) {
  return api('POST', `/assets/${asset}/decryption-authorizations`, {
    token: user.token,
    body: { deviceId },
  });
}

// biome-ignore lint/suspicious/noExplicitAny: licence JSON is asserted field by field.
async function licence(): Promise<Record<string, any>> {
  const res = await requestLicence();
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.licence;
}

function statuses(licenceIds: string[], user = buyer, deviceId = device.id) {
  return api('POST', '/licences/status', { token: user.token, body: { deviceId, licenceIds } });
}

async function statusOf(licenceId: string) {
  const res = await statuses([licenceId]);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.licences[0];
}

async function upload(body: Buffer, book: string) {
  const response = await fetch(`${server.baseUrl}/publisher/books/${book}/assets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${staff.token}`, 'Content-Type': 'application/epub+zip' },
    body: new Uint8Array(body),
  });
  return { status: response.status, body: await response.json() };
}

describe('device licences', () => {
  it('end to end: upload, buy, register, download, licence, decrypt', async () => {
    const epub = sampleEpub('End To End');
    const fresh = await createBook(await createPublisher('E2E House'), { available: false });
    const up = await upload(epub, fresh);
    assert.equal(up.status, 202);
    assert.equal(await processNextJob(), 'processed');
    const published = await api('POST', `/publisher/books/${fresh}/publish`, {
      token: staff.token,
    });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const newAssetId: string = up.body.asset.id;

    await buy(api, buyer.token, [fresh]);
    const grant = await api('POST', `/assets/${newAssetId}/download-authorizations`, {
      token: buyer.token,
      body: { deviceId: device.id },
    });
    assert.equal(grant.status, 200, JSON.stringify(grant.body));
    const ciphertext = Buffer.from(
      await (await fetch(origin + grant.body.downloadUrl)).arrayBuffer(),
    );

    const res = await requestLicence(buyer, newAssetId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const lic = res.body.licence;
    assert.equal(lic.v, 1);
    assert.equal(lic.assetId, newAssetId);
    assert.equal(lic.bookId, fresh);
    assert.equal(lic.deviceId, device.id);
    assert.equal(lic.assetVersion, 1);
    assert.equal(lic.wrappedKey.alg, 'ECDH-ES+HKDF-SHA256+A256GCM');
    assert.equal(lic.content.algorithm, 'AES-256-GCM');

    const key = await api('GET', '/drm/licence-signing-key');
    assert.equal(key.status, 200);
    assert.equal(key.body.algorithm, 'Ed25519');
    assert.match(key.body.kid, /^[0-9a-f]{16}$/);
    assert.equal(lic.kid, key.body.kid, 'the licence names the key that signed it');
    assert.equal(
      createHash('sha256')
        .update(createPublicKey(key.body.publicKeyPem).export({ type: 'spki', format: 'der' }))
        .digest('hex')
        .slice(0, 16),
      key.body.kid,
    );
    assert.equal(
      verifyLicence({ ...lic, kid: '0000000000000000' } as never, key.body.publicKeyPem),
      false,
      'kid is signed',
    );
    assert.equal(verifyLicence(lic as never, key.body.publicKeyPem), true);
    assert.equal(
      verifyLicence({ ...lic, bookId: stranger.id } as never, key.body.publicKeyPem),
      false,
    );

    const dek = unwrapDekForDevice(lic.wrappedKey, device.privateKey, {
      licenceId: lic.licenceId,
      assetId: newAssetId,
      deviceId: device.id,
    });
    try {
      const plain = decryptAsset(
        ciphertext,
        dek,
        Buffer.from(lic.content.nonce, 'base64url'),
        Buffer.from(lic.content.authTag, 'base64url'),
        assetAad(lic.content.aad),
      );
      assert.ok(plain.equals(epub));
    } finally {
      dek.fill(0);
    }

    assert.equal(
      new Date(lic.expiresAt).getTime() - new Date(lic.issuedAt).getTime(),
      30 * 24 * 60 * 60 * 1000,
    );
    assert.equal(
      (await pool.query('SELECT licence_issued FROM devices WHERE id = $1', [device.id])).rows[0]
        .licence_issued,
      true,
    );
  });

  it('licence is useless on another device', async () => {
    const other = await registerDevice(buyer);
    const lic = await licence();
    assert.throws(() =>
      unwrapDekForDevice(lic.wrappedKey, other.privateKey, {
        licenceId: lic.licenceId,
        assetId,
        deviceId: device.id,
      }),
    );
  });

  it('renewal supersedes the old licence', async () => {
    const first = await licence();
    const second = await licence();
    assert.notEqual(first.licenceId, second.licenceId);
    assert.equal((await statusOf(first.licenceId)).status, 'superseded');
    assert.equal((await statusOf(second.licenceId)).status, 'valid');
  });

  it('refund revokes at next check-in', async () => {
    const lic = await licence();
    const { rows } = await pool.query(
      `SELECT t.id FROM transactions t JOIN transaction_items ti ON ti.transaction_id = t.id
        WHERE t.user_id = $1 AND ti.book_id = $2`,
      [buyer.id, bookId],
    );
    const refund = await api('POST', `/sandbox/transactions/${rows[0].id}/events`, {
      token: buyer.token,
      body: { kind: 'refund' },
    });
    assert.equal(refund.status, 200, JSON.stringify(refund.body));
    assert.equal((await statusOf(lic.licenceId)).status, 'revoked');
    const again = await requestLicence();
    assert.equal(again.status, 403);
    assert.equal(again.body.error.code, 'ASSET_ACCESS_DENIED');
  });

  it('withdrawn book, revoked device and suspended account report revoked', async () => {
    const lic = await licence();
    await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [bookId]);
    assert.equal((await statusOf(lic.licenceId)).status, 'revoked');
    await pool.query(`UPDATE books SET withdrawn_at = NULL WHERE id = $1`, [bookId]);
    assert.equal((await statusOf(lic.licenceId)).status, 'valid');
    await pool.query(`UPDATE devices SET revoked_at = NOW() WHERE id = $1`, [device.id]);
    assert.equal((await statusOf(lic.licenceId)).status, 'revoked');
    await pool.query(`UPDATE devices SET revoked_at = NULL WHERE id = $1`, [device.id]);
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [buyer.id]);
    clearAccountStatusCache();
    const out = await licenceStatuses(buyer.id, device.id, [lic.licenceId]);
    assert.equal(out[0].status, 'revoked');
  });

  it('a suspended account gets revoked at check-in over HTTP, without refreshing last_seen_at', async () => {
    const lic = await licence();
    await pool.query(`UPDATE devices SET last_seen_at = NOW() - INTERVAL '2 days' WHERE id = $1`, [
      device.id,
    ]);
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [buyer.id]);
    clearAccountStatusCache();
    const res = await statuses([lic.licenceId]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.licences[0].status, 'revoked');
    const seen = await pool.query(
      `SELECT last_seen_at < NOW() - INTERVAL '1 day' AS stale FROM devices WHERE id = $1`,
      [device.id],
    );
    assert.equal(seen.rows[0].stale, true, 'a suspended account does not refresh last_seen_at');
    // Still needs a token and ownership of the device; other routes still refuse it.
    assert.equal(
      (
        await api('POST', '/licences/status', {
          body: { deviceId: device.id, licenceIds: [lic.licenceId] },
        })
      ).status,
      401,
    );
    assert.equal((await statuses([lic.licenceId], stranger)).status, 403);
    assert.equal((await requestLicence()).status, 403);
    assert.equal(
      (await api('GET', '/devices', { token: buyer.token })).body.error.code,
      'ACCOUNT_SUSPENDED',
    );
  });

  it('new version shows as replaced', async () => {
    const lic = await licence();
    const v2 = await ingestNow(bookId, staff.id, sampleEpub('Two'));
    await activateAsset(bookId, v2.id, staff.id);
    const status = await statusOf(lic.licenceId);
    assert.equal(status.status, 'replaced');
    assert.equal(status.currentAsset.assetId, v2.id);
    assert.equal(status.currentAsset.version, 2);
    assert.equal(typeof status.currentAsset.sizeBytes, 'number');
    assert.equal(typeof status.currentAsset.sha256, 'string');

    // The old version can no longer be licensed; the new one can.
    assert.equal((await requestLicence()).status, 409);
    assert.equal((await requestLicence(buyer, v2.id)).status, 200);
  });

  it('device-access removal', async () => {
    const lic = await licence();
    const other = await registerDevice(buyer);
    const otherLic = (await requestLicence(buyer, assetId, other.id)).body.licence;

    const res = await api('DELETE', `/library/${bookId}/device-access`, {
      token: buyer.token,
      body: { deviceId: device.id },
    });
    assert.equal(res.status, 204);
    assert.equal((await statusOf(lic.licenceId)).status, 'revoked');
    const { rows } = await pool.query('SELECT revoked_at FROM devices WHERE id = $1', [device.id]);
    assert.equal(rows[0].revoked_at, null);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM device_removals')).rows[0].n, 0);
    // Other device untouched.
    const otherStatus = await statuses([otherLic.licenceId], buyer, other.id);
    assert.equal(otherStatus.body.licences[0].status, 'valid');
    // The device can ask for a fresh licence; the revoked one stays revoked.
    const fresh = await licence();
    assert.equal((await statusOf(fresh.licenceId)).status, 'valid');
    assert.equal((await statusOf(lic.licenceId)).status, 'revoked');
  });

  it('device-access removal for another users device is 404', async () => {
    const res = await api('DELETE', `/library/${bookId}/device-access`, {
      token: stranger.token,
      body: { deviceId: device.id },
    });
    assert.equal(res.status, 404);
  });

  it('status only for own device', async () => {
    const lic = await licence();
    const mine = await statuses([lic.licenceId, ZERO_ID]);
    assert.deepEqual(
      mine.body.licences.map((l: { status: string }) => l.status),
      ['valid', 'unknown'],
    );

    const theirDevice = await registerDevice(stranger);
    const theirs = await statuses([lic.licenceId], stranger, theirDevice.id);
    assert.equal(theirs.status, 200);
    assert.deepEqual(theirs.body.licences, [{ licenceId: lic.licenceId, status: 'unknown' }]);

    const foreign = await statuses([lic.licenceId], stranger, device.id);
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.error.code, 'ASSET_ACCESS_DENIED');

    // Also unknown when it is the same user's licence but another of their devices.
    const sibling = await registerDevice(buyer);
    const viaSibling = await statuses([lic.licenceId], buyer, sibling.id);
    assert.equal(viaSibling.body.licences[0].status, 'unknown');
  });

  it('status input validation and authentication', async () => {
    assert.equal((await statuses([])).status, 400);
    assert.equal((await statuses(Array.from({ length: 501 }, () => ZERO_ID))).status, 400);
    assert.equal((await statuses(['nope'])).status, 400);
    const unauth = await api('POST', '/licences/status', {
      body: { deviceId: device.id, licenceIds: [ZERO_ID] },
    });
    assert.equal(unauth.status, 401);
  });

  it('licence requests are rate limited per device and asset, case-insensitively', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await requestLicence(buyer, i % 2 ? assetId.toUpperCase() : assetId);
      assert.equal(res.status, 200);
    }
    const limited = await requestLicence(buyer, assetId.toUpperCase(), device.id.toUpperCase());
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
    assert.ok(limited.headers.get('retry-after'));
  });

  it('status is rate limited per device', async () => {
    for (let i = 0; i < 60; i++) assert.equal((await statuses([ZERO_ID])).status, 200);
    const limited = await statuses([ZERO_ID]);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'RATE_LIMITED');
  });

  it('licence never logged', async () => {
    const lic = await licence();
    await statusOf(lic.licenceId);
    await api('DELETE', `/library/${bookId}/device-access`, {
      token: buyer.token,
      body: { deviceId: device.id },
    });
    const logs = captured.join('');
    assert.ok(logs.length > 0, 'logging is captured');
    assert.equal(logs.includes(lic.wrappedKey.ciphertext), false);
    assert.equal(logs.includes(lic.wrappedKey.epk), false);
    assert.equal(logs.includes(lic.signature), false);
    const audits = JSON.stringify((await pool.query('SELECT * FROM audit_events')).rows);
    assert.equal(audits.includes(lic.signature), false);
    assert.equal(audits.includes(lic.wrappedKey.ciphertext), false);
    const stored = JSON.stringify((await pool.query('SELECT * FROM licences')).rows);
    assert.equal(stored.includes(lic.wrappedKey.ciphertext), false);
    assert.equal(stored.includes(lic.signature), false);
  });

  it('expired', async () => {
    const lic = await licence();
    await pool.query(`UPDATE licences SET expires_at = NOW() - interval '1 second'`);
    assert.equal((await statusOf(lic.licenceId)).status, 'expired');
  });

  it('precedence: revoked, then replaced, then superseded, then expired', async () => {
    const first = await licence();
    await licence(); // first is now superseded
    await pool.query(`UPDATE licences SET expires_at = NOW() - interval '1 second'`);
    assert.equal((await statusOf(first.licenceId)).status, 'superseded');
    const v2 = await ingestNow(bookId, staff.id, sampleEpub('Two'));
    await activateAsset(bookId, v2.id, staff.id);
    assert.equal((await statusOf(first.licenceId)).status, 'replaced');
    await api('DELETE', `/library/${bookId}/device-access`, {
      token: buyer.token,
      body: { deviceId: device.id },
    });
    assert.equal((await statusOf(first.licenceId)).status, 'revoked');
  });

  it('licence ids are matched case-insensitively', async () => {
    const lic = await licence();
    const res = await statuses([lic.licenceId.toUpperCase()]);
    assert.equal(res.body.licences[0].status, 'valid');
    assert.equal(res.body.licences[0].licenceId, lic.licenceId);
  });

  it('status check-in refreshes last_seen_at; a revoked device is not resurrected', async () => {
    const lic = await licence();
    await pool.query(`UPDATE devices SET last_seen_at = NOW() - interval '80 days' WHERE id = $1`, [
      device.id,
    ]);
    const before = (await pool.query('SELECT last_seen_at FROM devices WHERE id = $1', [device.id]))
      .rows[0].last_seen_at;
    assert.equal((await statuses([lic.licenceId])).status, 200);
    const after = (await pool.query('SELECT last_seen_at FROM devices WHERE id = $1', [device.id]))
      .rows[0].last_seen_at;
    assert.ok(after.getTime() > before.getTime() + 79 * 24 * 3600 * 1000);

    await pool.query(
      `UPDATE devices SET revoked_at = NOW(), last_seen_at = NOW() - interval '10 days' WHERE id = $1`,
      [device.id],
    );
    const seen = (await pool.query('SELECT last_seen_at FROM devices WHERE id = $1', [device.id]))
      .rows[0].last_seen_at;
    const res = await statuses([lic.licenceId]);
    assert.equal(res.status, 200);
    assert.equal(res.body.licences[0].status, 'revoked');
    const unchanged = (
      await pool.query('SELECT last_seen_at FROM devices WHERE id = $1', [device.id])
    ).rows[0].last_seen_at;
    assert.equal(unchanged.getTime(), seen.getTime());
  });

  it('a lapsed device is not revived by a check-in', async () => {
    const lic = await licence();
    await pool.query(`UPDATE devices SET last_seen_at = NOW() - interval '91 days' WHERE id = $1`, [
      device.id,
    ]);
    for (let i = 0; i < 5; i++) await registerDevice(buyer);
    const seen = (await pool.query('SELECT last_seen_at FROM devices WHERE id = $1', [device.id]))
      .rows[0].last_seen_at;
    const res = await statuses([lic.licenceId]);
    assert.equal(res.status, 200);
    assert.equal(res.body.licences[0].status, 'valid');
    const after = (await pool.query('SELECT last_seen_at FROM devices WHERE id = $1', [device.id]))
      .rows[0].last_seen_at;
    assert.equal(after.getTime(), seen.getTime());
    const counted = await api('GET', '/devices', { token: buyer.token });
    assert.equal(counted.body.devices.filter((d: { counted: boolean }) => d.counted).length, 5);
  });

  describe('state changing between authorization and issuance', () => {
    async function noLicenceIssued(
      res: Awaited<ReturnType<typeof requestLicence>>,
      code: string,
      status = 403,
    ) {
      assert.equal(res.status, status);
      assert.equal(res.body.error.code, code);
      assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM licences')).rows[0].n, 0);
      assert.equal(JSON.stringify(res.body).includes('wrappedKey'), false);
    }

    it('device revoked in between', async () => {
      setIssuanceHookForTests(async () => {
        await pool.query(`UPDATE devices SET revoked_at = NOW() WHERE id = $1`, [device.id]);
      });
      await noLicenceIssued(await requestLicence(), 'ASSET_ACCESS_DENIED');
      const { rows } = await pool.query(
        `SELECT decision, reason_code, request_id FROM asset_access_logs
          WHERE action = 'decryption_authorization' ORDER BY id`,
      );
      assert.deepEqual(
        rows.map((r) => ({ decision: r.decision, reason_code: r.reason_code })),
        [
          { decision: 'allow', reason_code: null },
          { decision: 'deny', reason_code: 'DEVICE_REVOKED' },
        ],
      );
      // The late denial carries the same request id as the allow it follows.
      assert.ok(rows[1].request_id);
      assert.equal(rows[1].request_id, rows[0].request_id);
    });

    it('new version in between is logged as ASSET_SUPERSEDED', async () => {
      const v2 = await ingestNow(bookId, staff.id, sampleEpub('Two'));
      setIssuanceHookForTests(async () => {
        await activateAsset(bookId, v2.id, staff.id);
      });
      await requestLicence();
      const { rows } = await pool.query(
        `SELECT reason_code FROM asset_access_logs ORDER BY id DESC LIMIT 1`,
      );
      assert.equal(rows[0].reason_code, 'ASSET_SUPERSEDED');
    });

    it('refund in between', async () => {
      setIssuanceHookForTests(async () => {
        await pool.query(
          `UPDATE entitlements SET status = 'revoked', revoked_at = NOW() WHERE user_id = $1`,
          [buyer.id],
        );
      });
      await noLicenceIssued(await requestLicence(), 'ASSET_ACCESS_DENIED');
    });

    it('account suspended in between', async () => {
      setIssuanceHookForTests(async () => {
        await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [buyer.id]);
      });
      await noLicenceIssued(await requestLicence(), 'ASSET_ACCESS_DENIED');
    });

    it('book withdrawn in between', async () => {
      setIssuanceHookForTests(async () => {
        await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [bookId]);
      });
      await noLicenceIssued(await requestLicence(), 'ASSET_ACCESS_DENIED');
    });

    it('new version activated in between', async () => {
      const v2 = await ingestNow(bookId, staff.id, sampleEpub('Two'));
      setIssuanceHookForTests(async () => {
        await activateAsset(bookId, v2.id, staff.id);
      });
      await noLicenceIssued(await requestLicence(), 'ASSET_SUPERSEDED', 409);
    });
  });
});
