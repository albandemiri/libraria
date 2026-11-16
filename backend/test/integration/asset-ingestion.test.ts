import './asset-ingestion.env';
import {
  client,
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
import { createHash } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { runSeed } from '../../src/db/seed';
import {
  activateAsset,
  enqueueUpload,
  waitForTerminalAsset,
  ingestNow,
  processNextJob,
  setJobTimingsForTests,
  sweepQuarantine,
} from '../../src/drm/asset-ingestion.service';
import { audit } from '../../src/drm/drm.audit';
import { assetAad, decryptAsset } from '../../src/drm/encryption.service';
import { buildEpub, PNG_1X1 } from '../../src/drm/epub/fixtures';
import { keyManagement } from '../../src/drm/key-management.service';
import { type MalwareScanner, setMalwareScannerForTests } from '../../src/drm/malware-scanner';
import { objectStorage, setObjectStorageForTests } from '../../src/drm/object-storage';
import { resetRateLimits } from '../../src/middleware/rate-limit';

let server: TestServer;
let api: ReturnType<typeof client>;
let publisherId: string;
let bookId: string;
let staff: Awaited<ReturnType<typeof createUser>>;

const EPUB = 'application/epub+zip';

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  publisherId = await createPublisher('Ingest House');
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

async function upload(
  token: string,
  book: string,
  body: Buffer | ReadableStream<Uint8Array>,
  options: { contentType?: string; query?: string } = {},
) {
  const response = await fetch(
    `${server.baseUrl}/publisher/books/${book}/assets${options.query ?? ''}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': options.contentType ?? EPUB },
      body: body as BodyInit,
      // undici needs duplex for stream bodies; it is ignored for buffers.
      duplex: 'half',
    } as RequestInit,
  );
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function assetRow(id: string) {
  const { rows } = await pool.query(`SELECT * FROM book_assets WHERE id = $1`, [id]);
  return rows[0];
}

async function currentAssetId(book = bookId): Promise<string | null> {
  const { rows } = await pool.query(`SELECT current_asset_id FROM books WHERE id = $1`, [book]);
  return rows[0].current_asset_id;
}

async function jobsDue(): Promise<void> {
  await pool.query(`UPDATE asset_jobs SET run_after = NOW() - interval '1 second'`);
}

const failingScanner: MalwareScanner = {
  scan: async () => ({ result: 'error', message: 'clamd is down' }),
};

describe('asset ingestion', () => {
  it('waitForTerminalAsset keeps going past an idle queue until the asset is terminal', async () => {
    // A job that is not claimable yet (backing off, or held by another worker) reads as idle.
    const asset = await enqueueUpload(bookId, staff.id, sampleEpub('Waits'));
    await pool.query(
      `UPDATE asset_jobs SET run_after = NOW() + INTERVAL '1 second' WHERE asset_id = $1`,
      [asset.id],
    );
    assert.equal(await processNextJob(), 'idle');
    assert.equal((await waitForTerminalAsset(asset.id, 0)).state, 'uploaded');
    const done = await waitForTerminalAsset(asset.id, 15_000, 100);
    assert.equal(done.state, 'ready');
  });

  it('upload, process, ready, first version goes live', async () => {
    const epub = sampleEpub('Live Book');
    const res = await upload(staff.token, bookId, epub);
    assert.equal(res.status, 202);
    assert.equal(res.body.asset.state, 'uploaded');
    assert.equal(res.body.asset.version, 1);
    const id: string = res.body.asset.id;
    assert.deepEqual(Object.keys(res.body.asset).sort(), [
      'activatedAt',
      'createdAt',
      'id',
      'isCurrent',
      'originalSizeBytes',
      'readyAt',
      'reasonCode',
      'reasonDetail',
      'state',
      'version',
    ]);
    const quarantined = await objectStorage().head(`quarantine/${id}`);
    assert.equal(quarantined?.size, epub.length);

    assert.equal(await processNextJob(), 'processed');
    assert.equal(await processNextJob(), 'idle');

    const detail = await api('GET', `/publisher/books/${bookId}/assets/${id}`, {
      token: staff.token,
    });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.asset.state, 'ready');
    assert.equal(detail.body.asset.isCurrent, true);
    assert.equal(detail.body.asset.extractedMetadata.title, 'Live Book');
    assert.equal(await currentAssetId(), id);

    assert.equal(await objectStorage().head(`quarantine/${id}`), null);
    const row = await assetRow(id);
    const ciphertext = await objectStorage().get(row.object_key);
    assert.equal(createHash('sha256').update(ciphertext).digest('hex'), row.ciphertext_sha256);
    assert.match(row.object_key, new RegExp(`^assets/${id}/v1/a1-[0-9a-f-]{36}$`));

    const { rows } = await pool.query(`SELECT * FROM asset_keys WHERE asset_id = $1`, [id]);
    const key = rows[0];
    assert.equal(key.wrapped_dek.length, 60);
    const dek = await keyManagement().unwrap(key.wrapped_dek, key.kms_key_id, key.kms_key_version);
    assert.equal(dek.length, 32);
    assert.ok(!dek.equals(key.wrapped_dek));
    const plain = decryptAsset(
      ciphertext,
      dek,
      row.nonce,
      row.auth_tag,
      assetAad({ assetId: id, version: 1, kmsKeyId: key.kms_key_id }),
    );
    assert.ok(plain.equals(epub));

    const list = await api('GET', `/publisher/books/${bookId}/assets`, { token: staff.token });
    assert.equal(list.body.assets.length, 1);
    assert.equal(list.body.assets[0].extractedMetadata, undefined);
  });

  it('a second ready version waits for activation', async () => {
    const v1 = await ingestNow(bookId, staff.id, sampleEpub('One'));
    const v2 = await ingestNow(bookId, staff.id, sampleEpub('Two'));
    assert.equal(v2.state, 'ready');
    assert.equal(v2.version, 2);
    assert.equal(await currentAssetId(), v1.id);
    const detail = await api('GET', `/publisher/books/${bookId}/assets/${v2.id}`, {
      token: staff.token,
    });
    assert.equal(detail.body.asset.isCurrent, false);

    const act = await api('POST', `/publisher/books/${bookId}/assets/${v2.id}/activate`, {
      token: staff.token,
    });
    assert.equal(act.status, 200);
    assert.equal(await currentAssetId(), v2.id);
    assert.ok((await assetRow(v2.id)).activated_at);
    assert.equal((await assetRow(v2.id)).activated_by, staff.id);

    const back = await api('POST', `/publisher/books/${bookId}/assets/${v1.id}/activate`, {
      token: staff.token,
    });
    assert.equal(back.status, 200);
    assert.equal(await currentAssetId(), v1.id);

    const list = await api('GET', `/publisher/books/${bookId}/assets`, { token: staff.token });
    assert.deepEqual(
      list.body.assets.map((a: { version: number }) => a.version),
      [2, 1],
    );
  });

  it('a late retry never moves the pointer', async () => {
    await ingestNow(bookId, staff.id, sampleEpub('One'));
    setMalwareScannerForTests(failingScanner);
    const v2 = await enqueueUpload(bookId, staff.id, sampleEpub('Two'));
    for (let i = 0; i < 3; i++) {
      await jobsDue();
      await processNextJob();
    }
    assert.equal((await assetRow(v2.id)).state, 'failed');

    setMalwareScannerForTests(null);
    const v3 = await ingestNow(bookId, staff.id, sampleEpub('Three'));
    assert.equal(v3.state, 'ready');
    await activateAsset(bookId, v3.id, staff.id);
    assert.equal(await currentAssetId(), v3.id);

    const retry = await api('POST', `/admin/assets/${v2.id}/retry`, { token: staff.token });
    assert.equal(retry.status, 202);
    assert.equal(await processNextJob(), 'processed');
    assert.equal((await assetRow(v2.id)).state, 'ready');
    assert.equal(await currentAssetId(), v3.id);
  });

  it("an EPUB without dc:language is accepted and takes the book's language", async () => {
    // Not the column default ('sq'), so the test proves the book's own value is used.
    await pool.query(`UPDATE books SET language = 'en' WHERE id = $1`, [bookId]);
    const asset = await ingestNow(
      bookId,
      staff.id,
      buildEpub({ title: 'No Language', language: null }),
    );
    assert.equal(asset.state, 'ready');
    const detail = await api('GET', `/publisher/books/${bookId}/assets/${asset.id}`, {
      token: staff.token,
    });
    assert.equal(detail.body.asset.extractedMetadata.language, 'en');
    assert.equal(detail.body.asset.extractedMetadata.languageSource, 'book');
    assert.equal(await currentAssetId(), asset.id);
  });

  it("an EPUB's own dc:language is kept even if it differs from the book's", async () => {
    await pool.query(`UPDATE books SET language = 'en' WHERE id = $1`, [bookId]);
    const asset = await ingestNow(bookId, staff.id, buildEpub({ language: 'sq' }));
    assert.equal(asset.state, 'ready');
    const detail = await api('GET', `/publisher/books/${bookId}/assets/${asset.id}`, {
      token: staff.token,
    });
    assert.equal(detail.body.asset.extractedMetadata.language, 'sq');
    assert.equal(detail.body.asset.extractedMetadata.languageSource, 'epub');
  });

  it('rejected upload never touches the live book', async () => {
    const v1 = await ingestNow(bookId, staff.id, sampleEpub('One'));
    const bad = await upload(staff.token, bookId, buildEpub({ scripted: true }));
    assert.equal(bad.status, 202);
    assert.equal(await processNextJob(), 'processed');
    const row = await assetRow(bad.body.asset.id);
    assert.equal(row.state, 'rejected');
    assert.equal(row.reason_code, 'SCRIPTED_CONTENT');
    assert.equal(await currentAssetId(), v1.id);
    assert.equal(await objectStorage().head(`quarantine/${row.id}`), null);
    const { rows } = await pool.query(`SELECT state FROM asset_jobs WHERE asset_id = $1`, [row.id]);
    assert.equal(rows[0].state, 'done');
  });

  it('one in-flight upload per book', async () => {
    const first = await upload(staff.token, bookId, sampleEpub('One'));
    assert.equal(first.status, 202);
    const second = await upload(staff.token, bookId, sampleEpub('Two'));
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'ASSET_PROCESSING');
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM book_assets`);
    assert.equal(rows[0].n, 1);
  });

  it('oversized upload is refused while streaming', async () => {
    const chunk = new Uint8Array(64 * 1024);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 2 * 1024 * 1024) return controller.close();
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    // Chunked (no Content-Length): refused on the first byte past the limit. That the
    // answer comes without waiting for the end of the body is tested in the hardening file.
    const streamed = await upload(staff.token, bookId, stream);
    assert.equal(streamed.status, 413);
    assert.equal(streamed.body.error.code, 'PAYLOAD_TOO_LARGE');

    // A declared Content-Length over the limit is refused before any body byte is read.
    const declared = await upload(staff.token, bookId, Buffer.alloc(2 * 1024 * 1024));
    assert.equal(declared.status, 413);
    assert.equal(declared.body.error.code, 'PAYLOAD_TOO_LARGE');

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM book_assets`);
    assert.equal(rows[0].n, 0);
  });

  it('rejects an empty body and an unsupported content type', async () => {
    const empty = await upload(staff.token, bookId, Buffer.alloc(0));
    assert.equal(empty.status, 400);
    const json = await upload(staff.token, bookId, Buffer.from('{}'), {
      contentType: 'application/json',
    });
    assert.equal(json.status, 415);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM book_assets`);
    assert.equal(rows[0].n, 0);
  });

  it('scanner error retries, then fails, and admin retry re-queues', async () => {
    setMalwareScannerForTests(failingScanner);
    const res = await upload(staff.token, bookId, sampleEpub('Scan'));
    const id: string = res.body.asset.id;

    assert.equal(await processNextJob(), 'processed');
    assert.equal((await assetRow(id)).state, 'uploaded');
    // Backoff: not claimable until run_after passes.
    assert.equal(await processNextJob(), 'idle');
    await jobsDue();
    assert.equal(await processNextJob(), 'processed');
    assert.equal((await assetRow(id)).state, 'uploaded');
    await jobsDue();
    assert.equal(await processNextJob(), 'processed');

    const row = await assetRow(id);
    assert.equal(row.state, 'failed');
    assert.equal(row.reason_code, 'SCAN_UNAVAILABLE');
    assert.ok(await objectStorage().head(`quarantine/${id}`));
    assert.equal(await currentAssetId(), null);

    setMalwareScannerForTests(null);
    const retry = await api('POST', `/admin/assets/${id}/retry`, { token: staff.token });
    assert.equal(retry.status, 202);
    assert.equal(await processNextJob(), 'processed');
    assert.equal((await assetRow(id)).state, 'ready');
    assert.equal(await currentAssetId(), id);

    const again = await api('POST', `/admin/assets/${id}/retry`, { token: staff.token });
    assert.equal(again.status, 400);
    const nonStaff = await createUser({ role: 'publisher', publisherId });
    const denied = await api('POST', `/admin/assets/${id}/retry`, { token: nonStaff.token });
    assert.equal(denied.status, 403);
  });

  it('infected files are rejected with MALWARE_DETECTED', async () => {
    setMalwareScannerForTests({
      scan: async () => ({ result: 'infected', signature: 'Eicar-Test-Signature' }),
    });
    const asset = await ingestNow(bookId, staff.id, sampleEpub('Eicar'));
    assert.equal(asset.state, 'rejected');
    assert.equal(asset.reason_code, 'MALWARE_DETECTED');
    assert.equal(await objectStorage().head(`quarantine/${asset.id}`), null);
  });

  it('stale running job is reclaimed', async () => {
    const asset = await enqueueUpload(bookId, staff.id, sampleEpub('Stale'));
    await pool.query(
      `UPDATE asset_jobs SET state = 'running', locked_at = NOW() - interval '1 hour', attempts = 1`,
    );
    await pool.query(`UPDATE book_assets SET state = 'scanning' WHERE id = $1`, [asset.id]);
    assert.equal(await processNextJob(), 'processed');
    assert.equal((await assetRow(asset.id)).state, 'ready');

    // A fresh lock is left alone.
    await pool.query(`UPDATE books SET current_asset_id = NULL WHERE id = $1`, [bookId]);
    const second = await enqueueUpload(bookId, staff.id, sampleEpub('Fresh'));
    await pool.query(
      `UPDATE asset_jobs SET state = 'running', locked_at = NOW() WHERE asset_id = $1`,
      [second.id],
    );
    assert.equal(await processNextJob(), 'idle');
  });

  it('a job that keeps crashing is failed, not retried forever', async () => {
    const asset = await enqueueUpload(bookId, staff.id, sampleEpub('Crashy'));
    await pool.query(
      `UPDATE asset_jobs SET state = 'running', locked_at = NOW() - interval '1 hour', attempts = 3`,
    );
    assert.equal(await processNextJob(), 'processed');
    const row = await assetRow(asset.id);
    assert.equal(row.state, 'failed');
    assert.equal(row.reason_code, 'PROCESSING_ERROR');
  });

  it("publisher cannot upload to another publisher's book", async () => {
    const otherPublisher = await createPublisher('Other House');
    const intruder = await createUser({ role: 'publisher', publisherId: otherPublisher });
    const denied = await upload(intruder.token, bookId, sampleEpub('Nope'));
    assert.equal(denied.status, 404);
    const spoofed = await upload(intruder.token, bookId, sampleEpub('Nope'), {
      query: `?publisherId=${publisherId}`,
    });
    assert.equal(spoofed.status, 404);
    const list = await api('GET', `/publisher/books/${bookId}/assets`, { token: intruder.token });
    assert.equal(list.status, 404);

    const owner = await createUser({ role: 'publisher', publisherId });
    const ok = await upload(owner.token, bookId, sampleEpub('Mine'));
    assert.equal(ok.status, 202);
    const reader = await createUser({ role: 'reader' });
    assert.equal((await upload(reader.token, bookId, sampleEpub('x'))).status, 403);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM book_assets`);
    assert.equal(rows[0].n, 1);
  });

  it("activating another book's asset is a 404 and changes nothing", async () => {
    const otherBook = await createBook(publisherId, { available: false });
    const mine = await ingestNow(bookId, staff.id, sampleEpub('Mine'));
    const theirs = await ingestNow(otherBook, staff.id, sampleEpub('Theirs'));
    const res = await api('POST', `/publisher/books/${bookId}/assets/${theirs.id}/activate`, {
      token: staff.token,
    });
    assert.equal(res.status, 404);
    assert.equal(await currentAssetId(bookId), mine.id);
    assert.equal(await currentAssetId(otherBook), theirs.id);
    await assert.rejects(activateAsset(bookId, theirs.id, staff.id), { status: 404 });
    assert.equal(await currentAssetId(bookId), mine.id);

    // Not ready: conflict, nothing changes.
    const pending = await enqueueUpload(bookId, staff.id, sampleEpub('Pending'));
    const notReady = await api('POST', `/publisher/books/${bookId}/assets/${pending.id}/activate`, {
      token: staff.token,
    });
    assert.equal(notReady.status, 409);
    assert.equal(notReady.body.error.code, 'ASSET_PROCESSING');
    assert.equal(await currentAssetId(bookId), mine.id);
  });

  it('cover is served and fills an empty cover url', async () => {
    const asset = await ingestNow(bookId, staff.id, buildEpub({ cover: true }));
    assert.equal(asset.state, 'ready');
    const { rows } = await pool.query(`SELECT cover_image_url FROM books WHERE id = $1`, [bookId]);
    assert.equal(rows[0].cover_image_url, `/api/v1/books/${bookId}/cover?v=1`);

    const res = await fetch(`${server.baseUrl}/books/${bookId}/cover`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(PNG_1X1));

    // A legacy external URL (no longer settable) is replaced by the live asset's own cover.
    const own = await createBook(publisherId, { available: false });
    await pool.query(
      `UPDATE books SET cover_image_url = 'https://cdn.example/c.png' WHERE id = $1`,
      [own],
    );
    await ingestNow(own, staff.id, buildEpub({ cover: true }));
    const kept = await pool.query(`SELECT cover_image_url FROM books WHERE id = $1`, [own]);
    assert.equal(kept.rows[0].cover_image_url, `/api/v1/books/${own}/cover?v=1`);

    // No cover: 404, and the url stays empty.
    const plain = await createBook(publisherId, { available: false });
    await ingestNow(plain, staff.id, buildEpub({ title: 'Plain' }));
    assert.equal((await fetch(`${server.baseUrl}/books/${plain}/cover`)).status, 404);
    const unknown = '00000000-0000-4000-8000-000000000000';
    assert.equal((await fetch(`${server.baseUrl}/books/${unknown}/cover`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/books/not-a-uuid/cover`)).status, 400);
  });

  it('audit events for rejection and failure contain no secrets', async () => {
    await ingestNow(bookId, staff.id, sampleEpub('Good'));
    const rejected = await ingestNow(bookId, staff.id, buildEpub({ scripted: true }));
    setMalwareScannerForTests(failingScanner);
    const failed = await enqueueUpload(bookId, staff.id, sampleEpub('Fail'));
    for (let i = 0; i < 3; i++) {
      await jobsDue();
      await processNextJob();
    }
    assert.equal((await assetRow(failed.id)).state, 'failed');
    await api('POST', `/admin/assets/${failed.id}/retry`, { token: staff.token });

    const { rows } = await pool.query(
      `SELECT action, resource_id, metadata FROM audit_events ORDER BY id`,
    );
    const actions = rows.map((r) => `${r.action}:${r.resource_id}`);
    assert.ok(actions.includes(`asset.rejected:${rejected.id}`));
    assert.ok(actions.includes(`asset.failed:${failed.id}`));
    assert.ok(actions.includes(`asset.retry:${failed.id}`));
    const dump = JSON.stringify(rows);
    assert.doesNotMatch(
      JSON.stringify(rows.map((r) => r.metadata)),
      /token|dek|secret|signature|wrapped|clamd/i,
    );
    const { rows: keys } = await pool.query(`SELECT wrapped_dek FROM asset_keys`);
    for (const k of keys) assert.ok(!dump.includes(k.wrapped_dek.toString('base64')));
  });

  it('audit redacts secret-looking metadata keys at any depth', async () => {
    await audit({
      actorId: staff.id,
      action: 'test.redaction',
      resourceType: 'book_asset',
      resourceId: 'x',
      metadata: {
        keep: 1,
        wrappedDek: 'a',
        grantToken: 'b',
        nested: { signature: 'c', licenceKey: 'd', fine: true },
        list: [{ secret: 'e', ok: 2 }],
      },
    });
    const { rows } = await pool.query(
      `SELECT metadata FROM audit_events WHERE action = 'test.redaction'`,
    );
    assert.deepEqual(rows[0].metadata, { keep: 1, nested: { fine: true }, list: [{ ok: 2 }] });
  });

  it('sweeps failed originals after seven days only', async () => {
    setMalwareScannerForTests(failingScanner);
    const failed = await enqueueUpload(bookId, staff.id, sampleEpub('Old'));
    for (let i = 0; i < 3; i++) {
      await jobsDue();
      await processNextJob();
    }
    assert.equal(await sweepQuarantine(), 0);
    assert.ok(await objectStorage().head(`quarantine/${failed.id}`));
    // The updated_at trigger would reset the age, so switch it off for the backdating.
    await pool.query('ALTER TABLE book_assets DISABLE TRIGGER book_assets_set_updated_at');
    await pool.query(
      `UPDATE book_assets SET updated_at = NOW() - interval '8 days' WHERE id = $1`,
      [failed.id],
    );
    await pool.query('ALTER TABLE book_assets ENABLE TRIGGER book_assets_set_updated_at');
    assert.equal(await sweepQuarantine(), 1);
    assert.equal(await objectStorage().head(`quarantine/${failed.id}`), null);
    assert.equal(await sweepQuarantine(), 0);
  });

  it('seed restores the demo books on a previously seeded database, twice safely', async () => {
    await runSeed();
    // What migration 0006 did to an already-seeded database.
    await pool.query(`UPDATE books SET is_available = FALSE, current_asset_id = NULL`);
    await runSeed();
    await runSeed();
    const { rows } = await pool.query(
      `SELECT b.title, ba.state
         FROM books b JOIN book_assets ba ON ba.id = b.current_asset_id
        WHERE b.is_available AND b.title IN
          ('The Clockwork Forest', 'Echoes of the Deep', 'Principles of Stellar Navigation')`,
    );
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.state === 'ready'));
    // Re-seeding a live book does not pile up new versions.
    const count = await pool.query(
      `SELECT count(*)::int AS n FROM book_assets ba JOIN books b ON b.id = ba.book_id
        WHERE b.title = 'Echoes of the Deep'`,
    );
    assert.equal(count.rows[0].n, 2);
  });
});
