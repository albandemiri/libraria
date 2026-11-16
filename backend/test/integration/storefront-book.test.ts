import {
  type Api,
  buy,
  client,
  createBook,
  createPublisher,
  createUser,
  grantBook,
  pool,
  resetDatabase,
  startTestServer,
  type TestServer,
} from './harness';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { PNG_1X1 } from '../../src/drm/epub/fixtures';
import { objectStorage } from '../../src/drm/object-storage';

let server: TestServer;
let api: Api;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await server.close();
});

async function setTextCharacters(bookId: string, value: number | null) {
  await pool.query(
    `UPDATE book_assets SET extracted_metadata = $2::jsonb
      WHERE id = (SELECT current_asset_id FROM books WHERE id = $1)`,
    [bookId, JSON.stringify(value === null ? { title: 'x' } : { textCharacters: value })],
  );
}

describe('GET /books/:id storefront detail', () => {
  it('returns pageCount from the current asset metadata', async () => {
    const book = await createBook(await createPublisher());
    await setTextCharacters(book, 360000);
    const res = await api('GET', `/books/${book}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.book.pageCount, 200);
    assert.equal(res.body.book.availability, 'on_sale');
  });

  it('never reports fewer than one page', async () => {
    const book = await createBook(await createPublisher());
    await setTextCharacters(book, 0);
    assert.equal((await api('GET', `/books/${book}`)).body.book.pageCount, 1);
  });

  it('returns pageCount null when metadata has no textCharacters', async () => {
    const book = await createBook(await createPublisher());
    await setTextCharacters(book, null);
    const res = await api('GET', `/books/${book}`);
    assert.equal(res.body.book.pageCount, null);
  });

  it('reports not_for_sale when the publisher has no rate in force', async () => {
    const book = await createBook(await createPublisher('No Rate', { commissionBps: null }));
    const res = await api('GET', `/books/${book}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.book.availability, 'not_for_sale');
    assert.equal(res.body.book.forSale, false);
  });

  it('archived: 404 for guests and non-owners, archived for owners', async () => {
    const book = await createBook(await createPublisher());
    const owner = await createUser();
    const other = await createUser();
    await grantBook(owner.id, book);
    await pool.query(`UPDATE books SET archived_at = NOW(), is_available = FALSE WHERE id = $1`, [
      book,
    ]);

    assert.equal((await api('GET', `/books/${book}`)).status, 404);
    assert.equal((await api('GET', `/books/${book}`, { token: other.token })).status, 404);
    const res = await api('GET', `/books/${book}`, { token: owner.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.book.availability, 'archived');
    assert.equal(res.body.book.owned, true);
  });

  it('taken down: 404 for non-owners, taken_down for owners; cover served only to owners', async () => {
    const book = await createBook(await createPublisher());
    const owner = await createUser();
    const other = await createUser();
    await grantBook(owner.id, book);
    const { rows } = await pool.query(`SELECT current_asset_id FROM books WHERE id = $1`, [book]);
    await objectStorage().put(`covers/${book}/${rows[0].current_asset_id}`, PNG_1X1);
    await pool.query(`UPDATE books SET withdrawn_at = NOW(), is_available = FALSE WHERE id = $1`, [
      book,
    ]);

    assert.equal((await api('GET', `/books/${book}`)).status, 404);
    assert.equal((await api('GET', `/books/${book}`, { token: other.token })).status, 404);
    const res = await api('GET', `/books/${book}`, { token: owner.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.book.availability, 'taken_down');

    const cover = (token?: string) =>
      fetch(`${server.baseUrl}/books/${book}/cover`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    for (const denied of [await cover(), await cover(other.token)]) {
      assert.equal(denied.status, 404);
      await denied.arrayBuffer();
    }
    const served = await cover(owner.token);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('cache-control'), 'private, max-age=300');
    await served.arrayBuffer();
  });

  it('never-published and audiobook books are 404 even for an owner', async () => {
    const pub = await createPublisher();
    const draft = await createBook(pub, { available: false });
    const audio = await createBook(pub);
    await pool.query(`UPDATE books SET media_type = 'audiobook' WHERE id = $1`, [audio]);
    const owner = await createUser();
    await grantBook(owner.id, draft);
    await grantBook(owner.id, audio);

    for (const id of [draft, audio]) {
      assert.equal((await api('GET', `/books/${id}`, { token: owner.token })).status, 404);
      assert.equal((await api('GET', `/books/${id}`)).status, 404);
    }
  });
});

describe('GET /books/:id viewer block', () => {
  it('has no viewer key for guests', async () => {
    const book = await createBook(await createPublisher());
    const res = await api('GET', `/books/${book}`);
    assert.equal('viewer' in res.body, false);
    assert.equal('owned' in res.body.book, false);
  });

  it('owned with acquiredAt and progress {percent, chapterTitle}', async () => {
    const book = await createBook(await createPublisher());
    const user = await createUser();
    await grantBook(user.id, book);
    await pool.query(
      `UPDATE user_libraries SET reading_progress = $3::jsonb WHERE user_id = $1 AND book_id = $2`,
      [user.id, book, JSON.stringify({ percent: 42, chapterTitle: 'Kapitulli 7' })],
    );
    const res = await api('GET', `/books/${book}`, { token: user.token });
    assert.equal(res.body.book.owned, true);
    assert.equal(res.body.viewer.owned, true);
    assert.ok(res.body.viewer.acquiredAt);
    assert.deepEqual(res.body.viewer.progress, { percent: 42, chapterTitle: 'Kapitulli 7' });
    assert.equal(res.body.viewer.refund, null);
    assert.equal(res.body.viewer.pendingTransactionId, null);
  });

  it('progress is null for an empty progress object or no library row', async () => {
    const book = await createBook(await createPublisher());
    const user = await createUser();
    const none = await api('GET', `/books/${book}`, { token: user.token });
    assert.equal(none.body.viewer.owned, false);
    assert.equal(none.body.viewer.acquiredAt, null);
    assert.equal(none.body.viewer.progress, null);
    await grantBook(user.id, book);
    const empty = await api('GET', `/books/${book}`, { token: user.token });
    assert.equal(empty.body.viewer.progress, null);
  });

  it('refund {purchasedAt, refundedAt} after a refund, owned false', async () => {
    const book = await createBook(await createPublisher());
    const user = await createUser();
    const txId = await buy(api, user.token, [book]);
    const refund = await api('POST', `/sandbox/transactions/${txId}/events`, {
      token: user.token,
      body: { kind: 'refund' },
    });
    assert.equal(refund.status, 200);

    const res = await api('GET', `/books/${book}`, { token: user.token });
    assert.equal(res.body.viewer.owned, false);
    assert.ok(res.body.viewer.refund.purchasedAt);
    assert.ok(res.body.viewer.refund.refundedAt);
    assert.equal(res.body.viewer.pendingTransactionId, null);
  });

  it('pendingTransactionId while a checkout for the book is pending', async () => {
    const book = await createBook(await createPublisher());
    const user = await createUser();
    const checkout = await api('POST', '/checkout-sessions', {
      token: user.token,
      body: { bookIds: [book] },
    });
    assert.equal(checkout.status, 201);
    const res = await api('GET', `/books/${book}`, { token: user.token });
    assert.equal(res.body.viewer.pendingTransactionId, checkout.body.transaction.id);
  });
});
