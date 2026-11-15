import {
  type Api,
  buy,
  client,
  createBook,
  createPublisher,
  createReadyAsset,
  createUser,
  pool,
  resetDatabase,
  startTestServer,
  type TestServer,
  type TestUser,
} from './harness';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

let server: TestServer;
let api: Api;
let publisherId: string;
let staff: TestUser;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  publisherId = await createPublisher();
  staff = await createUser({ role: 'publisher', publisherId });
});

after(async () => {
  await server.close();
});

async function insertAsset(bookId: string, state: string, reasonCode: string | null = null) {
  const { rows } = await pool.query<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM book_assets WHERE book_id = $1`,
    [bookId],
  );
  await pool.query(
    `INSERT INTO book_assets (book_id, version, state, reason_code, original_size_bytes)
     VALUES ($1, $2, $3::asset_state, $4, 100)`,
    [bookId, rows[0].version, state, reasonCode],
  );
}

async function list(query = '') {
  const res = await api('GET', `/publisher/books${query}`, { token: staff.token });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.books as Array<{
    id: string;
    title: string;
    status: string;
    latestAsset: { state: string; reasonCode: string | null } | null;
  }>;
}

describe('book status', () => {
  it('derives each status with the documented precedence', async () => {
    await createBook(publisherId, { available: false, title: 'Draft' });
    const rejected = await createBook(publisherId, { available: false, title: 'Rejected' });
    await insertAsset(rejected, 'rejected', 'NOT_EPUB');
    const processing = await createBook(publisherId, { available: false, title: 'Processing' });
    await insertAsset(processing, 'scanning');
    const ready = await createBook(publisherId, { available: false, title: 'Ready' });
    await createReadyAsset(ready);
    const published = await createBook(publisherId, { title: 'Published' });
    // Published wins over a processing replacement.
    await insertAsset(published, 'validating');
    const withdrawn = await createBook(publisherId, { title: 'Withdrawn' });
    // Withdrawn wins over published.
    await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [withdrawn]);

    const byTitle = Object.fromEntries((await list('?limit=100')).map((b) => [b.title, b]));
    assert.equal(byTitle.Draft.status, 'draft');
    assert.equal(byTitle.Draft.latestAsset, null);
    assert.equal(byTitle.Rejected.status, 'draft');
    assert.deepEqual(byTitle.Rejected.latestAsset, { state: 'rejected', reasonCode: 'NOT_EPUB' });
    assert.equal(byTitle.Processing.status, 'processing');
    assert.deepEqual(byTitle.Processing.latestAsset, { state: 'scanning', reasonCode: null });
    assert.equal(byTitle.Ready.status, 'ready');
    assert.equal(byTitle.Published.status, 'published');
    assert.equal(byTitle.Published.latestAsset?.state, 'validating');
    assert.equal(byTitle.Withdrawn.status, 'withdrawn');
  });

  it('shows processing over ready when a replacement is being processed', async () => {
    const book = await createBook(publisherId, { available: false, title: 'Replacing' });
    await createReadyAsset(book);
    await insertAsset(book, 'encrypting');
    const [row] = await list();
    assert.equal(row.status, 'processing');
  });

  it('filters by each status and keeps the legacy values working', async () => {
    await createBook(publisherId, { available: false, title: 'Draft' });
    const processing = await createBook(publisherId, { available: false, title: 'Processing' });
    await insertAsset(processing, 'storing');
    const ready = await createBook(publisherId, { available: false, title: 'Ready' });
    await createReadyAsset(ready);
    await createBook(publisherId, { title: 'Published' });
    const withdrawn = await createBook(publisherId, { title: 'Withdrawn' });
    await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [withdrawn]);

    const titles = async (status: string) =>
      (await list(`?status=${status}`)).map((b) => b.title).sort();
    assert.deepEqual(await titles('draft'), ['Draft']);
    assert.deepEqual(await titles('processing'), ['Processing']);
    assert.deepEqual(await titles('ready'), ['Ready']);
    assert.deepEqual(await titles('published'), ['Published']);
    assert.deepEqual(await titles('withdrawn'), ['Withdrawn']);
    assert.equal((await titles('all')).length, 5);

    const bad = await api('GET', '/publisher/books?status=nope', { token: staff.token });
    assert.equal(bad.status, 400);
  });
});

describe('single book payload', () => {
  async function get(id: string) {
    const res = await api('GET', `/publisher/books/${id}`, { token: staff.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.book as { status: string; latestAsset: unknown };
  }

  it('returns status and latestAsset for published, withdrawn and rejected books', async () => {
    const published = await createBook(publisherId, { title: 'Published' });
    await createReadyAsset(published);
    const withdrawn = await createBook(publisherId, { title: 'Withdrawn' });
    await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [withdrawn]);
    const rejected = await createBook(publisherId, { available: false, title: 'Rejected' });
    await insertAsset(rejected, 'rejected', 'NOT_EPUB');

    const p = await get(published);
    assert.equal(p.status, 'published');
    assert.deepEqual(p.latestAsset, { state: 'ready', reasonCode: null });
    assert.equal((await get(withdrawn)).status, 'withdrawn');
    const r = await get(rejected);
    assert.equal(r.status, 'draft');
    assert.deepEqual(r.latestAsset, { state: 'rejected', reasonCode: 'NOT_EPUB' });
  });

  it('includes status in write responses', async () => {
    const id = await createBook(publisherId, { available: false, title: 'Before' });
    const res = await api('PATCH', `/publisher/books/${id}`, {
      token: staff.token,
      body: { title: 'After' },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.book.title, 'After');
    assert.equal(res.body.book.status, 'draft');
    assert.equal(res.body.book.latestAsset, null);
  });
});

describe('book sorting', () => {
  it('sorts by copies, earnings, title and price', async () => {
    const a = await createBook(publisherId, { title: 'Alpha', priceCents: 300 });
    const b = await createBook(publisherId, { title: 'Bravo', priceCents: 1000 });
    const c = await createBook(publisherId, { title: 'Charlie', priceCents: 400 });
    const readers = [await createUser(), await createUser(), await createUser()];
    // Copies: Alpha 3, Charlie 2, Bravo 1.
    // Earnings (gross less 20%): Bravo 800, Alpha 720, Charlie 640.
    for (const r of readers) await buy(api, r.token, [a]);
    for (const r of readers.slice(0, 2)) await buy(api, r.token, [c]);
    await buy(api, readers[0].token, [b]);

    const titles = async (q: string) => (await list(q)).map((x) => x.title);
    assert.deepEqual(await titles('?sort=copies'), ['Alpha', 'Charlie', 'Bravo']);
    assert.deepEqual(await titles('?sort=copies&order=asc'), ['Bravo', 'Charlie', 'Alpha']);
    assert.deepEqual(await titles('?sort=earnings'), ['Bravo', 'Alpha', 'Charlie']);
    assert.deepEqual(await titles('?sort=earnings&order=asc'), ['Charlie', 'Alpha', 'Bravo']);
    // Title defaults to ascending.
    assert.deepEqual(await titles('?sort=title'), ['Alpha', 'Bravo', 'Charlie']);
    assert.deepEqual(await titles('?sort=title&order=desc'), ['Charlie', 'Bravo', 'Alpha']);
    assert.deepEqual(await titles('?sort=price'), ['Bravo', 'Charlie', 'Alpha']);
    assert.deepEqual(await titles('?sort=price&order=asc'), ['Alpha', 'Charlie', 'Bravo']);
  });

  it('rejects sort values outside the whitelist', async () => {
    for (const q of ['sort=title;DROP%20TABLE%20books', 'sort=price_cents', 'order=sideways']) {
      const res = await api('GET', `/publisher/books?${q}`, { token: staff.token });
      assert.equal(res.status, 400, q);
    }
  });

  it('paginates deterministically on a tie', async () => {
    for (let i = 0; i < 3; i++) await createBook(publisherId, { title: `Tied ${i}` });
    const first = await list('?sort=copies&limit=2&page=1');
    const second = await list('?sort=copies&limit=2&page=2');
    const ids = [...first, ...second].map((x) => x.id);
    assert.equal(new Set(ids).size, 3);
  });
});

describe('tenant scope', () => {
  it('never lists another publisher books', async () => {
    const other = await createPublisher();
    await createBook(other, { title: 'Other' });
    await createBook(publisherId, { title: 'Mine' });
    const mine = await list(`?publisherId=${other}`);
    assert.deepEqual(
      mine.map((b) => b.title),
      ['Mine'],
    );
  });
});
