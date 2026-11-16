import {
  type Api,
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

async function update(bookId: string, set: string, value: unknown) {
  await pool.query(`UPDATE books SET ${set} = $1 WHERE id = $2`, [value, bookId]);
}

const ids = (body: { books: { id: string }[] }) => body.books.map((b) => b.id).sort();

describe('GET /books storefront filters', () => {
  it('never lists audiobooks', async () => {
    const pub = await createPublisher();
    const ebook = await createBook(pub);
    const audio = await createBook(pub);
    await update(audio, 'media_type', 'audiobook');

    const res = await api('GET', '/books');
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res.body), [ebook]);
    assert.equal(res.body.pagination.total, 1);

    const genres = await api('GET', '/books/genres');
    assert.equal(genres.body.genres[0].bookCount, 1);
  });

  it('filters by several publisherId values', async () => {
    const [a, b, c] = [await createPublisher(), await createPublisher(), await createPublisher()];
    const bookA = await createBook(a);
    const bookB = await createBook(b);
    await createBook(c);

    const res = await api('GET', `/books?publisherId=${a}&publisherId=${b}`);
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res.body), [bookA, bookB].sort());

    const single = await api('GET', `/books?publisherId=${a}`);
    assert.deepEqual(ids(single.body), [bookA]);
  });

  it('filters by language, price range and publishedSince', async () => {
    const pub = await createPublisher();
    const old = await createBook(pub, { priceCents: 300 });
    const mid = await createBook(pub, { priceCents: 800 });
    const recent = await createBook(pub, { priceCents: 1500 });
    await update(old, 'language', 'fr');
    await update(mid, 'language', 'en');
    await update(recent, 'language', 'en');
    await update(old, 'published_at', '2015-01-01T00:00:00Z');
    await update(mid, 'published_at', '2022-01-01T00:00:00Z');
    await update(recent, 'published_at', '2025-01-01T00:00:00Z');

    assert.deepEqual(ids((await api('GET', '/books?language=fr')).body), [old]);
    assert.deepEqual(ids((await api('GET', '/books?minPrice=500&maxPrice=1000')).body), [mid]);
    assert.deepEqual(
      ids((await api('GET', '/books?publishedSince=2020-01-01')).body),
      [mid, recent].sort(),
    );
    assert.deepEqual(
      ids((await api('GET', '/books?language=en&minPrice=1000&publishedSince=2020-01-01')).body),
      [recent],
    );
  });

  it('matches search against publisher name', async () => {
    const quill = await createPublisher('Quillfeather House');
    const other = await createPublisher('Other Press');
    const mine = await createBook(quill, { title: 'Unrelated' });
    await createBook(other, { title: 'Also unrelated' });

    const res = await api('GET', '/books?search=quillfeather');
    assert.deepEqual(ids(res.body), [mine]);
  });

  it('treats % and _ in search literally', async () => {
    const pub = await createPublisher();
    const percent = await createBook(pub, { title: '50% off' });
    await createBook(pub, { title: '500 reasons' });
    const underscore = await createBook(pub, { title: 'snake_case' });
    await createBook(pub, { title: 'snakeXcase' });

    assert.deepEqual(ids((await api('GET', '/books?search=50%25')).body), [percent]);
    assert.deepEqual(ids((await api('GET', '/books?search=snake_case')).body), [underscore]);
  });

  it('rejects maxPrice below minPrice with 400 VALIDATION_FAILED', async () => {
    const res = await api('GET', '/books?minPrice=900&maxPrice=100');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  });

  it('rejects a search longer than 200 characters with 400', async () => {
    const res = await api('GET', `/books?search=${'a'.repeat(201)}`);
    assert.equal(res.status, 400);
  });

  it('returns an empty page, not an error, past the last page', async () => {
    const pub = await createPublisher();
    await createBook(pub);
    await createBook(pub);

    const res = await api('GET', '/books?page=99&limit=1');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.books, []);
    assert.equal(res.body.pagination.total, 2);
    assert.equal(res.body.pagination.totalPages, 2);
  });

  it('returns 404 for an audiobook on the detail route', async () => {
    const pub = await createPublisher();
    const audio = await createBook(pub);
    await update(audio, 'media_type', 'audiobook');

    const res = await api('GET', `/books/${audio}`);
    assert.equal(res.status, 404);
  });

  it('rejects a price above the integer range with 400, not 500', async () => {
    const res = await api('GET', '/books?maxPrice=99999999999');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  });

  it('treats a suspended account as a guest', async () => {
    const pub = await createPublisher();
    const book = await createBook(pub);
    const user = await createUser();
    await grantBook(user.id, book);
    await pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [user.id]);

    const res = await api('GET', '/books', { token: user.token });
    assert.equal(res.status, 200);
    assert.equal('owned' in res.body.books[0], false);
  });

  it('ignores the portal cookie', async () => {
    const pub = await createPublisher();
    const book = await createBook(pub);
    const user = await createUser();
    await grantBook(user.id, book);

    const res = await api('GET', '/books', {
      headers: { Cookie: `libraria_portal=${user.token}` },
    });
    assert.equal(res.status, 200);
    assert.equal('owned' in res.body.books[0], false);
  });

  it('omits owned for guests and sets owned for a signed-in owner', async () => {
    const pub = await createPublisher();
    const owned = await createBook(pub);
    const other = await createBook(pub);
    const user = await createUser();
    await grantBook(user.id, owned);

    const guest = await api('GET', '/books');
    for (const book of guest.body.books) assert.equal('owned' in book, false);

    const signedIn = await api('GET', '/books', { token: user.token });
    const byId = new Map(
      signedIn.body.books.map((b: { id: string; owned: boolean }) => [b.id, b.owned]),
    );
    assert.equal(byId.get(owned), true);
    assert.equal(byId.get(other), false);

    const detail = await api('GET', `/books/${owned}`, { token: user.token });
    assert.equal(detail.body.book.owned, true);
    const guestDetail = await api('GET', `/books/${owned}`);
    assert.equal('owned' in guestDetail.body.book, false);
  });

  it('keeps mediaType and durationSeconds in the payload', async () => {
    const pub = await createPublisher();
    await createBook(pub);
    const res = await api('GET', '/books');
    assert.equal(res.body.books[0].mediaType, 'ebook');
    assert.equal(res.body.books[0].durationSeconds, null);
  });

  it('treats an invalid or expired token as a guest', async () => {
    const pub = await createPublisher();
    await createBook(pub);

    const res = await api('GET', '/books', { headers: { Authorization: 'Bearer garbage' } });
    assert.equal(res.status, 200);
    assert.equal('owned' in res.body.books[0], false);
  });

  it('hideOwned removes owned books only when signed in', async () => {
    const pub = await createPublisher();
    const owned = await createBook(pub);
    const other = await createBook(pub);
    const user = await createUser();
    await grantBook(user.id, owned);

    const signedIn = await api('GET', '/books?hideOwned=true', { token: user.token });
    assert.deepEqual(ids(signedIn.body), [other]);

    const guest = await api('GET', '/books?hideOwned=true');
    assert.deepEqual(ids(guest.body), [owned, other].sort());
  });
});

describe('checkout', () => {
  it('refuses an audiobook with 404 NOT_FOUND', async () => {
    const pub = await createPublisher();
    const audio = await createBook(pub);
    await update(audio, 'media_type', 'audiobook');
    const user = await createUser();

    const res = await api('POST', '/checkout-sessions', {
      token: user.token,
      body: { bookIds: [audio] },
    });
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});
