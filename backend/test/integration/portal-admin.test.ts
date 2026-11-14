import {
  type Api,
  client,
  createBook,
  createPublisher,
  createUser,
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

describe('GET /admin/publishers', () => {
  it('lists publishers for admins only', async () => {
    const zed = await createPublisher('Zed Books');
    const alpha = await createPublisher('Alpha Press');
    const admin = await createUser({ role: 'admin' });
    const staff = await createUser({ role: 'publisher', publisherId: alpha });
    const reader = await createUser();

    const res = await api('GET', '/admin/publishers', { token: admin.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      publishers: [
        { id: alpha, name: 'Alpha Press' },
        { id: zed, name: 'Zed Books' },
      ],
    });

    assert.equal((await api('GET', '/admin/publishers', { token: staff.token })).status, 403);
    assert.equal((await api('GET', '/admin/publishers', { token: reader.token })).status, 403);
  });
});

describe('admin book writes with a picked publisher', () => {
  let publisherA: string;
  let publisherB: string;
  let bookB: string;
  let admin: Awaited<ReturnType<typeof createUser>>;

  async function titleOf(id: string): Promise<string> {
    const { rows } = await pool.query('SELECT title FROM books WHERE id = $1', [id]);
    return rows[0].title;
  }

  beforeEach(async () => {
    publisherA = await createPublisher('A House');
    publisherB = await createPublisher('B House');
    bookB = await createBook(publisherB, { title: 'B Original' });
    admin = await createUser({ role: 'admin' });
  });

  it("an admin naming a publisher cannot edit another publisher's book", async () => {
    const patch = await api('PATCH', `/publisher/books/${bookB}?publisherId=${publisherA}`, {
      token: admin.token,
      body: { title: 'Hijacked' },
    });
    assert.equal(patch.status, 404);
    assert.equal(await titleOf(bookB), 'B Original');

    const unpublish = await api(
      'POST',
      `/publisher/books/${bookB}/unpublish?publisherId=${publisherA}`,
      { token: admin.token },
    );
    assert.equal(unpublish.status, 404);
    const { rows } = await pool.query('SELECT is_available FROM books WHERE id = $1', [bookB]);
    assert.equal(rows[0].is_available, true);

    const draftB = await createBook(publisherB, { available: false });
    const publish = await api(
      'POST',
      `/publisher/books/${draftB}/publish?publisherId=${publisherA}`,
      { token: admin.token },
    );
    assert.equal(publish.status, 404);

    const asset = await api('POST', `/publisher/books/${bookB}/asset?publisherId=${publisherA}`, {
      token: admin.token,
      body: {
        encryptedFileUrl: '/assets/x.enc',
        encryptionIv: Buffer.alloc(12, 1).toString('base64'),
        encryptionAuthTag: Buffer.alloc(16, 2).toString('base64'),
        fileSizeBytes: 10,
      },
    });
    assert.equal(asset.status, 404);
  });

  it("a publisher's publisherId parameter cannot reach another house's book", async () => {
    const staffA = await createUser({ role: 'publisher', publisherId: publisherA });
    const patch = await api('PATCH', `/publisher/books/${bookB}?publisherId=${publisherB}`, {
      token: staffA.token,
      body: { title: 'Hijacked' },
    });
    assert.equal(patch.status, 404);
    assert.equal(await titleOf(bookB), 'B Original');

    const draftB = await createBook(publisherB, { available: false });
    const publish = await api(
      'POST',
      `/publisher/books/${draftB}/publish?publisherId=${publisherB}`,
      {
        token: staffA.token,
      },
    );
    assert.equal(publish.status, 404);
    const { rows } = await pool.query('SELECT is_available FROM books WHERE id = $1', [draftB]);
    assert.equal(rows[0].is_available, false);
  });

  it("an admin's picked publisher also scopes reading a book", async () => {
    const wrong = await api('GET', `/publisher/books/${bookB}?publisherId=${publisherA}`, {
      token: admin.token,
    });
    assert.equal(wrong.status, 404);
    const right = await api('GET', `/publisher/books/${bookB}?publisherId=${publisherB}`, {
      token: admin.token,
    });
    assert.equal(right.status, 200);
    const none = await api('GET', `/publisher/books/${bookB}`, { token: admin.token });
    assert.equal(none.status, 200);
  });

  it('an admin naming the right publisher can edit', async () => {
    const res = await api('PATCH', `/publisher/books/${bookB}?publisherId=${publisherB}`, {
      token: admin.token,
      body: { title: 'Renamed' },
    });
    assert.equal(res.status, 200);
    assert.equal(await titleOf(bookB), 'Renamed');
  });

  it('an admin without publisherId can still edit any book', async () => {
    const res = await api('PATCH', `/publisher/books/${bookB}`, {
      token: admin.token,
      body: { title: 'Admin edit' },
    });
    assert.equal(res.status, 200);
    assert.equal(await titleOf(bookB), 'Admin edit');
  });
});

describe('PATCH distinguishes an absent field from an explicit null', () => {
  it('clears isbn13, description and coverImageUrl on null and keeps them when omitted', async () => {
    const publisher = await createPublisher('Clear House');
    const admin = await createUser({ role: 'admin' });
    const book = await createBook(publisher, { title: 'Clearable' });
    await pool.query(
      `UPDATE books SET isbn13 = '9780306406157', description = 'Old text',
                        cover_image_url = 'https://example.com/c.png' WHERE id = $1`,
      [book],
    );
    const read = async () =>
      (
        await pool.query('SELECT isbn13, description, cover_image_url FROM books WHERE id = $1', [
          book,
        ])
      ).rows[0];
    const patch = (body: Record<string, unknown>) =>
      api('PATCH', `/publisher/books/${book}?publisherId=${publisher}`, {
        token: admin.token,
        body,
      });

    assert.equal((await patch({ title: 'Renamed' })).status, 200);
    assert.deepEqual(await read(), {
      isbn13: '9780306406157',
      description: 'Old text',
      cover_image_url: 'https://example.com/c.png',
    });

    assert.equal((await patch({ isbn13: null })).status, 200);
    assert.equal((await read()).isbn13, null);
    assert.equal((await read()).description, 'Old text');

    assert.equal((await patch({ description: null })).status, 200);
    assert.equal((await read()).description, null);
    assert.equal((await read()).cover_image_url, 'https://example.com/c.png');

    assert.equal((await patch({ coverImageUrl: null })).status, 200);
    assert.equal((await read()).cover_image_url, null);
  });

  it('clears durationSeconds on null for an ebook and keeps it when omitted', async () => {
    const publisher = await createPublisher('Audio House');
    const admin = await createUser({ role: 'admin' });
    const book = await createBook(publisher);
    await pool.query(
      `UPDATE books SET media_type = 'audiobook', duration_seconds = 600 WHERE id = $1`,
      [book],
    );
    const duration = async () =>
      (await pool.query('SELECT duration_seconds FROM books WHERE id = $1', [book])).rows[0]
        .duration_seconds;
    const patch = (body: Record<string, unknown>) =>
      api('PATCH', `/publisher/books/${book}?publisherId=${publisher}`, {
        token: admin.token,
        body,
      });

    assert.equal((await patch({ title: 'Still audio' })).status, 200);
    assert.equal(await duration(), 600);
    assert.equal((await patch({ mediaType: 'ebook', durationSeconds: null })).status, 200);
    assert.equal(await duration(), null);
  });
});
