import {
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
import http from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';
import { pixelBombPng } from '../../src/covers/fixtures';
import { buildEpub } from '../../src/drm/epub/fixtures';
import { ingestNow } from '../../src/drm/asset-ingestion.service';
import { objectStorage } from '../../src/drm/object-storage';
import { resetRateLimits } from '../../src/middleware/rate-limit';

let server: TestServer;
let api: ReturnType<typeof client>;
let publisherId: string;
let bookId: string;
let owner: TestUser;
let otherOwner: TestUser;
let admin: TestUser;

before(async () => {
  server = await startTestServer();
  api = client(server.baseUrl);
});

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  publisherId = await createPublisher('Cover House');
  bookId = await createBook(publisherId, { available: false });
  owner = await createUser({ role: 'publisher', publisherId });
  otherOwner = await createUser({ role: 'publisher', publisherId: await createPublisher('Other') });
  admin = await createUser({ role: 'admin' });
});

after(async () => {
  await server.close();
});

const png = (width = 800, height = 1200, background = '#aa3355') =>
  sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();

function put(
  token: string,
  body: Buffer,
  options: { book?: string; query?: string; contentType?: string } = {},
) {
  return fetch(
    `${server.baseUrl}/publisher/books/${options.book ?? bookId}/cover${options.query ?? ''}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': options.contentType ?? 'image/png',
      },
      body: body as BodyInit,
    },
  );
}

async function upload(body: Buffer, options: Parameters<typeof put>[2] = {}) {
  const res = await put(owner.token, body, options);
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const coverRow = async (book = bookId) =>
  (
    await pool.query(
      `SELECT cover_object_key, cover_thumb_key, cover_version, cover_image_url FROM books WHERE id = $1`,
      [book],
    )
  ).rows[0];

const exists = async (key: string | null) =>
  key !== null && (await objectStorage().head(key)) !== null;

describe('PUT /publisher/books/:id/cover', () => {
  it('stores the cover and returns versioned URLs', async () => {
    const res = await upload(await png());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.book.coverImageUrl, `/api/v1/books/${bookId}/cover?v=1`);
    assert.equal(res.body.book.coverThumbUrl, `/api/v1/books/${bookId}/cover?size=thumb&v=1`);
    const row = await coverRow();
    assert.match(row.cover_object_key, new RegExp(`^covers/${bookId}/u-[0-9a-f-]+\\.jpg$`));
    assert.match(row.cover_thumb_key, /-thumb\.jpg$/);
    assert.equal(row.cover_version, 1);
    assert.equal(row.cover_image_url, res.body.book.coverImageUrl);

    const detail = await api('GET', `/publisher/books/${bookId}`, { token: owner.token });
    assert.equal(detail.body.book.coverThumbUrl, res.body.book.coverThumbUrl);
    const list = await api('GET', '/publisher/books', { token: owner.token });
    assert.equal(list.body.books[0].coverThumbUrl, res.body.book.coverThumbUrl);
  });

  it('serves the re-encoded JPEG and its 480 px thumbnail', async () => {
    await upload(await png(1000, 1500));
    const full = await fetch(`${server.baseUrl}/books/${bookId}/cover?v=1`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'image/jpeg');
    assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await sharp(Buffer.from(await full.arrayBuffer())).metadata()).width, 1000);

    const thumb = await fetch(`${server.baseUrl}/books/${bookId}/cover?size=thumb&v=1`);
    assert.equal(thumb.headers.get('content-type'), 'image/jpeg');
    assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width, 480);
  });

  it('serves a cover without any EPUB asset', async () => {
    assert.equal((await fetch(`${server.baseUrl}/books/${bookId}/cover`)).status, 404);
    await upload(await png());
    assert.equal((await fetch(`${server.baseUrl}/books/${bookId}/cover`)).status, 200);
  });

  it('answers 404 for another publisher’s book', async () => {
    const res = await put(otherOwner.token, await png());
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error.code, 'NOT_FOUND');
    assert.equal((await coverRow()).cover_version, 0);
  });

  it('rejects an admin without publisherId, and accepts one with', async () => {
    const without = await put(admin.token, await png());
    assert.equal(without.status, 400);
    assert.equal((await without.json()).error.code, 'PUBLISHER_ID_REQUIRED');

    const wrong = await put(admin.token, await png(), {
      query: `?publisherId=${await createPublisher('Not the owner')}`,
    });
    assert.equal(wrong.status, 404);

    const ok = await put(admin.token, await png(), { query: `?publisherId=${publisherId}` });
    assert.equal(ok.status, 200);
  });

  it('refuses readers and anonymous callers', async () => {
    const reader = await createUser();
    assert.equal((await put(reader.token, await png())).status, 403);
    const anonymous = await fetch(`${server.baseUrl}/publisher/books/${bookId}/cover`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: (await png()) as BodyInit,
    });
    assert.equal(anonymous.status, 401);
  });

  it('refuses a withdrawn book with 403 FORBIDDEN', async () => {
    await pool.query(`UPDATE books SET withdrawn_at = NOW() WHERE id = $1`, [bookId]);
    const res = await put(owner.token, await png());
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, 'FORBIDDEN');
    const del = await api('DELETE', `/publisher/books/${bookId}/cover`, { token: owner.token });
    assert.equal(del.status, 403);
  });

  it('maps unsupported, tiny and broken images to their codes', async () => {
    const gif = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#000' },
    })
      .gif()
      .toBuffer();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><script>alert(1)</script></svg>',
    );
    const cases: Array<{ body: Buffer; status: number; code: string; contentType?: string }> = [
      { body: gif, status: 415, code: 'COVER_UNSUPPORTED_TYPE' },
      { body: await png(399, 600), status: 422, code: 'COVER_TOO_SMALL' },
      { body: await png(400, 1300), status: 422, code: 'COVER_BAD_SHAPE' },
      { body: svg, status: 415, code: 'COVER_UNSUPPORTED_TYPE', contentType: 'image/jpeg' },
      {
        body: Buffer.from('plain text renamed .jpg'),
        status: 415,
        code: 'COVER_UNSUPPORTED_TYPE',
        contentType: 'image/jpeg',
      },
      { body: Buffer.alloc(0), status: 422, code: 'COVER_INVALID' },
    ];
    for (const { body, status, code, contentType } of cases) {
      const res = await upload(body, { contentType });
      assert.equal(res.body.error.code, code);
      assert.equal(res.status, status, code);
    }
    assert.equal((await coverRow()).cover_version, 0, 'a refused upload changes nothing');
  });

  it('refuses a pixel bomb with COVER_INVALID', async () => {
    const bomb = pixelBombPng(20000, 20000);
    const res = await upload(bomb);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'COVER_INVALID');
  });

  it('answers 415 COVER_UNSUPPORTED_TYPE to a non-image Content-Type', async () => {
    const res = await upload(await png(), { contentType: 'text/plain' });
    assert.equal(res.status, 415);
    assert.equal(res.body.error.code, 'COVER_UNSUPPORTED_TYPE');
  });

  describe('body limit', () => {
    function request(headers: Record<string, string>) {
      const url = new URL(`${server.baseUrl}/publisher/books/${bookId}/cover`);
      return http.request({
        method: 'PUT',
        agent: false,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          Authorization: `Bearer ${owner.token}`,
          'Content-Type': 'image/png',
          Connection: 'keep-alive',
          ...headers,
        },
      });
    }

    function outcome(req: http.ClientRequest) {
      return new Promise<{ status: number; body: string }>((resolve, reject) => {
        req.on('response', (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', reject);
        setTimeout(() => reject(new Error('no response within 3 s')), 3000).unref();
      }).finally(() => req.destroy());
    }

    it('answers 413 to a declared Content-Length over 10 MB without reading the body', async () => {
      const req = request({ 'Content-Length': String(10 * 1024 * 1024 + 1) });
      req.flushHeaders();
      const res = await outcome(req);
      assert.equal(res.status, 413);
      assert.equal(JSON.parse(res.body).error.code, 'COVER_TOO_LARGE');
      assert.equal((await coverRow()).cover_version, 0);
    });

    it('answers 413 to a chunked body that never stops', async () => {
      const req = request({ 'Transfer-Encoding': 'chunked' });
      const chunk = Buffer.alloc(256 * 1024);
      const timer = setInterval(() => req.write(chunk), 2);
      const started = Date.now();
      const res = await outcome(req).finally(() => clearInterval(timer));
      assert.equal(res.status, 413);
      assert.equal(JSON.parse(res.body).error.code, 'COVER_TOO_LARGE');
      assert.ok(Date.now() - started < 3000);
    });
  });

  it('bumps the version on every upload and deletes the replaced objects', async () => {
    const first = await upload(await png(800, 1200, '#112233'));
    const firstRow = await coverRow();
    const second = await upload(await png(800, 1200, '#445566'));
    assert.equal(first.body.book.coverImageUrl.endsWith('?v=1'), true);
    assert.equal(second.status, 200);
    assert.equal(second.body.book.coverImageUrl, `/api/v1/books/${bookId}/cover?v=2`);
    assert.equal(second.body.book.coverThumbUrl, `/api/v1/books/${bookId}/cover?size=thumb&v=2`);

    assert.equal(await exists(firstRow.cover_object_key), false);
    assert.equal(await exists(firstRow.cover_thumb_key), false);
    const row = await coverRow();
    assert.equal(await exists(row.cover_object_key), true);
    assert.equal(await exists(row.cover_thumb_key), true);
  });

  it('keeps the last commit and leaves no orphans when uploads race', async () => {
    const results = await Promise.all(
      [0, 1, 2].map(async (i) =>
        put(owner.token, await png(800, 1200, `#${i}${i}${i}${i}${i}${i}`)),
      ),
    );
    assert.deepEqual(
      results.map((r) => r.status),
      [200, 200, 200],
    );
    const versions = (await Promise.all(results.map((r) => r.clone().json()))).map((b) =>
      Number(new URL(b.book.coverImageUrl, 'http://x').searchParams.get('v')),
    );
    assert.deepEqual(versions.sort(), [1, 2, 3], 'every response carries its own version');
    const row = await coverRow();
    assert.equal(row.cover_version, 3);
    assert.equal(await exists(row.cover_object_key), true);
    assert.equal(await exists(row.cover_thumb_key), true);

    const stored = (await objectStorage().list(`covers/${bookId}`)).map((o) => o.key).sort();
    assert.deepEqual(stored, [row.cover_object_key, row.cover_thumb_key].sort());
  });

  it('accepts application/octet-stream', async () => {
    const res = await upload(await png(), { contentType: 'application/octet-stream' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  it('accepts a chunked upload under the limit', async () => {
    const image = await png();
    const url = new URL(`${server.baseUrl}/publisher/books/${bookId}/cover`);
    const req = http.request({
      method: 'PUT',
      agent: false,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: {
        Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'image/png',
        'Transfer-Encoding': 'chunked',
      },
    });
    const half = Math.floor(image.length / 2);
    req.write(image.subarray(0, half));
    req.end(image.subarray(half));
    const status = await new Promise<number>((resolve, reject) => {
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
    });
    assert.equal(status, 200);
    assert.equal((await coverRow()).cover_version, 1);
  });

  describe('refusals that never read the body', () => {
    // A client that keeps streaming after a 401/415: it is answered, then cut off.
    async function endlessRefusal(headers: Record<string, string>) {
      const url = new URL(`${server.baseUrl}/publisher/books/${bookId}/cover`);
      const req = http.request({
        method: 'PUT',
        agent: false,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: { 'Transfer-Encoding': 'chunked', Connection: 'keep-alive', ...headers },
      });
      req.on('error', () => undefined);
      const chunk = Buffer.alloc(16 * 1024);
      const timer = setInterval(() => req.write(chunk), 5);
      const started = Date.now();
      const status = await new Promise<number>((resolve, reject) => {
        req.on('response', (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        setTimeout(() => reject(new Error('no response within 3 s')), 3000).unref();
      });
      await new Promise<void>((resolve, reject) => {
        req.on('close', resolve);
        setTimeout(() => reject(new Error('connection not cut within 4 s')), 4000).unref();
      }).finally(() => {
        clearInterval(timer);
        req.destroy();
      });
      return { status, elapsed: Date.now() - started };
    }

    it('cuts off a 415 whose body keeps coming', async () => {
      const { status, elapsed } = await endlessRefusal({
        Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'text/plain',
      });
      assert.equal(status, 415);
      assert.ok(elapsed < 4000);
    });

    it('cuts off a 401 whose body keeps coming', async () => {
      const { status } = await endlessRefusal({ 'Content-Type': 'image/png' });
      assert.equal(status, 401);
    });
  });

  it('rejects coverImageUrl in the create and patch bodies', async () => {
    const patch = await api('PATCH', `/publisher/books/${bookId}`, {
      token: owner.token,
      body: { coverImageUrl: 'https://example.com/c.png' },
    });
    assert.equal(patch.status, 400);
    assert.equal(patch.body.error.code, 'VALIDATION_FAILED');
    const create = await api('POST', '/publisher/books', {
      token: owner.token,
      body: {
        title: 'T',
        author: 'A',
        genre: 'G',
        priceCents: 100,
        coverImageUrl: 'https://example.com/c.png',
      },
    });
    assert.equal(create.status, 400);
  });
});

describe('DELETE /publisher/books/:id/cover', () => {
  it('falls back to the EPUB cover, bumps the version and drops the thumbnail', async () => {
    const { assetId } = await createReadyAsset(bookId);
    await objectStorage().put(`covers/${bookId}/${assetId}`, await png(500, 700, '#00ff00'));
    const uploaded = await upload(await png(800, 1200, '#ff0000'));
    const row = await coverRow();

    const res = await api('DELETE', `/publisher/books/${bookId}/cover`, { token: owner.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.book.coverImageUrl, `/api/v1/books/${bookId}/cover?v=2`);
    assert.equal(res.body.book.coverThumbUrl, null);
    assert.notEqual(uploaded.body.book.coverImageUrl, res.body.book.coverImageUrl);
    assert.equal(await exists(row.cover_object_key), false);
    assert.equal(await exists(row.cover_thumb_key), false);

    const served = await fetch(`${server.baseUrl}/books/${bookId}/cover?v=2`);
    assert.equal(served.status, 200);
    assert.equal((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).width, 500);
    const thumb = await fetch(`${server.baseUrl}/books/${bookId}/cover?size=thumb`);
    assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width, 500);
  });

  it('leaves no cover when there is no EPUB cover', async () => {
    await upload(await png());
    const res = await api('DELETE', `/publisher/books/${bookId}/cover`, { token: owner.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.book.coverImageUrl, null);
    assert.equal(res.body.book.coverThumbUrl, null);
    assert.equal((await fetch(`${server.baseUrl}/books/${bookId}/cover`)).status, 404);
    assert.equal((await coverRow()).cover_version, 2);
  });

  it('answers 404 for another publisher’s book and needs publisherId for admins', async () => {
    assert.equal(
      (await api('DELETE', `/publisher/books/${bookId}/cover`, { token: otherOwner.token })).status,
      404,
    );
    const adminRes = await api('DELETE', `/publisher/books/${bookId}/cover`, {
      token: admin.token,
    });
    assert.equal(adminRes.status, 400);
    assert.equal(adminRes.body.error.code, 'PUBLISHER_ID_REQUIRED');
  });
});

describe('precedence over the EPUB cover', () => {
  it('keeps an uploaded cover when an EPUB with its own cover is processed afterwards', async () => {
    await upload(await png(800, 1200, '#ff0000'));
    const before = await coverRow();
    await ingestNow(bookId, admin.id, buildEpub({ cover: true }));
    const after = await coverRow();
    assert.equal(after.cover_image_url, before.cover_image_url);
    assert.equal(after.cover_object_key, before.cover_object_key);

    const served = await fetch(`${server.baseUrl}/books/${bookId}/cover`);
    assert.equal((await sharp(Buffer.from(await served.arrayBuffer())).metadata()).width, 800);
  });
});

describe('the cover URL is versioned wherever it changes', () => {
  const state = async () => {
    const row = await coverRow();
    return { url: row.cover_image_url as string | null, version: row.cover_version as number };
  };
  const activate = (assetId: string) =>
    api('POST', `/publisher/books/${bookId}/assets/${assetId}/activate`, { token: owner.token });

  it('versions the EPUB cover that fills in after an upload was removed', async () => {
    await upload(await png());
    await api('DELETE', `/publisher/books/${bookId}/cover`, { token: owner.token });
    const removed = await state();
    assert.deepEqual(removed, { url: null, version: 2 });

    await ingestNow(bookId, admin.id, buildEpub({ cover: true }));
    const after = await state();
    assert.equal(after.url, `/api/v1/books/${bookId}/cover?v=3`);
    assert.ok(after.version > removed.version);
  });

  it('leaves the URL alone for an asset that does not go live, and versions activation', async () => {
    const first = await ingestNow(bookId, admin.id, buildEpub({ cover: true }));
    assert.equal(first.state, 'ready');
    assert.deepEqual(await state(), { url: `/api/v1/books/${bookId}/cover?v=1`, version: 1 });

    // Not live: the book already has a current asset.
    const second = await ingestNow(bookId, admin.id, buildEpub({ title: 'No cover' }));
    assert.equal(second.state, 'ready');
    assert.deepEqual(await state(), { url: `/api/v1/books/${bookId}/cover?v=1`, version: 1 });

    // Activating one without a cover clears the URL; the next one with a cover versions it again.
    assert.equal((await activate(second.id)).status, 200);
    assert.deepEqual(await state(), { url: null, version: 2 });
    assert.equal((await activate(first.id)).status, 200);
    assert.deepEqual(await state(), { url: `/api/v1/books/${bookId}/cover?v=3`, version: 3 });
  });

  it('does not touch an uploaded cover on activation', async () => {
    const first = await ingestNow(bookId, admin.id, buildEpub({ title: 'One' }));
    const second = await ingestNow(bookId, admin.id, buildEpub({ title: 'Two', cover: true }));
    await upload(await png());
    const before = await state();
    assert.equal((await activate(second.id)).status, 200);
    assert.deepEqual(await state(), before);
    assert.ok(first.id);
  });
});
