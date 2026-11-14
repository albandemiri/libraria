import {
  client,
  createBook,
  createPublisher,
  createUser,
  grantBook,
  pool,
  resetDatabase,
  startTestServer,
  type TestServer,
  type TestUser,
} from './harness';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { clearAccountStatusCache } from '../../src/auth/account-status';
import { touchDevice } from '../../src/drm/device.service';

let server: TestServer;
let api: ReturnType<typeof client>;
let reader: TestUser;
let other: TestUser;
let admin: TestUser;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  clearAccountStatusCache();
  reader = await createUser();
  other = await createUser();
  admin = await createUser({ role: 'admin' });
});

after(async () => {
  await server.close();
});

function newKey(): string {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64url');
}

function register(user: TestUser, publicKey = newKey(), displayName = 'My phone') {
  return api('POST', '/devices', {
    token: user.token,
    body: { platform: 'android', displayName, publicKey },
  });
}

async function registerN(user: TestUser, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const res = await register(user, newKey(), `Device ${i}`);
    assert.equal(res.status, 201);
    ids.push(res.body.device.id);
  }
  return ids;
}

async function counted(userId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM devices
      WHERE user_id = $1 AND revoked_at IS NULL AND last_seen_at > NOW() - INTERVAL '90 days'`,
    [userId],
  );
  return rows[0].n;
}

async function licensed(ids: string[]) {
  await pool.query('UPDATE devices SET licence_issued = TRUE WHERE id = ANY($1)', [ids]);
}

describe('device registration', () => {
  it('registers 5 devices; the 6th gets DEVICE_LIMIT_REACHED listing the 5', async () => {
    await registerN(reader, 5);
    const sixth = await register(reader);
    assert.equal(sixth.status, 409);
    assert.equal(sixth.body.error.code, 'DEVICE_LIMIT_REACHED');
    assert.equal(sixth.body.error.details.devices.length, 5);
  });

  it('is idempotent on the same key', async () => {
    const key = newKey();
    const first = await register(reader, key);
    assert.equal(first.status, 201);
    const again = await register(reader, key);
    assert.equal(again.status, 200);
    assert.equal(again.body.device.id, first.body.device.id);
  });

  it('does not count a device unseen for 91 days; touching it then hits the limit', async () => {
    const [oldId] = await registerN(reader, 5);
    await pool.query("UPDATE devices SET last_seen_at = NOW() - INTERVAL '91 days' WHERE id = $1", [
      oldId,
    ]);
    const sixth = await register(reader);
    assert.equal(sixth.status, 201);

    await assert.rejects(
      () => touchDevice(oldId),
      (error: { code?: string }) => error.code === 'DEVICE_LIMIT_REACHED',
    );
  });

  it('lets exactly one of two concurrent 6th registrations win', async () => {
    await registerN(reader, 4);
    const [a, b] = await Promise.all([register(reader), register(reader)]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    assert.equal(await counted(reader.id), 5);
  });

  it('rejects bad public keys with 400 VALIDATION_FAILED', async () => {
    const ed = generateKeyPairSync('ed25519')
      .publicKey.export({ type: 'spki', format: 'der' })
      .toString('base64url');
    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
      .publicKey.export({ type: 'spki', format: 'der' })
      .toString('base64url');
    for (const bad of ['garbage!!', ed, p384, 'A'.repeat(10_000), '']) {
      const res = await register(reader, bad);
      assert.equal(res.status, 400, bad.slice(0, 20));
      assert.equal(res.body.error.code, 'VALIDATION_FAILED');
    }
  });

  it('validates displayName (trimmed, 1-60) and platform', async () => {
    assert.equal((await register(reader, newKey(), '   ')).status, 400);
    assert.equal((await register(reader, newKey(), 'x'.repeat(61))).status, 400);
    const ok = await register(reader, newKey(), '  Kindle  ');
    assert.equal(ok.body.device.displayName, 'Kindle');
    const badPlatform = await api('POST', '/devices', {
      token: reader.token,
      body: { platform: 'toaster', displayName: 'x', publicKey: newKey() },
    });
    assert.equal(badPlatform.status, 400);
  });

  it('lists own devices with counted flag, and never exposes keys', async () => {
    await registerN(reader, 2);
    const res = await api('GET', '/devices', { token: reader.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.devices.length, 2);
    assert.equal(res.body.devices[0].counted, true);
    assert.equal(JSON.stringify(res.body).toLowerCase().includes('publickey'), false);
  });

  it('requires authentication', async () => {
    assert.equal((await api('GET', '/devices')).status, 401);
  });
});

describe('device removal', () => {
  it('allows 3 counted removals in 365 days, then DEVICE_REMOVAL_LIMIT', async () => {
    const ids = await registerN(reader, 5);
    await licensed(ids);
    for (const id of ids.slice(0, 3)) {
      assert.equal((await api('DELETE', `/devices/${id}`, { token: reader.token })).status, 204);
    }
    const fourth = await api('DELETE', `/devices/${ids[3]}`, { token: reader.token });
    assert.equal(fourth.status, 409);
    assert.equal(fourth.body.error.code, 'DEVICE_REMOVAL_LIMIT');
  });

  it('does not count removals of never-licensed devices', async () => {
    const ids = await registerN(reader, 5);
    await licensed(ids.slice(0, 3));
    for (const id of ids.slice(0, 3)) {
      await api('DELETE', `/devices/${id}`, { token: reader.token });
    }
    const res = await api('DELETE', `/devices/${ids[4]}`, { token: reader.token });
    assert.equal(res.status, 204);
  });

  it('removing a never-licensed device still works at the limit', async () => {
    const ids = await registerN(reader, 5);
    await licensed(ids.slice(0, 4));
    for (const id of ids.slice(0, 3)) {
      await api('DELETE', `/devices/${id}`, { token: reader.token });
    }
    assert.equal((await api('DELETE', `/devices/${ids[3]}`, { token: reader.token })).status, 409);
    assert.equal((await api('DELETE', `/devices/${ids[4]}`, { token: reader.token })).status, 204);
  });

  it('ignores removals older than 365 days', async () => {
    const ids = await registerN(reader, 4);
    await licensed(ids);
    for (const id of ids.slice(0, 3)) {
      await api('DELETE', `/devices/${id}`, { token: reader.token });
    }
    await pool.query("UPDATE device_removals SET removed_at = NOW() - INTERVAL '366 days'");
    assert.equal((await api('DELETE', `/devices/${ids[3]}`, { token: reader.token })).status, 204);
  });

  it('frees a slot after removal and hides the device from the list', async () => {
    const ids = await registerN(reader, 5);
    await api('DELETE', `/devices/${ids[0]}`, { token: reader.token });
    assert.equal((await register(reader)).status, 201);
    const list = await api('GET', '/devices', { token: reader.token });
    assert.equal(
      list.body.devices.some((d: { id: string }) => d.id === ids[0]),
      false,
    );
  });

  it('admin reset lets the reader remove again and audits', async () => {
    const ids = await registerN(reader, 5);
    await licensed(ids);
    for (const id of ids.slice(0, 3)) {
      await api('DELETE', `/devices/${id}`, { token: reader.token });
    }
    assert.equal((await api('DELETE', `/devices/${ids[3]}`, { token: reader.token })).status, 409);

    const reset = await api('POST', `/admin/users/${reader.id}/device-removals/reset`, {
      token: admin.token,
    });
    assert.equal(reset.status, 204);
    assert.equal((await api('DELETE', `/devices/${ids[3]}`, { token: reader.token })).status, 204);

    const { rows } = await pool.query(
      "SELECT actor_id FROM audit_events WHERE action = 'device.removals_reset' AND resource_id = $1",
      [reader.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actor_id, admin.id);
  });

  it('admin removal works beyond the limit, is not counted, and audits', async () => {
    const ids = await registerN(reader, 5);
    await licensed(ids);
    for (const id of ids.slice(0, 3)) {
      await api('DELETE', `/devices/${id}`, { token: reader.token });
    }
    const res = await api('DELETE', `/admin/devices/${ids[3]}`, { token: admin.token });
    assert.equal(res.status, 204);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM device_removals WHERE user_id = $1',
      [reader.id],
    );
    assert.equal(rows[0].n, 3);
    const audits = await pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'device.revoked_by_admin' AND resource_id = $1",
      [ids[3]],
    );
    assert.equal(audits.rowCount, 1);
    const own = await pool.query("SELECT 1 FROM audit_events WHERE action = 'device.removed'");
    assert.equal(own.rowCount, 3);
  });

  it('admin can list a user devices, including revoked; readers cannot', async () => {
    const ids = await registerN(reader, 2);
    await api('DELETE', `/devices/${ids[0]}`, { token: reader.token });
    const res = await api('GET', `/admin/users/${reader.id}/devices`, { token: admin.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.devices.length, 2);
    assert.ok(res.body.devices.some((d: { revokedAt: string | null }) => d.revokedAt));
    const denied = await api('GET', `/admin/users/${reader.id}/devices`, { token: reader.token });
    assert.equal(denied.status, 403);
  });

  it('keeps users apart: another user gets 404 on remove and sees nothing', async () => {
    const [id] = await registerN(reader, 1);
    const del = await api('DELETE', `/devices/${id}`, { token: other.token });
    assert.equal(del.status, 404);
    const list = await api('GET', '/devices', { token: other.token });
    assert.deepEqual(list.body.devices, []);
  });

  it('refuses re-registering an admin-revoked key', async () => {
    const key = newKey();
    const first = await register(reader, key);
    await api('DELETE', `/admin/devices/${first.body.device.id}`, { token: admin.token });
    const again = await register(reader, key);
    assert.equal(again.status, 403);
  });
});

describe('account suspension', () => {
  const PASSWORD = 'correct-horse-battery';

  it('suspends and reactivates, effective on the next request', async () => {
    const publisherId = await createPublisher();
    const bookId = await createBook(publisherId);
    await grantBook(reader.id, bookId);
    assert.equal((await api('GET', '/library', { token: reader.token })).status, 200);

    const suspend = await api('PATCH', `/admin/users/${reader.id}/status`, {
      token: admin.token,
      body: { status: 'suspended' },
    });
    assert.equal(suspend.status, 200);
    const denied = await api('GET', '/library', { token: reader.token });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'ACCOUNT_SUSPENDED');

    await api('PATCH', `/admin/users/${reader.id}/status`, {
      token: admin.token,
      body: { status: 'active' },
    });
    assert.equal((await api('GET', '/library', { token: reader.token })).status, 200);

    const { rows } = await pool.query(
      "SELECT metadata FROM audit_events WHERE action = 'user.status_changed'",
    );
    assert.equal(rows.length, 2);
  });

  it('refuses both logins for a suspended account', async () => {
    const reg = await api('POST', '/auth/register', {
      body: { email: 'susp@reader.test', password: PASSWORD },
    });
    const id = reg.body.user.id;
    const publisherId = await createPublisher();
    await pool.query(
      "UPDATE users SET status = 'suspended', role = 'publisher', publisher_id = $2 WHERE id = $1",
      [id, publisherId],
    );
    const login = await api('POST', '/auth/login', {
      body: { email: 'susp@reader.test', password: PASSWORD },
    });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, 'ACCOUNT_SUSPENDED');
    const portal = await api('POST', '/auth/portal/login', {
      body: { email: 'susp@reader.test', password: PASSWORD },
    });
    assert.equal(portal.status, 403);
    assert.equal(portal.body.error.code, 'ACCOUNT_SUSPENDED');
    const wrong = await api('POST', '/auth/login', {
      body: { email: 'susp@reader.test', password: 'wrong-password-xx' },
    });
    assert.equal(wrong.status, 401);
  });

  it('returns 401 for a deleted user and validates the status body', async () => {
    const ghost = await createUser();
    await pool.query('DELETE FROM users WHERE id = $1', [ghost.id]);
    clearAccountStatusCache();
    assert.equal((await api('GET', '/library', { token: ghost.token })).status, 401);
    const bad = await api('PATCH', `/admin/users/${reader.id}/status`, {
      token: admin.token,
      body: { status: 'banned' },
    });
    assert.equal(bad.status, 400);
    const missing = await api('PATCH', `/admin/users/${ghost.id}/status`, {
      token: admin.token,
      body: { status: 'suspended' },
    });
    assert.equal(missing.status, 404);
  });

  it('refuses an admin suspending themselves', async () => {
    const res = await api('PATCH', `/admin/users/${admin.id}/status`, {
      token: admin.token,
      body: { status: 'suspended' },
    });
    assert.equal(res.status, 400);
  });
});
