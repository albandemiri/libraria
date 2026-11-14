import './asset-ingestion.env';
import {
  createBook,
  createPublisher,
  createUser,
  pool,
  resetDatabase,
  sampleEpub,
  startTestServer,
  type TestServer,
} from './harness';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { env } from '../../src/config/env';
import {
  enqueueUpload,
  ingestNow,
  processNextJob,
  setJobTimingsForTests,
  sweepQuarantine,
} from '../../src/drm/asset-ingestion.service';
import { assetAad, decryptAsset } from '../../src/drm/encryption.service';
import { keyManagement } from '../../src/drm/key-management.service';
import { type MalwareScanner, setMalwareScannerForTests } from '../../src/drm/malware-scanner';
import {
  type ObjectStorage,
  objectStorage,
  setObjectStorageForTests,
} from '../../src/drm/object-storage';
import { resetRateLimits } from '../../src/middleware/rate-limit';

let server: TestServer;
let publisherId: string;
let bookId: string;
let staff: Awaited<ReturnType<typeof createUser>>;

before(async () => {
  server = await startTestServer();
});

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  publisherId = await createPublisher('Hardening House');
  bookId = await createBook(publisherId, { available: false });
  staff = await createUser({ role: 'admin' });
});

afterEach(() => {
  setMalwareScannerForTests(null);
  setObjectStorageForTests(null);
  setJobTimingsForTests(null);
});

after(async () => {
  await server.close();
});

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A promise you resolve from outside, to hold a worker at an exact point. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

async function assetRow(id: string) {
  const { rows } = await pool.query(`SELECT * FROM book_assets WHERE id = $1`, [id]);
  return rows[0];
}

async function jobRow(assetId: string) {
  const { rows } = await pool.query(`SELECT * FROM asset_jobs WHERE asset_id = $1`, [assetId]);
  return rows[0];
}

async function jobsDue(): Promise<void> {
  await pool.query(`UPDATE asset_jobs SET run_after = NOW() - interval '1 second'`);
}

/** Makes the running job look abandoned, so the next processNextJob reclaims it. */
async function makeLockStale(): Promise<void> {
  await pool.query(`UPDATE asset_jobs SET locked_at = NOW() - interval '1 hour'`);
}

function wrapStorage(overrides: Partial<ObjectStorage>): ObjectStorage {
  const real = objectStorage();
  return {
    put: (k, d) => real.put(k, d),
    get: (k) => real.get(k),
    getRange: (k, s, e) => real.getRange(k, s, e),
    createReadStream: (k, r) => real.createReadStream(k, r),
    head: (k) => real.head(k),
    list: (p) => real.list(p),
    delete: (k) => real.delete(k),
    ...overrides,
  };
}

async function decryptStored(assetId: string): Promise<Buffer> {
  const row = await assetRow(assetId);
  const { rows } = await pool.query(`SELECT * FROM asset_keys WHERE asset_id = $1`, [assetId]);
  const key = rows[0];
  const dek = await keyManagement().unwrap(key.wrapped_dek, key.kms_key_id, key.kms_key_version);
  return decryptAsset(
    await objectStorage().get(row.object_key),
    dek,
    row.nonce,
    row.auth_tag,
    assetAad({ assetId, version: row.version, kmsKeyId: key.kms_key_id }),
  );
}

