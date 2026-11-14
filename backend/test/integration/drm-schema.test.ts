import {
  client,
  createBook,
  createPublisher,
  createReadyAsset,
  createUser,
  grantBook,
  pool,
  resetDatabase,
  startTestServer,
  type TestServer,
} from './harness';
import assert from 'node:assert/strict';
import { currentReadyAsset } from '../../src/drm/asset-repository';
import { after, before, beforeEach, describe, it } from 'node:test';

let server: TestServer;
let api: ReturnType<typeof client>;
let publisherId: string;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  publisherId = await createPublisher('Schema House');
});

after(async () => {
  await server.close();
});

async function insertAsset(bookId: string, version: number, state: string): Promise<void> {
  await pool.query(
    `INSERT INTO book_assets (book_id, version, state, original_size_bytes)
     VALUES ($1, $2, $3, 1000)`,
    [bookId, version, state],
  );
}

describe('book assets schema', () => {
  it('available book requires a current asset', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO books (publisher_id, title, author, genre, price_cents, is_available)
         VALUES ($1, 'No asset', 'A', 'Fiction', 100, TRUE)`,
        [publisherId],
      ),
      { code: '23514', constraint: 'available_needs_asset' },
    );
  });

  it('one in-flight asset per book', async () => {
    const bookId = await createBook(publisherId, { available: false });
    await insertAsset(bookId, 1, 'uploaded');
    await assert.rejects(insertAsset(bookId, 2, 'uploaded'), {
      code: '23505',
      constraint: 'book_assets_one_in_flight_idx',
    });

    // A ready asset alongside one in flight is fine.
    const other = await createBook(publisherId, { available: false });
    await createReadyAsset(other);
    await insertAsset(other, 2, 'uploaded');
  });

  it('a ready asset must be complete and versions are unique per book', async () => {
    const bookId = await createBook(publisherId, { available: false });
    await assert.rejects(insertAsset(bookId, 1, 'ready'), {
      constraint: 'book_assets_ready_complete',
    });
    await insertAsset(bookId, 1, 'rejected');
    await assert.rejects(insertAsset(bookId, 1, 'failed'), {
      constraint: 'book_assets_book_version_key',
    });
  });

  it('createBook makes a real ready current asset with a wrapped key', async () => {
    const bookId = await createBook(publisherId);
    const { rows } = await pool.query(
      `SELECT b.is_available, ba.state, k.wrapped_dek
         FROM books b
         JOIN book_assets ba ON ba.id = b.current_asset_id
         JOIN asset_keys k ON k.asset_id = ba.id
        WHERE b.id = $1`,
      [bookId],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].is_available, true);
    assert.equal(rows[0].state, 'ready');
    assert.equal(rows[0].wrapped_dek.length, 60);
  });
});

describe('legacy key endpoints are gone', () => {
  it('legacy key endpoints are gone', async () => {
    const reader = await createUser();
    const bookId = await createBook(publisherId);
    await grantBook(reader.id, bookId);

    for (const path of [`/library/${bookId}/key`, `/library/${bookId}/asset`]) {
      const res = await api('GET', path, { token: reader.token });
      assert.equal(res.status, 404, path);
      assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND', path);
    }

    const staticRes = await fetch(
      `${server.baseUrl.replace(/\/api\/v1$/, '')}/assets/books/x.epub.enc`,
    );
    assert.equal(staticRes.status, 404);

    const staff = await createUser({ role: 'publisher', publisherId });
    const legacyUpload = await api('POST', `/publisher/books/${bookId}/asset`, {
      token: staff.token,
      body: {},
    });
    assert.equal(legacyUpload.status, 404);
  });
});

describe('publishing', () => {
  it('publish requires a ready current asset', async () => {
    const staff = await createUser({ role: 'publisher', publisherId });
    const bookId = await createBook(publisherId, { available: false });

    const refused = await api('POST', `/publisher/books/${bookId}/publish`, { token: staff.token });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'ASSET_REQUIRED');

    const { assetId } = await createReadyAsset(bookId);
    const ok = await api('POST', `/publisher/books/${bookId}/publish`, { token: staff.token });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.book.isAvailable, true);
    assert.equal(ok.body.book.hasAsset, true);
    assert.ok(ok.body.book.fileSizeBytes > 0);

    const { rows } = await pool.query('SELECT current_asset_id FROM books WHERE id = $1', [bookId]);
    assert.equal(rows[0].current_asset_id, assetId);
  });

  it('an in-flight current asset is not enough to publish, and hasAsset is false', async () => {
    const staff = await createUser({ role: 'publisher', publisherId });
    const bookId = await createBook(publisherId, { available: false });
    await insertAsset(bookId, 1, 'validating');
    await pool.query(
      `UPDATE books SET current_asset_id = (SELECT id FROM book_assets WHERE book_id = $1) WHERE id = $1`,
      [bookId],
    );

    const detail = await api('GET', `/publisher/books/${bookId}`, { token: staff.token });
    assert.equal(detail.body.book.hasAsset, false);
    assert.equal(detail.body.book.fileSizeBytes, null);

    const refused = await api('POST', `/publisher/books/${bookId}/publish`, { token: staff.token });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error.code, 'ASSET_REQUIRED');
  });
});

describe('currentReadyAsset', () => {
  it('returns the ready current asset and nothing for a draft', async () => {
    const draft = await createBook(publisherId, { available: false });
    assert.equal(await currentReadyAsset(draft), null);

    const bookId = await createBook(publisherId);
    const asset = await currentReadyAsset(bookId);
    assert.equal(asset?.state, 'ready');
    assert.equal(asset?.version, 1);
  });
});
