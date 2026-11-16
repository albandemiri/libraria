import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
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

async function set(bookId: string, fields: Record<string, unknown>) {
  for (const [column, value] of Object.entries(fields)) {
    await pool.query(`UPDATE books SET ${column} = $1 WHERE id = $2`, [value, bookId]);
  }
}

describe('GET /books/facets', () => {
  it('facet counts ignore their own dimension', async () => {
    const a = await createPublisher('Publisher A');
    const b = await createPublisher('Publisher B');
    const a1 = await createBook(a);
    const a2 = await createBook(a);
    const b1 = await createBook(b);
    await set(a1, { language: 'sq' });
    await set(a2, { language: 'sq' });
    await set(b1, { language: 'en', genre: 'Poetry' });

    const res = await api('GET', `/books/facets?publisherId=${a}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 2);
    assert.deepEqual(
      res.body.publishers.map((p: { bookCount: number }) => p.bookCount).sort(),
      [1, 2],
    );
    assert.deepEqual(res.body.languages, [{ language: 'sq', bookCount: 2 }]);
    // genres respect the publisher filter
    assert.deepEqual(res.body.genres, [{ genre: 'Fiction', bookCount: 2 }]);

    const byGenre = await api('GET', '/books/facets?genre=Poetry');
    assert.equal(byGenre.body.total, 1);
    assert.deepEqual(byGenre.body.genres.map((g: { genre: string }) => g.genre).sort(), [
      'Fiction',
      'Poetry',
    ]);
    assert.deepEqual(byGenre.body.languages, [{ language: 'en', bookCount: 1 }]);
  });

  it('facets exclude audiobooks and unavailable books', async () => {
    const pub = await createPublisher();
    await createBook(pub);
    const audio = await createBook(pub);
    await set(audio, { media_type: 'audiobook', language: 'fr' });
    await createBook(pub, { available: false });

    const res = await api('GET', '/books/facets');
    assert.equal(res.body.total, 1);
    assert.equal(res.body.publishers[0].bookCount, 1);
    assert.deepEqual(res.body.languages, [{ language: 'sq', bookCount: 1 }]);
    assert.equal(
      res.body.genres.reduce((n: number, g: { bookCount: number }) => n + g.bookCount, 0),
      1,
    );
  });

  it('rejects an invalid filter with 400', async () => {
    const res = await api('GET', '/books/facets?language=ENGLISH');
    assert.equal(res.status, 400);
  });
});

describe('GET /search/suggest', () => {
  it('groups titles, authors and publishers', async () => {
    const pub = await createPublisher('Hanibal Botime');
    const other = await createPublisher('Other House');
    const t1 = await createBook(pub, { title: 'Zonja e Hanit' });
    const t2 = await createBook(pub, { title: 'Hana dhe deti' });
    const t3 = await createBook(other, { title: 'Unrelated' });
    await set(t1, { author: 'Ana Pika', genre: 'Fiction' });
    await set(t2, { author: 'Hana Mema', genre: 'Poetry' });
    const t4 = await createBook(pub, { title: 'Another' });
    await set(t4, { author: 'Hana Mema', genre: 'Poetry' });
    const t5 = await createBook(pub, { title: 'Third' });
    await set(t5, { author: 'Hana Mema', genre: 'Fiction' });
    await set(t3, { author: 'Zed' });
    // an audiobook by a matching author must not count
    const audio = await createBook(pub, { title: 'Audio' });
    await set(audio, { author: 'Hana Mema', genre: 'Drama', media_type: 'audiobook' });

    const res = await api('GET', '/search/suggest?q=han');
    assert.equal(res.status, 200);
    const titles = res.body.titles.map((t: { title: string }) => t.title);
    assert.ok(titles.includes('Zonja e Hanit'));
    assert.ok(titles.includes('Hana dhe deti'));
    assert.equal(titles.includes('Unrelated'), false);
    assert.equal(titles.includes('Audio'), false);
    // earlier match position first
    assert.ok(titles.indexOf('Hana dhe deti') < titles.indexOf('Zonja e Hanit'));
    assert.equal('owned' in res.body.titles[0], false);

    assert.deepEqual(res.body.authors, [{ name: 'Hana Mema', bookCount: 3, mainGenre: 'Poetry' }]);
    assert.equal(res.body.publishers.length, 1);
    assert.equal(res.body.publishers[0].name, 'Hanibal Botime');
    assert.equal(res.body.publishers[0].id, pub);
    assert.equal(res.body.publishers[0].bookCount, 4);
  });

  it('rejects q shorter than 2 characters with 400', async () => {
    assert.equal((await api('GET', '/search/suggest?q=a')).status, 400);
    assert.equal((await api('GET', '/search/suggest?q=%20a%20')).status, 400);
    assert.equal((await api('GET', '/search/suggest')).status, 400);
  });

  it('marks owned titles for a signed-in reader', async () => {
    const pub = await createPublisher();
    const owned = await createBook(pub, { title: 'Hana owned' });
    await createBook(pub, { title: 'Hana free' });
    const user = await createUser();
    await grantBook(user.id, owned);

    const res = await api('GET', '/search/suggest?q=hana', { token: user.token });
    const byTitle = new Map(
      res.body.titles.map((t: { title: string; owned: boolean }) => [t.title, t.owned]),
    );
    assert.equal(byTitle.get('Hana owned'), true);
    assert.equal(byTitle.get('Hana free'), false);
  });
});
