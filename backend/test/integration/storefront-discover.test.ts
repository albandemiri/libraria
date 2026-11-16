import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type * as DiscoverModule from '../../src/storefront/discover.service';
import type { DiscoverSection } from '../../src/storefront/discover.service';
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

// Loaded after the harness so the test environment (asset dir, database) is in place first.
let buildDiscover: typeof DiscoverModule.buildDiscover;
let isoWeek: typeof DiscoverModule.isoWeek;
let weeklyPick: typeof DiscoverModule.weeklyPick;
let server: TestServer;
let api: Api;

before(async () => {
  ({ buildDiscover, isoWeek, weeklyPick } = await import('../../src/storefront/discover.service'));
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

const COVER = 'covers/x.jpg';
const NOW = new Date('2026-11-16T12:00:00Z');

function section<T extends DiscoverSection['type']>(
  res: { sections: DiscoverSection[] },
  type: T,
): Extract<DiscoverSection, { type: T }> | undefined {
  return res.sections.find((s) => s.type === type) as
    | Extract<DiscoverSection, { type: T }>
    | undefined;
}

describe('discover', () => {
  it('isoWeek matches ISO-8601 at year boundaries', () => {
    assert.deepEqual(isoWeek(new Date('2026-12-31T12:00:00Z')), { isoYear: 2026, isoWeek: 53 });
    assert.deepEqual(isoWeek(new Date('2027-01-04T12:00:00Z')), { isoYear: 2027, isoWeek: 1 });
  });

  it('weeklyPick does not mutate its input and handles empty lists', () => {
    const items = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    const copy = [...items];
    assert.ok(weeklyPick(items, NOW));
    assert.deepEqual(items, copy);
    assert.equal(weeklyPick([], NOW), undefined);
  });

  it('featured is stable within a week and rotates across weeks', async () => {
    const pub = await createPublisher('Pub');
    for (let i = 0; i < 3; i++) {
      await set(await createBook(pub), { cover_image_url: COVER, published_at: '2026-11-10' });
    }
    const monday = await buildDiscover(null, new Date('2026-11-16T00:00:00Z'));
    const sunday = await buildDiscover(null, new Date('2026-11-22T23:00:00Z'));
    assert.equal(section(monday, 'featured')?.book.id, section(sunday, 'featured')?.book.id);

    const ids = new Set<string>();
    for (let week = 0; week < 3; week++) {
      const date = new Date(NOW.getTime() + week * 7 * 24 * 60 * 60 * 1000);
      ids.add(section(await buildDiscover(null, date), 'featured')?.book.id ?? 'none');
    }
    assert.ok(ids.size >= 2);
  });

  it('featured prefers recent covered books, with a related book from the same genre', async () => {
    const pub = await createPublisher('Pub');
    const old = await createBook(pub);
    const fresh = await createBook(pub);
    const sibling = await createBook(pub);
    await set(old, { cover_image_url: COVER, published_at: '2020-01-01', genre: 'Poetry' });
    await set(fresh, { cover_image_url: COVER, published_at: '2026-11-01', genre: 'Poetry' });
    await set(sibling, { cover_image_url: COVER, published_at: '2021-01-01', genre: 'Poetry' });
    const res = await buildDiscover(null, NOW);
    const featured = section(res, 'featured');
    assert.equal(featured?.book.id, fresh);
    assert.notEqual(featured?.related?.id, fresh);
    assert.equal(featured?.related?.genre, 'Poetry');
  });

  it('featured ignores a future-dated book while an older recent one exists', async () => {
    const pub = await createPublisher('Pub');
    const current = await createBook(pub);
    const future = await createBook(pub);
    await set(current, { cover_image_url: COVER, published_at: '2026-11-01' });
    await set(future, { cover_image_url: COVER, published_at: '2027-03-01' });
    for (let week = 0; week < 4; week++) {
      const date = new Date(NOW.getTime() + week * 7 * 24 * 60 * 60 * 1000);
      assert.equal(section(await buildDiscover(null, date), 'featured')?.book?.id, current);
    }
  });

  it('most_read ranks by paid, unrefunded sales in the last 30 days', async () => {
    const pub = await createPublisher('Pub');
    const top = await createBook(pub);
    const second = await createBook(pub);
    const refunded = await createBook(pub);
    const buyer = await createUser();
    const other = await createUser();
    await buy(api, buyer.token, [second]);
    await buy(api, buyer.token, [top]);
    await buy(api, other.token, [top]);
    // Paid, but refunded: never counts.
    const refundedTx = await buy(api, other.token, [refunded]);
    await pool.query(`UPDATE transaction_items SET refunded_at = now() WHERE transaction_id = $1`, [
      refundedTx,
    ]);
    // `second` also has a sale older than 30 days, which is ignored.
    const oldTx = await buy(api, other.token, [second]);
    await pool.query(`UPDATE transactions SET paid_at = now() - interval '40 days' WHERE id = $1`, [
      oldTx,
    ]);
    // A pending checkout never counts.
    const pending = await createBook(pub);
    await api('POST', '/checkout-sessions', { token: buyer.token, body: { bookIds: [pending] } });

    const res = await buildDiscover(null, new Date());
    const mostRead = section(res, 'most_read');
    assert.deepEqual(
      mostRead?.books.map((b) => b.id),
      [top, second],
    );
    assert.ok(typeof mostRead?.since === 'string');
  });

  it('most_read ignores sales older than 30 days entirely', async () => {
    const pub = await createPublisher('Pub');
    const book = await createBook(pub);
    const buyer = await createUser();
    const tx = await buy(api, buyer.token, [book]);
    await pool.query(`UPDATE transactions SET paid_at = now() - interval '40 days' WHERE id = $1`, [
      tx,
    ]);
    const res = await buildDiscover(null, new Date());
    assert.equal(section(res, 'most_read'), undefined);
  });

  it('continue_reading appears only for a signed-in reader with progress', async () => {
    const pub = await createPublisher('Pub');
    const reading = await createBook(pub);
    const untouched = await createBook(pub);
    const user = await createUser();
    await grantBook(user.id, reading);
    await grantBook(user.id, untouched);
    await pool.query(
      `UPDATE user_libraries SET last_read_at = now(),
              reading_progress = '{"percent": 42, "chapterTitle": "Kapitulli 3"}'
        WHERE user_id = $1 AND book_id = $2`,
      [user.id, reading],
    );

    const guest = await buildDiscover(null, NOW);
    assert.equal(section(guest, 'continue_reading'), undefined);
    const signedIn = await buildDiscover(user.id, NOW);
    const cr = section(signedIn, 'continue_reading');
    assert.equal(cr?.items.length, 1);
    assert.equal(cr?.items[0].book.id, reading);
    assert.equal(cr?.items[0].percent, 42);
    assert.equal(cr?.items[0].chapterTitle, 'Kapitulli 3');
    const empty = await buildDiscover((await createUser()).id, NOW);
    assert.equal(section(empty, 'continue_reading'), undefined);
  });

  it('omits empty sections and keeps the documented order', async () => {
    const empty = await buildDiscover(null, NOW);
    assert.deepEqual(empty.sections, []);
    assert.equal(empty.issue.bookCount, 0);

    const pub = await createPublisher('Pub');
    for (let i = 0; i < 6; i++) {
      await set(await createBook(pub), {
        cover_image_url: COVER,
        published_at: `2026-11-0${i + 1}`,
        genre: 'Fiction',
      });
    }
    const buyer = await createUser();
    await buy(api, buyer.token, [await createBook(pub)]);
    const user = await createUser();
    const first = await createBook(pub);
    await grantBook(user.id, first);
    await pool.query(`UPDATE user_libraries SET last_read_at = now() WHERE book_id = $1`, [first]);

    const res = await buildDiscover(user.id, new Date());
    assert.deepEqual(
      res.sections.map((s) => s.type),
      [
        'featured',
        'strip',
        'continue_reading',
        'new_releases',
        'most_read',
        'genres',
        'publisher_spotlight',
        'interlude',
      ],
    );
    assert.equal(res.issue.date, new Date().toISOString().slice(0, 10));
    assert.equal(res.issue.publisherCount, 1);
    const strip = section(res, 'strip');
    const ids = strip?.items.map((i) => i.book.id) ?? [];
    assert.ok(ids.length > 1);
    assert.equal(new Set(ids).size, ids.length);
    const releases = section(res, 'new_releases');
    assert.ok(releases);
    assert.ok(releases.books.length <= 4);
    assert.notEqual(releases.lead.id, section(res, 'featured')?.book.id);
  });

  it('excludes audiobooks and unavailable books everywhere', async () => {
    const pub = await createPublisher('Pub');
    const audio = await createBook(pub);
    await set(audio, {
      media_type: 'audiobook',
      cover_image_url: COVER,
      published_at: '2026-11-10',
    });
    const draft = await createBook(pub, { available: false });
    await set(draft, { cover_image_url: COVER, published_at: '2026-11-10' });
    const ok = await createBook(pub);
    await set(ok, { cover_image_url: COVER, published_at: '2026-11-10' });

    const res = await buildDiscover(null, NOW);
    const text = JSON.stringify(res);
    assert.ok(!text.includes(audio));
    assert.ok(!text.includes(draft));
    assert.equal(res.issue.bookCount, 1);
    assert.equal(section(res, 'genres')?.genres[0].bookCount, 1);
  });

  it('GET /discover marks owned books for the signed-in reader', async () => {
    const pub = await createPublisher('Pub');
    const book = await createBook(pub);
    await set(book, { cover_image_url: COVER, published_at: new Date().toISOString() });
    const user = await createUser();
    await grantBook(user.id, book);

    const guest = await api('GET', '/discover');
    assert.equal(guest.status, 200);
    assert.equal(Object.hasOwn(section(guest.body, 'featured')?.book ?? {}, 'owned'), false);
    assert.ok(section(guest.body, 'featured'));
    const res = await api('GET', '/discover', { token: user.token });
    assert.equal(res.status, 200);
    assert.equal(section(res.body, 'featured')?.book.owned, true);
  });
});