describe('job fencing (finding 1)', () => {
  it('a fenced-out worker never overwrites or alters the winner', async () => {
    const epub = sampleEpub('Fence');
    const asset = await enqueueUpload(bookId, staff.id, epub);
    const real = objectStorage();
    const held = gate();
    const entered = gate();
    let first = true;
    setObjectStorageForTests(
      wrapStorage({
        put: async (key, data) => {
          if (/\/v1\/a1-/.test(key) && first) {
            first = false;
            entered.open();
            await held.opened;
          }
          return real.put(key, data);
        },
      }),
    );

    const loser = processNextJob();
    await entered.opened;
    await makeLockStale();
    assert.equal(await processNextJob(), 'processed'); // reclaims and finishes
    held.open();
    await loser;

    const row = await assetRow(asset.id);
    assert.equal(row.state, 'ready');
    assert.match(row.object_key, /\/v1\/a2-[0-9a-f-]{36}$/);
    assert.ok((await decryptStored(asset.id)).equals(epub));
    // The loser removed its own object and never touched the committed one.
    const leftovers = (await real.list(`assets/${asset.id}/v1/`)).map((o) => o.key);
    assert.deepEqual(leftovers, [row.object_key]);
    const { rows: books } = await pool.query(`SELECT current_asset_id FROM books WHERE id = $1`, [
      bookId,
    ]);
    assert.equal(books[0].current_asset_id, asset.id);
  });

  it('a stale run and a post-retry run with the same attempt number never collide', async () => {
    const epub = sampleEpub('Retry collision');
    const asset = await enqueueUpload(bookId, staff.id, epub);
    const real = objectStorage();
    const held = gate();
    const entered = gate();
    let first = true;
    setObjectStorageForTests(
      wrapStorage({
        put: async (key, data) => {
          if (first && /\/v1\/a1/.test(key)) {
            first = false;
            entered.open();
            await held.opened;
          }
          return real.put(key, data);
        },
      }),
    );

    const stale = processNextJob(); // attempt 1, stalls inside its put
    await entered.opened;
    // What an admin retry does: the job restarts from attempt 0 under a new claim.
    await pool.query(
      `UPDATE asset_jobs SET state = 'queued', attempts = 0, run_after = NOW(), locked_at = NULL, lease_id = NULL`,
    );
    await pool.query(`UPDATE book_assets SET state = 'uploaded' WHERE id = $1`, [asset.id]);
    assert.equal(await processNextJob(), 'processed'); // attempt 1 again, commits
    const committed = (await assetRow(asset.id)).object_key;
    held.open();
    await stale; // its late put lands, then it discards what it wrote

    const row = await assetRow(asset.id);
    assert.equal(row.state, 'ready');
    assert.equal(row.object_key, committed);
    assert.ok((await decryptStored(asset.id)).equals(epub));
  });

  it('a fenced-out worker cannot flip a ready asset back or to failed', async () => {
    const asset = await enqueueUpload(bookId, staff.id, sampleEpub('Flip'));
    const held = gate();
    const entered = gate();
    let calls = 0;
    const scanner: MalwareScanner = {
      scan: async () => {
        calls++;
        if (calls === 1) {
          entered.open();
          await held.opened;
          return { result: 'error', message: 'late failure' };
        }
        return { result: 'clean' };
      },
    };
    setMalwareScannerForTests(scanner);

    const loser = processNextJob();
    await entered.opened;
    await makeLockStale();
    await processNextJob();
    held.open();
    await loser;

    const row = await assetRow(asset.id);
    assert.equal(row.state, 'ready');
    assert.equal(row.reason_code, null);
    assert.equal((await jobRow(asset.id)).state, 'done');
    assert.ok((await decryptStored(asset.id)).length > 0);
  });

  it('a worker that loses its lease notices through the heartbeat and stops', async () => {
    setJobTimingsForTests({ capMs: 60_000, heartbeatMs: 100 });
    await enqueueUpload(bookId, staff.id, sampleEpub('Heartbeat'));
    setMalwareScannerForTests({ scan: () => new Promise(() => {}) });

    const run = processNextJob();
    await sleep(300);
    await pool.query(`UPDATE asset_jobs SET lease_id = gen_random_uuid()`);
    const outcome = await Promise.race([run, sleep(3000).then(() => 'hung')]);
    assert.equal(outcome, 'processed');
  });
});

describe('wall-clock cap (finding 3)', () => {
  it('aborts a hung run as a retryable failure and never leaves the book stuck', async () => {
    setJobTimingsForTests({ capMs: 300, heartbeatMs: 50 });
    setMalwareScannerForTests({ scan: () => new Promise(() => {}) });
    const asset = await enqueueUpload(bookId, staff.id, sampleEpub('Hung'));

    const first = await Promise.race([processNextJob(), sleep(5000).then(() => 'hung')]);
    assert.equal(first, 'processed');
    let job = await jobRow(asset.id);
    assert.equal(job.state, 'queued');
    assert.equal(job.last_error_code, 'PROCESSING_TIMEOUT');
    assert.equal((await assetRow(asset.id)).state, 'uploaded');

    for (let i = 0; i < 2; i++) {
      await jobsDue();
      assert.equal(
        await Promise.race([processNextJob(), sleep(5000).then(() => 'hung')]),
        'processed',
      );
    }
    const row = await assetRow(asset.id);
    assert.equal(row.state, 'failed');
    assert.equal(row.reason_code, 'PROCESSING_TIMEOUT');
    job = await jobRow(asset.id);
    assert.equal(job.state, 'failed');

    // The book can take a new upload again.
    setMalwareScannerForTests(null);
    const next = await ingestNow(bookId, staff.id, sampleEpub('Again'));
    assert.equal(next.state, 'ready');
  });
});

