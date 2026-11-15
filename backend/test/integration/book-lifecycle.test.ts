import './asset-delivery.env';
import {
  buy,
  client,
  createBook,
  createPublisher,
  createReadyAsset,
  createUser,
  grantBook,
  pool,
  resetDatabase,
  sampleEpub as sampleEpubBuffer,
  startTestServer,
  type TestServer,
  type TestUser,
} from './harness';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';
import { clearAccountStatusCache } from '../../src/auth/account-status';
import { objectStorage } from '../../src/drm/object-storage';
import { resetRateLimits } from '../../src/middleware/rate-limit';

let server: TestServer;
let api: ReturnType<typeof client>;
let publisherId: string;
let owner: TestUser;
let otherOwner: TestUser;
let admin: TestUser;
let reader: TestUser;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  clearAccountStatusCache();
  resetRateLimits();
  publisherId = await createPublisher('Lifecycle House');
  owner = await createUser({ role: 'publisher', publisherId });
  otherOwner = await createUser({ role: 'publisher', publisherId: await createPublisher('Other') });
  admin = await createUser({ role: 'admin' });
  reader = await createUser();
});

after(async () => {
  await server.close();
});

const archive = (id: string, token = owner.token, query = '') =>
  api('POST', `/publisher/books/${id}/archive${query}`, { token });
const restore = (id: string, token = owner.token, query = '') =>
  api('POST', `/publisher/books/${id}/restore${query}`, { token });
const remove = (id: string, token = owner.token, query = '') =>
  api('DELETE', `/publisher/books/${id}${query}`, { token });
const detail = async (id: string, token = owner.token) =>
  (await api('GET', `/publisher/books/${id}`, { token })).body.book;
const exists = async (key: string | null) =>
  key !== null && (await objectStorage().head(key)) !== null;

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

const code = (res: { body: { error: { code: string } } }) => res.body.error.code;

/** A sold book: bought, then taken off sale so only the sales rule can refuse a delete. */
async function soldBook(): Promise<string> {
  const id = await createBook(publisherId);
  await buy(api, reader.token, [id]);
  await api('POST', `/publisher/books/${id}/unpublish`, { token: owner.token });
  return id;
}

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
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.device.id;
}

