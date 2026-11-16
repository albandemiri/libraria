import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  type Api,
  client,
  createBook,
  createPublisher,
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

describe('publishers', () => {
  it('lists publishers with storefront books, sorted by name, without private fields', async () => {
    const zed = await createPublisher('Zed Books');
    const alpha = await createPublisher('Alpha Press');
    const draftOnly = await createPublisher('Draft House');
    const audioOnly = await createPublisher('Audio House');
    await pool.query(`UPDATE publishers SET country = 'AL' WHERE id = $1`, [alpha]);
    await createBook(zed);
    await createBook(alpha);
    await createBook(draftOnly, { available: false });
    await set(await createBook(audioOnly), { media_type: 'audiobook' });

    const res = await api('GET', '/publishers');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.publishers.map((p: { name: string }) => p.name),
      ['Alpha Press', 'Zed Books'],
    );
    assert.deepEqual(Object.keys(res.body.publishers[0]).sort(), [
      'bookCount',
      'country',
      'genres',
      'id',
      'name',
      'newestYear',
    ]);
    assert.equal(res.body.publishers[0].country, 'AL');
    assert.equal(res.body.publishers[1].country, null);
  });

  it('counts storefront ebooks only and reports genres by count and the newest year', async () => {
    const pub = await createPublisher('Mixed');
    const a = await createBook(pub);
    const b = await createBook(pub);
    const c = await createBook(pub);
    await set(a, { genre: 'Poetry', published_at: '2019-05-01' });
    await set(b, { genre: 'Fiction', published_at: '2024-02-10' });
    await set(c, { genre: 'Poetry', published_at: '2021-01-01' });
    const audio = await createBook(pub);
    await set(audio, { media_type: 'audiobook', genre: 'Crime', published_at: '2026-01-01' });
    await createBook(pub, { available: false });

    const res = await api('GET', `/publishers/${pub}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.publisher.bookCount, 3);
    assert.deepEqual(res.body.publisher.genres, ['Poetry', 'Fiction']);
    assert.equal(res.body.publisher.newestYear, 2024);
    assert.equal(res.body.publisher.contact_email, undefined);
    assert.equal(res.body.publisher.contactEmail, undefined);
  });

  it('newestYear is null when no book has a publication date', async () => {
    const pub = await createPublisher('Undated');
    await createBook(pub);
    const res = await api('GET', `/publishers/${pub}`);
    assert.equal(res.body.publisher.newestYear, null);
  });

  it('gives 404 for unknown, malformed, draft-only and empty publishers', async () => {
    const draftOnly = await createPublisher('Drafts');
    await createBook(draftOnly, { available: false });
    const empty = await createPublisher('Empty');
    const unknown = '00000000-0000-4000-8000-000000000000';

    for (const id of [draftOnly, empty, unknown, 'not-a-uuid']) {
      const res = await api('GET', `/publishers/${id}`);
      assert.equal(res.status, 404, id);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    }
  });
});
