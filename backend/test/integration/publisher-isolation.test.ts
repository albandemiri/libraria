import {
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
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { signAccessToken } from '../../src/auth/tokens';

/**
 * Spec 13.1 #2: a publisher cannot modify another publisher's books or access
 * another publisher's sales data. Every probe below is made by publisher A
 * against publisher B's resources.
 */

let server: TestServer;
let api: ReturnType<typeof client>;

let publisherA: string;
let publisherB: string;
let staffA: TestUser;
let staffB: TestUser;
let bookA: string;
let bookB: string;
let draftB: string;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  publisherA = await createPublisher('House A');
  publisherB = await createPublisher('House B');
  staffA = await createUser({ role: 'publisher', publisherId: publisherA });
  staffB = await createUser({ role: 'publisher', publisherId: publisherB });
  bookA = await createBook(publisherA, { title: 'A Book' });
  bookB = await createBook(publisherB, { title: 'B Book', priceCents: 1000 });
  draftB = await createBook(publisherB, { title: 'B Draft', available: false });
});

after(async () => {
  await server.close();
});

describe('role enforcement', () => {
  it('rejects unauthenticated access to the publisher portal', async () => {
    const res = await api('GET', '/publisher/books');
    assert.equal(res.status, 401);
  });

  it('forbids readers from the publisher portal', async () => {
    const reader = await createUser();
    for (const [method, path] of [
      ['GET', '/publisher/books'],
      ['GET', '/publisher/stats'],
      ['POST', '/publisher/books'],
      ['PATCH', `/publisher/books/${bookA}`],
    ] as const) {
      const res = await api(method, path, {
        token: reader.token,
        body: method === 'GET' ? undefined : {},
      });
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(res.body.error.code, 'FORBIDDEN');
    }
  });
});

describe('publisher tenant isolation', () => {
  it("lists only the caller's own books", async () => {
    const res = await api('GET', '/publisher/books', { token: staffA.token });
    assert.equal(res.status, 200);
    const ids = res.body.books.map((book: { id: string }) => book.id);
    assert.deepEqual(ids, [bookA]);
  });

  it('ignores a publisherId query parameter from a publisher account', async () => {
    const res = await api('GET', `/publisher/books?publisherId=${publisherB}`, {
      token: staffA.token,
    });
    assert.equal(res.status, 200);
    const ids = res.body.books.map((book: { id: string }) => book.id);
    assert.deepEqual(ids, [bookA]);
  });

  it("cannot read another publisher's book", async () => {
    for (const id of [bookB, draftB]) {
      const res = await api('GET', `/publisher/books/${id}`, { token: staffA.token });
      assert.equal(res.status, 404);
    }
  });

  it("cannot edit another publisher's book", async () => {
    const res = await api('PATCH', `/publisher/books/${bookB}`, {
      token: staffA.token,
      body: { title: 'Hijacked', priceCents: 1 },
    });
    assert.equal(res.status, 404);

    const { rows } = await pool.query('SELECT title, price_cents FROM books WHERE id = $1', [
      bookB,
    ]);
    assert.equal(rows[0].title, 'B Book');
    assert.equal(rows[0].price_cents, 1000);
  });

  it("cannot replace another publisher's asset", async () => {
    const res = await api('POST', `/publisher/books/${bookB}/asset`, {
      token: staffA.token,
      body: {
        encryptedFileUrl: '/assets/books/evil.epub.enc',
        encryptionIv: Buffer.alloc(12).toString('base64'),
        encryptionAuthTag: Buffer.alloc(16).toString('base64'),
        fileSizeBytes: 10,
      },
    });
    assert.equal(res.status, 404);

    const { rows } = await pool.query('SELECT encrypted_file_url FROM books WHERE id = $1', [
      bookB,
    ]);
    assert.equal(rows[0].encrypted_file_url, '/assets/books/fixture.epub.enc');
  });

  it("cannot publish or unpublish another publisher's book", async () => {
    const publish = await api('POST', `/publisher/books/${draftB}/publish`, {
      token: staffA.token,
    });
    const unpublish = await api('POST', `/publisher/books/${bookB}/unpublish`, {
      token: staffA.token,
    });
    assert.equal(publish.status, 404);
    assert.equal(unpublish.status, 404);

    const { rows } = await pool.query(
      'SELECT id, is_available FROM books WHERE id = ANY($1) ORDER BY title',
      [[bookB, draftB]],
    );
    assert.deepEqual(
      rows.map((row) => row.is_available),
      [true, false],
    );
  });

  it("cannot create a book under another publisher's account", async () => {
    const res = await api('POST', '/publisher/books', {
      token: staffA.token,
      body: {
        title: 'Planted',
        author: 'Someone',
        genre: 'Fiction',
        priceCents: 100,
        publisherId: publisherB,
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.book.publisherId, publisherA);
  });

  it("sees only its own sales in stats, even when asking for another publisher's", async () => {
    // A completed sale of publisher B's book.
    const reader = await createUser();
    await api('POST', '/transactions', { token: reader.token, body: { bookId: bookB } });

    const own = await api('GET', '/publisher/stats', { token: staffA.token });
    const probe = await api('GET', `/publisher/stats?publisherId=${publisherB}`, {
      token: staffA.token,
    });
    const b = await api('GET', '/publisher/stats', { token: staffB.token });

    assert.equal(own.status, 200);
    assert.equal(own.body.publisherId, publisherA);
    assert.equal(probe.body.publisherId, publisherA);
    assert.deepEqual(probe.body.stats, own.body.stats);
    assert.notDeepEqual(b.body.stats, own.body.stats);
  });

  it('fails closed for a publisher-role token with no linked publishing house', async () => {
    // Should be impossible (users.publisher_linkage), but the route must not
    // fall back to an unfiltered query if it ever happens.
    const orphanToken = signAccessToken({
      userId: staffA.id,
      role: 'publisher',
      publisherId: null,
    });

    const list = await api('GET', '/publisher/books', { token: orphanToken });
    assert.equal(list.status, 403);
    assert.equal(list.body.error.code, 'PUBLISHER_NOT_LINKED');

    const read = await api('GET', `/publisher/books/${bookB}`, { token: orphanToken });
    assert.equal(read.status, 403);
  });
});

describe('admin access', () => {
  it('can list all publishers or filter by one', async () => {
    const admin = await createUser({ role: 'admin' });

    const all = await api('GET', '/publisher/books', { token: admin.token });
    assert.equal(all.body.books.length, 3);

    const onlyB = await api('GET', `/publisher/books?publisherId=${publisherB}`, {
      token: admin.token,
    });
    assert.equal(onlyB.body.books.length, 2);
  });

  it('gets a validation error, not a 500, for a malformed publisherId', async () => {
    const admin = await createUser({ role: 'admin' });
    const res = await api('GET', '/publisher/books?publisherId=not-a-uuid', { token: admin.token });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  });
});