describe('archive', () => {
  it('takes a published book off sale in one step and reports archived', async () => {
    const id = await createBook(publisherId);
    const res = await archive(id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.book.status, 'archived');
    assert.equal(res.body.book.isAvailable, false);
    const row = (
      await pool.query('SELECT archived_at, is_available FROM books WHERE id = $1', [id])
    ).rows[0];
    assert.ok(row.archived_at);
    assert.equal(row.is_available, false);
  });

  it('archives drafts too, and a second archive is 409 BOOK_ARCHIVED', async () => {
    const id = await createBook(publisherId, { available: false });
    assert.equal((await archive(id)).status, 200);
    const again = await archive(id);
    assert.equal(again.status, 409);
    assert.equal(code(again), 'BOOK_ARCHIVED');
  });

  it('is refused for a withdrawn book with 403 FORBIDDEN', async () => {
    const id = await createBook(publisherId);
    await pool.query('UPDATE books SET withdrawn_at = NOW(), is_available = FALSE WHERE id = $1', [
      id,
    ]);
    const res = await archive(id);
    assert.equal(res.status, 403);
    assert.equal(code(res), 'FORBIDDEN');
  });

  it('refuses a new checkout of an archived book, but a checkout opened earlier still completes and the buyer gets access', async () => {
    const id = await createBook(publisherId);
    const pending = await api('POST', '/checkout-sessions', {
      token: reader.token,
      body: { bookIds: [id] },
    });
    assert.equal(pending.status, 201);
    assert.equal((await archive(id)).status, 200);

    const fresh = await api('POST', '/checkout-sessions', {
      token: (await createUser()).token,
      body: { bookIds: [id] },
    });
    assert.equal(fresh.status, 404);

    // Money was taken for a checkout opened while the book was on sale: the buyer gets the book.
    const paid = await api('POST', `/sandbox/transactions/${pending.body.transaction.id}/events`, {
      token: reader.token,
      body: { kind: 'payment_succeeded' },
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    const txn = await pool.query('SELECT status FROM transactions WHERE id = $1', [
      pending.body.transaction.id,
    ]);
    assert.equal(txn.rows[0].status, 'paid');
    const ent = await pool.query(
      `SELECT COUNT(*) AS n FROM entitlements WHERE user_id = $1 AND book_id = $2 AND status = 'active'`,
      [reader.id, id],
    );
    assert.equal(Number(ent.rows[0].n), 1);
    assert.equal((await detail(id)).canDelete, false);
  });

  it('refuses a checkout whose book is unpublished after the pre-check (404, nothing created)', async () => {
    const id = await createBook(publisherId);
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('UPDATE books SET is_available = FALSE WHERE id = $1', [id]);
      // The pre-check still sees the book on sale; the locked re-check must wait for the unpublish.
      const checkout = api('POST', '/checkout-sessions', {
        token: reader.token,
        body: { bookIds: [id] },
      });
      await waitForLockWaiters(1);
      await holder.query('COMMIT');
      const res = await checkout;
      assert.equal(res.status, 404, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'NOT_FOUND');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
    assert.equal(Number((await pool.query('SELECT COUNT(*) AS n FROM transactions')).rows[0].n), 0);
  });

  it('lets existing buyers keep their library entry, licence and download', async () => {
    const id = await createBook(publisherId);
    await buy(api, reader.token, [id]);
    const assetId = (await pool.query('SELECT current_asset_id FROM books WHERE id = $1', [id]))
      .rows[0].current_asset_id;
    assert.equal((await archive(id)).status, 200);

    const deviceId = await registerDevice(reader);
    const licence = await api('POST', `/assets/${assetId}/decryption-authorizations`, {
      token: reader.token,
      body: { deviceId },
    });
    assert.equal(licence.status, 200, JSON.stringify(licence.body));
    const download = await api('POST', `/assets/${assetId}/download-authorizations`, {
      token: reader.token,
      body: { deviceId },
    });
    assert.equal(download.status, 200, JSON.stringify(download.body));
    const library = await api('GET', '/library', { token: reader.token });
    assert.equal(library.status, 200);
    assert.equal(JSON.stringify(library.body).includes(id), true);
  });

  it('is isolated between publishers and works for an admin with publisherId', async () => {
    const id = await createBook(publisherId, { available: false });
    assert.equal((await archive(id, otherOwner.token)).status, 404);
    assert.equal((await detail(id)).status, 'draft');
    assert.equal((await archive(id, otherOwner.token, `?publisherId=${publisherId}`)).status, 404);
    const res = await archive(id, admin.token, `?publisherId=${publisherId}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.book.status, 'archived');
  });
});

describe('publish and restore', () => {
  it('refuses to publish an archived book: 409 BOOK_ARCHIVED', async () => {
    const id = await createBook(publisherId);
    await archive(id);
    const res = await api('POST', `/publisher/books/${id}/publish`, { token: owner.token });
    assert.equal(res.status, 409);
    assert.equal(code(res), 'BOOK_ARCHIVED');
    assert.equal((await detail(id)).isAvailable, false);
  });

  it('restores to ready and never back on sale', async () => {
    const id = await createBook(publisherId);
    await archive(id);
    const res = await restore(id);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.book.status, 'ready');
    assert.equal(res.body.book.isAvailable, false);
    const published = await api('POST', `/publisher/books/${id}/publish`, { token: owner.token });
    assert.equal(published.status, 200);
  });

  it('restores a book without a file to draft', async () => {
    const id = await createBook(publisherId, { available: false });
    await archive(id);
    assert.equal((await restore(id)).body.book.status, 'draft');
  });

  it('isolates restore between publishers and supports the admin path', async () => {
    const id = await createBook(publisherId, { available: false });
    await archive(id);
    assert.equal((await restore(id, otherOwner.token)).status, 404);
    const res = await restore(id, admin.token, `?publisherId=${publisherId}`);
    assert.equal(res.status, 200);
  });
});

describe('catalogue filter', () => {
  it('hides archived books by default and shows them for status=archived', async () => {
    const live = await createBook(publisherId, { title: 'Live' });
    const gone = await createBook(publisherId, { title: 'Gone' });
    await archive(gone);

    const all = await api('GET', '/publisher/books', { token: owner.token });
    assert.deepEqual(
      all.body.books.map((b: { id: string }) => b.id),
      [live],
    );
    const archived = await api('GET', '/publisher/books?status=archived', { token: owner.token });
    assert.equal(archived.status, 200);
    assert.deepEqual(
      archived.body.books.map((b: { id: string }) => b.id),
      [gone],
    );
    const published = await api('GET', '/publisher/books?status=published', {
      token: owner.token,
    });
    assert.deepEqual(
      published.body.books.map((b: { id: string }) => b.id),
      [live],
    );
  });

  it('does not count archived titles as drafts in the stats', async () => {
    const id = await createBook(publisherId, { available: false });
    await archive(id);
    const stats = await api('GET', '/publisher/stats', { token: owner.token });
    assert.equal(stats.body.stats.totalTitles, 0);
    assert.equal(stats.body.stats.draftTitles, 0);
  });
});

describe('canDelete', () => {
  it('is true for a draft and a ready unpublished book, false otherwise', async () => {
    const draft = await createBook(publisherId, { available: false });
    const ready = await createBook(publisherId);
    await api('POST', `/publisher/books/${ready}/unpublish`, { token: owner.token });
    const published = await createBook(publisherId);
    const sold = await soldBook();
    const withdrawn = await createBook(publisherId, { available: false });
    await pool.query('UPDATE books SET withdrawn_at = NOW() WHERE id = $1', [withdrawn]);
    const processing = await createBook(publisherId, { available: false });
    await pool.query(
      `INSERT INTO book_assets (book_id, version, state, original_size_bytes)
       VALUES ($1, 1, 'scanning', 10)`,
      [processing],
    );
    const archivedSold = await soldBook();
    await archive(archivedSold);
    const archivedFresh = await createBook(publisherId, { available: false });
    await archive(archivedFresh);

    const expected: Array<[string, string, boolean]> = [
      ['draft', draft, true],
      ['ready', ready, true],
      ['published', published, false],
      ['sold', sold, false],
      ['withdrawn', withdrawn, false],
      ['processing', processing, false],
      ['archived and sold', archivedSold, false],
      ['archived, never sold', archivedFresh, true],
    ];
    for (const [label, id, canDelete] of expected) {
      assert.equal((await detail(id)).canDelete, canDelete, label);
    }
    const list = await api('GET', '/publisher/books?status=all&limit=100', { token: owner.token });
    for (const book of list.body.books) assert.equal(typeof book.canDelete, 'boolean');
  });

  it('is false for a book in a reader library without a sale (a grant)', async () => {
    const id = await createBook(publisherId, { available: false });
    await grantBook(reader.id, id);
    assert.equal((await detail(id)).canDelete, false);
  });
});

describe('DELETE /publisher/books/:id', () => {
  it('removes the book, its assets, keys, cover and stored objects', async () => {
    const id = await createBook(publisherId, { available: false });
    await createReadyAsset(id);
    const asset = (
      await pool.query('SELECT id, object_key FROM book_assets WHERE book_id = $1', [id])
    ).rows[0];
    const coverKey = `covers/${id}/${asset.id}`;
    const uploaded = `covers/${id}/u-test.jpg`;
    await objectStorage().put(coverKey, Buffer.from('epub cover'));
    await objectStorage().put(uploaded, Buffer.from('uploaded cover'));
    await objectStorage().put(`quarantine/${asset.id}`, Buffer.from('original'));
    assert.equal(await exists(asset.object_key), true);

    const res = await remove(id);
    assert.equal(res.status, 204);

    const count = async (sql: string) => Number((await pool.query(sql, [id])).rows[0].n);
    assert.equal(await count('SELECT COUNT(*) AS n FROM books WHERE id = $1'), 0);
    assert.equal(await count('SELECT COUNT(*) AS n FROM book_assets WHERE book_id = $1'), 0);
    assert.equal(
      Number(
        (await pool.query('SELECT COUNT(*) AS n FROM asset_keys WHERE asset_id = $1', [asset.id]))
          .rows[0].n,
      ),
      0,
    );
    for (const key of [asset.object_key, coverKey, uploaded, `quarantine/${asset.id}`]) {
      assert.equal(await exists(key), false, key);
    }
    assert.equal((await api('GET', `/publisher/books/${id}`, { token: owner.token })).status, 404);
  });

  it('deletes a bare draft and an archived never-sold book', async () => {
    const draft = await createBook(publisherId, { available: false });
    assert.equal((await remove(draft)).status, 204);
    const archived = await createBook(publisherId);
    await archive(archived);
    assert.equal((await remove(archived)).status, 204);
  });

  it('refuses in order: withdrawn 403, published 409, processing 409, sold 409', async () => {
    const withdrawn = await createBook(publisherId);
    await pool.query('UPDATE books SET withdrawn_at = NOW() WHERE id = $1', [withdrawn]);
    let res = await remove(withdrawn);
    assert.equal(res.status, 403);
    assert.equal(code(res), 'FORBIDDEN');

    const published = await createBook(publisherId);
    res = await remove(published);
    assert.equal(res.status, 409);
    assert.equal(code(res), 'BOOK_PUBLISHED');

    const processing = await createBook(publisherId, { available: false });
    await pool.query(
      `INSERT INTO book_assets (book_id, version, state, original_size_bytes)
       VALUES ($1, 1, 'encrypting', 10)`,
      [processing],
    );
    res = await remove(processing);
    assert.equal(res.status, 409);
    assert.equal(code(res), 'ASSET_PROCESSING');

    const sold = await soldBook();
    res = await remove(sold);
    assert.equal(res.status, 409);
    assert.equal(code(res), 'BOOK_HAS_SALES');
    assert.equal((await detail(sold)).title !== undefined, true);

    // Every refusal left its book (and the sold book's files) alone.
    for (const id of [withdrawn, published, processing, sold]) {
      assert.equal(
        Number((await pool.query('SELECT COUNT(*) AS n FROM books WHERE id = $1', [id])).rows[0].n),
        1,
      );
    }
  });

  it('refuses a granted book (library row without a sale) and a sold archived book', async () => {
    const granted = await createBook(publisherId, { available: false });
    await grantBook(reader.id, granted);
    assert.equal(code(await remove(granted)), 'BOOK_HAS_SALES');
    const sold = await soldBook();
    await archive(sold);
    assert.equal(code(await remove(sold)), 'BOOK_HAS_SALES');
  });

  it('answers 409 BOOK_HAS_SALES and keeps both the book and the row when a library row commits while the delete waits', async () => {
    const id = await createBook(publisherId, { available: false });
    await createReadyAsset(id);
    const key = (await pool.query('SELECT object_key FROM book_assets WHERE book_id = $1', [id]))
      .rows[0].object_key;
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('INSERT INTO user_libraries (user_id, book_id) VALUES ($1, $2)', [
        reader.id,
        id,
      ]);
      const deleting = remove(id);
      await waitForLockWaiters(1);
      await holder.query('COMMIT');
      const res = await deleting;
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(code(res), 'BOOK_HAS_SALES');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
    assert.equal(
      Number((await pool.query('SELECT COUNT(*) AS n FROM books WHERE id = $1', [id])).rows[0].n),
      1,
    );
    assert.equal(
      Number(
        (await pool.query('SELECT COUNT(*) AS n FROM user_libraries WHERE book_id = $1', [id]))
          .rows[0].n,
      ),
      1,
    );
    assert.equal(await exists(key), true, 'storage untouched');
  });

  it('deletes and fails the insert with a foreign-key violation when the delete holds the lock first', async () => {
    const id = await createBook(publisherId, { available: false });
    await createReadyAsset(id);
    const holder = await pool.connect();
    let insert: Promise<string>;
    let deleting: ReturnType<typeof remove>;
    try {
      // Stalls the delete after it has locked the book row, at the book_assets delete.
      await holder.query('BEGIN');
      await holder.query(`UPDATE book_assets SET reason_detail = 'hold' WHERE book_id = $1`, [id]);
      deleting = remove(id);
      await waitForLockWaiters(1);
      insert = pool
        .query('INSERT INTO user_libraries (user_id, book_id) VALUES ($1, $2)', [reader.id, id])
        .then(
          () => 'inserted',
          (error: { code?: string }) => error.code ?? 'error',
        );
      await waitForLockWaiters(2);
      await holder.query('COMMIT');
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
    }
    assert.equal((await deleting).status, 204);
    assert.equal(await insert, '23503');
    assert.equal(
      Number((await pool.query('SELECT COUNT(*) AS n FROM books WHERE id = $1', [id])).rows[0].n),
      0,
    );
  });

  it("leaves another book's files alone", async () => {
    const doomed = await createBook(publisherId, { available: false });
    await createReadyAsset(doomed);
    const other = await createBook(publisherId, { available: false });
    const otherAsset = await createReadyAsset(other);
    const otherKey = (
      await pool.query('SELECT object_key FROM book_assets WHERE id = $1', [otherAsset.assetId])
    ).rows[0].object_key;
    const otherCover = `covers/${other}/${otherAsset.assetId}`;
    await objectStorage().put(otherCover, Buffer.from('cover'));
    await objectStorage().put(`quarantine/${otherAsset.assetId}`, Buffer.from('original'));

    assert.equal((await remove(doomed)).status, 204);
    assert.equal(await exists(otherKey), true);
    assert.equal(await exists(otherCover), true);
    assert.equal(await exists(`quarantine/${otherAsset.assetId}`), true);
  });

  it('is isolated between publishers and works for an admin with publisherId', async () => {
    const id = await createBook(publisherId, { available: false });
    const foreign = await remove(id, otherOwner.token);
    assert.equal(foreign.status, 404);
    assert.equal((await remove(id, otherOwner.token, `?publisherId=${publisherId}`)).status, 404);
    assert.equal((await detail(id)).id, id);
    assert.equal((await remove(id, admin.token, `?publisherId=${publisherId}`)).status, 204);
  });

  it('answers 404 for an unknown book, 400 for a bad id, 401 and 403 for the wrong callers', async () => {
    assert.equal((await remove('00000000-0000-4000-8000-000000000000')).status, 404);
    assert.equal((await remove('nope')).status, 400);
    assert.equal(
      (await api('DELETE', '/publisher/books/00000000-0000-4000-8000-000000000000')).status,
      401,
    );
    assert.equal((await remove('00000000-0000-4000-8000-000000000000', reader.token)).status, 403);
  });
});

describe('an archived book is read-only', () => {
  async function archivedBook() {
    const id = await createBook(publisherId, { available: false });
    const first = await createReadyAsset(id);
    await createReadyAsset(id);
    assert.equal((await archive(id)).status, 200);
    return { id, first };
  }
  const png = () =>
    sharp({ create: { width: 800, height: 1200, channels: 3, background: '#aa3355' } })
      .png()
      .toBuffer();

  it('refuses PATCH with 409 BOOK_ARCHIVED and changes nothing', async () => {
    const { id } = await archivedBook();
    const res = await api('PATCH', `/publisher/books/${id}`, {
      token: owner.token,
      body: { title: 'Renamed' },
    });
    assert.equal(res.status, 409);
    assert.equal(code(res), 'BOOK_ARCHIVED');
    assert.notEqual((await detail(id)).title, 'Renamed');
  });

  it('refuses a cover upload and a cover removal', async () => {
    const { id } = await archivedBook();
    const put = await fetch(`${server.baseUrl}/publisher/books/${id}/cover`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${owner.token}`, 'Content-Type': 'image/png' },
      body: (await png()) as BodyInit,
    });
    assert.equal(put.status, 409);
    assert.equal(((await put.json()) as { error: { code: string } }).error.code, 'BOOK_ARCHIVED');
    const del = await api('DELETE', `/publisher/books/${id}/cover`, { token: owner.token });
    assert.equal(del.status, 409);
    assert.equal(code(del), 'BOOK_ARCHIVED');
  });

  it('refuses an EPUB upload before reading the body', async () => {
    const { id } = await archivedBook();
    const res = await fetch(`${server.baseUrl}/publisher/books/${id}/assets`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'application/epub+zip',
      },
      body: sampleEpubBuffer() as BodyInit,
    });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'BOOK_ARCHIVED');
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM book_assets WHERE book_id = $1',
      [id],
    );
    assert.equal(rows[0].n, 2);
  });

  it('refuses asset activation', async () => {
    const { id, first } = await archivedBook();
    const res = await api('POST', `/publisher/books/${id}/assets/${first.assetId}/activate`, {
      token: owner.token,
    });
    assert.equal(res.status, 409);
    assert.equal(code(res), 'BOOK_ARCHIVED');
  });

  it('allows restore, after which edits work again', async () => {
    const { id } = await archivedBook();
    assert.equal((await restore(id)).status, 200);
    const res = await api('PATCH', `/publisher/books/${id}`, {
      token: owner.token,
      body: { title: 'Renamed' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.book.title, 'Renamed');
  });

  it('still answers 404 for another publisher, not 409', async () => {
    const { id } = await archivedBook();
    const res = await api('PATCH', `/publisher/books/${id}`, {
      token: otherOwner.token,
      body: { title: 'x' },
    });
    assert.equal(res.status, 404);
  });
});