describe('quarantine cleanup (finding 4)', () => {
  it('sweeps originals whose immediate delete failed, once, without re-checking them', async () => {
    let failDeletes = true;
    const real = objectStorage();
    setObjectStorageForTests(
      wrapStorage({
        delete: async (key) => {
          if (failDeletes && key.startsWith('quarantine/')) throw new Error('disk error');
          return real.delete(key);
        },
      }),
    );
    const ready = await ingestNow(bookId, staff.id, sampleEpub('Ready'));
    assert.equal(ready.state, 'ready');
    const rejectedBook = await createBook(publisherId, { available: false });
    const rejected = await ingestNow(rejectedBook, staff.id, Buffer.from('not an epub at all'));
    assert.equal(rejected.state, 'rejected');
    assert.ok(await objectStorage().head(`quarantine/${ready.id}`));
    assert.ok(await objectStorage().head(`quarantine/${rejected.id}`));
    assert.equal((await assetRow(ready.id)).quarantine_deleted_at, null);

    failDeletes = false;
    assert.equal(await sweepQuarantine(), 2);
    assert.equal(await objectStorage().head(`quarantine/${ready.id}`), null);
    assert.equal(await objectStorage().head(`quarantine/${rejected.id}`), null);
    assert.ok((await assetRow(ready.id)).quarantine_deleted_at);

    // Recorded: a second sweep does not look at them again.
    let heads = 0;
    setObjectStorageForTests(null);
    setObjectStorageForTests(
      wrapStorage({
        head: async (key) => {
          heads++;
          return real.head(key);
        },
      }),
    );
    assert.equal(await sweepQuarantine(), 0);
    assert.equal(heads, 0);
  });

  it('a successful immediate delete is recorded', async () => {
    const ready = await ingestNow(bookId, staff.id, sampleEpub('Clean'));
    assert.ok((await assetRow(ready.id)).quarantine_deleted_at);
  });

  it('removes old orphaned quarantine objects but keeps fresh ones and live uploads', async () => {
    const inFlight = await enqueueUpload(bookId, staff.id, sampleEpub('Waiting'));
    const dir = path.join(path.resolve(env.ASSET_STORAGE_DIR), 'quarantine');
    await mkdir(dir, { recursive: true });
    const stale = randomUUID();
    const fresh = randomUUID();
    await objectStorage().put(`quarantine/${stale}`, Buffer.from('orphan'));
    await objectStorage().put(`quarantine/${fresh}`, Buffer.from('orphan'));
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(path.join(dir, stale), twoHoursAgo, twoHoursAgo);
    await utimes(path.join(dir, inFlight.id), twoHoursAgo, twoHoursAgo);
    await writeFile(path.join(dir, 'not-a-key!.txt'), 'ignored');

    assert.equal(await sweepQuarantine(), 1);
    assert.equal(await objectStorage().head(`quarantine/${stale}`), null);
    assert.ok(await objectStorage().head(`quarantine/${fresh}`));
    assert.ok(await objectStorage().head(`quarantine/${inFlight.id}`));
  });

  it('a missing original is terminal; a storage I/O error is retried', async () => {
    const gone = await enqueueUpload(bookId, staff.id, sampleEpub('Gone'));
    await objectStorage().delete(`quarantine/${gone.id}`);
    assert.equal(await processNextJob(), 'processed');
    const failed = await assetRow(gone.id);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.reason_code, 'PROCESSING_ERROR');
    assert.equal((await jobRow(gone.id)).attempts, 1);

    const other = await createBook(publisherId, { available: false });
    const flaky = await enqueueUpload(other, staff.id, sampleEpub('Flaky'));
    setObjectStorageForTests(
      wrapStorage({
        get: async () => {
          throw new Error('EIO');
        },
      }),
    );
    assert.equal(await processNextJob(), 'processed');
    assert.equal((await assetRow(flaky.id)).state, 'uploaded');
    assert.equal((await jobRow(flaky.id)).state, 'queued');
  });
});

describe('early 413 (finding 2)', () => {
  function post(headers: Record<string, string>) {
    const url = new URL(`${server.baseUrl}/publisher/books/${bookId}/assets`);
    return http.request({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        Authorization: `Bearer ${staff.token}`,
        'Content-Type': 'application/epub+zip',
        ...headers,
      },
    });
  }

  it('answers 413 within 2 s to a chunked upload that never ends', async () => {
    const req = post({ 'Transfer-Encoding': 'chunked' });
    const chunk = Buffer.alloc(64 * 1024);
    const timer = setInterval(() => req.write(chunk), 5);
    const started = Date.now();
    const status = await new Promise<number>((resolve, reject) => {
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('no response within 2 s')), 2000).unref();
    }).finally(() => {
      clearInterval(timer);
      req.destroy();
    });
    assert.equal(status, 413);
    assert.ok(Date.now() - started < 2000);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM book_assets`);
    assert.equal(rows[0].n, 0);
  });

  it('answers 413 to an oversized Content-Length without any body being sent', async () => {
    const req = post({ 'Content-Length': String(100 * 1024 * 1024) });
    req.flushHeaders();
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      req.on('response', (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on('error', reject);
      setTimeout(() => reject(new Error('no response within 2 s')), 2000).unref();
    }).finally(() => req.destroy());
    assert.equal(result.status, 413);
    assert.equal(JSON.parse(result.body).error.code, 'PAYLOAD_TOO_LARGE');
  });
});
