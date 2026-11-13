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
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Spec 13.1 #1: a reader cannot access a book's asset or key without an
 * entitlement. Today ownership is a user_libraries row; the entitlements table
 * replaces it in the Commerce MVP, and these tests should carry over.
 */

let server: TestServer;
let api: ReturnType<typeof client>;

let owner: TestUser;
let stranger: TestUser;
let bookId: string;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  const publisherId = await createPublisher();
  bookId = await createBook(publisherId);
  owner = await createUser();
  stranger = await createUser();
  await grantBook(owner.id, bookId);
});

after(async () => {
  await server.close();
});

const CFI = 'epubcfi(/6/4[chap01]!/4/2/10)';

describe('library access requires ownership', () => {
  it('lets the owner read library entry, asset metadata and key', async () => {
    for (const path of [
      `/library/${bookId}`,
      `/library/${bookId}/asset`,
      `/library/${bookId}/key`,
    ]) {
      const res = await api('GET', path, { token: owner.token });
      assert.equal(res.status, 200, path);
    }
  });

  it('hides every per-book library endpoint from a non-owner', async () => {
    const probes: Array<[string, string, unknown?]> = [
      ['GET', `/library/${bookId}`],
      ['GET', `/library/${bookId}/asset`],
      ['GET', `/library/${bookId}/key`],
      ['GET', `/library/${bookId}/bookmarks`],
      ['GET', `/library/${bookId}/highlights`],
      ['PUT', `/library/${bookId}/progress`, { progress: { cfi: CFI } }],
      ['POST', `/library/${bookId}/bookmarks`, { location: CFI }],
      [
        'POST',
        `/library/${bookId}/highlights`,
        { startLocation: CFI, endLocation: CFI, highlightedText: 'text' },
      ],
    ];

    for (const [method, path, body] of probes) {
      const res = await api(method, path, { token: stranger.token, body });
      assert.equal(res.status, 404, `${method} ${path}`);
      assert.equal(res.body.error.code, 'NOT_FOUND', `${method} ${path}`);
    }
  });

  it("does not list another user's books", async () => {
    const res = await api('GET', '/library', { token: stranger.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.books, []);
  });

  it('requires authentication for the key endpoint', async () => {
    const res = await api('GET', `/library/${bookId}/key`);
    assert.equal(res.status, 401);
  });
});

describe('annotations are private to their owner', () => {
  it("cannot delete or edit another user's bookmark or highlight", async () => {
    const bookmark = await api('POST', `/library/${bookId}/bookmarks`, {
      token: owner.token,
      body: { location: CFI },
    });
    const highlight = await api('POST', `/library/${bookId}/highlights`, {
      token: owner.token,
      body: { startLocation: CFI, endLocation: CFI, highlightedText: 'Owned words' },
    });
    assert.equal(bookmark.status, 201);
    assert.equal(highlight.status, 201);

    // The stranger also owns the book, so only annotation ownership differs.
    await grantBook(stranger.id, bookId);

    const deleteBookmark = await api(
      'DELETE',
      `/library/${bookId}/bookmarks/${bookmark.body.bookmark.id}`,
      { token: stranger.token },
    );
    const editHighlight = await api(
      'PATCH',
      `/library/${bookId}/highlights/${highlight.body.highlight.id}`,
      { token: stranger.token, body: { note: 'defaced' } },
    );
    const deleteHighlight = await api(
      'DELETE',
      `/library/${bookId}/highlights/${highlight.body.highlight.id}`,
      { token: stranger.token },
    );

    assert.equal(deleteBookmark.status, 404);
    assert.equal(editHighlight.status, 404);
    assert.equal(deleteHighlight.status, 404);

    const { rows } = await pool.query(
      `SELECT (SELECT COUNT(*) FROM bookmarks)::int AS bookmarks,
              (SELECT note FROM highlights LIMIT 1) AS note`,
    );
    assert.equal(rows[0].bookmarks, 1);
    assert.equal(rows[0].note, null);
  });

  it('rejects a duplicate bookmark at the same location', async () => {
    await api('POST', `/library/${bookId}/bookmarks`, {
      token: owner.token,
      body: { location: CFI },
    });
    const res = await api('POST', `/library/${bookId}/bookmarks`, {
      token: owner.token,
      body: { location: CFI },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DUPLICATE_BOOKMARK');
  });
});

describe('catalogue visibility', () => {
  it('hides unpublished books from the public catalogue', async () => {
    const publisherId = await createPublisher();
    const draft = await createBook(publisherId, { available: false });

    const detail = await api('GET', `/books/${draft}`);
    assert.equal(detail.status, 404);

    const list = await api('GET', '/books');
    const ids = list.body.books.map((book: { id: string }) => book.id);
    assert.ok(!ids.includes(draft));
    assert.ok(ids.includes(bookId));
  });

  it('never exposes encryption parameters in the public catalogue', async () => {
    const res = await api('GET', `/books/${bookId}`);
    const json = JSON.stringify(res.body);
    for (const field of ['encrypted', 'encryption', 'Iv', 'authTag', 'AuthTag']) {
      assert.ok(!json.includes(field), `catalogue response mentions ${field}`);
    }
  });
});
