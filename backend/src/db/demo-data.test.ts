import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDemoPlan, DEMO_COUNTRIES, DEMO_SEED } from './demo-data';

const NOW = new Date('2026-11-16T09:30:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Real Albanian publishers: none of their names may appear in the invented content. */
const REAL_PUBLISHERS = [
  'Onufri',
  'Toena',
  'Dudaj',
  'Botimet Dudaj',
  'Pegi',
  'Fan Noli',
  'Ombra GVG',
  'IDK',
  'Botimet IDK',
  'Dituria',
  'Albas',
  'Ideart',
  'Mësonjëtorja',
  'Zenit',
  'Skanderbeg Books',
  'UET',
  'Omsca',
  '8 Nëntori',
  'Naimi',
];
/** Real authors whose names must not be used for invented ones. */
const REAL_AUTHORS = [
  'Kadare',
  'Agolli',
  'Kuteli',
  'Noli',
  'Mustafaj',
  'Frashëri',
  'Spahiu',
  'Koliqi',
  'Migjeni',
  'Fishta',
  'Asllani',
  'Podrimja',
  'Konica',
  'Camaj',
  'Poradeci',
];
/** Real titles that the invented ones must not reuse. */
const REAL_TITLES = [
  'Kronikë në gur',
  'Pallati i ëndrrave',
  'Dimri i vetmisë së madhe',
  'Gjenerali i ushtrisë së vdekur',
  'Ura me tri harqe',
  'Prilli i thyer',
  'Kështjella',
  'Lumi i vdekur',
];

/** Lower case, with diacritics and everything but letters and digits removed. */
const squash = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const plan = buildDemoPlan(DEMO_SEED, NOW);

describe('buildDemoPlan', () => {
  it('is deterministic: the same seed gives a deep-equal plan', () => {
    assert.deepEqual(buildDemoPlan(DEMO_SEED, NOW), plan);
  });

  it('changes with the seed', () => {
    assert.notDeepEqual(buildDemoPlan(DEMO_SEED + 1, NOW).orders, plan.orders);
  });

  it('has 3 to 4 publishers with 15 to 20 books each', () => {
    assert.ok(plan.publishers.length >= 3 && plan.publishers.length <= 4);
    for (const publisher of plan.publishers) {
      const books = plan.books.filter((book) => book.publisherId === publisher.id);
      assert.ok(books.length >= 15 && books.length <= 20, `${publisher.name}: ${books.length}`);
    }
  });

  it('uses fixed, unique ids', () => {
    const ids = [
      ...plan.publishers.map((p) => p.id),
      ...plan.books.map((b) => b.id),
      ...plan.readers.map((r) => r.id),
    ];
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids)
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('has about 40 readers with unique emails', () => {
    assert.equal(plan.readers.length, 40);
    assert.equal(new Set(plan.readers.map((r) => r.email)).size, 40);
  });

  it('draws every country from the weighted list', () => {
    const allowed = new Set<string>(DEMO_COUNTRIES.map((c) => c.code));
    assert.deepEqual(
      DEMO_COUNTRIES.map((c) => c.code),
      ['AL', 'XK', 'MK', 'IT', 'DE', 'CH', 'ME', 'GR', 'US'],
    );
    for (const order of plan.orders) assert.ok(allowed.has(order.countryCode), order.countryCode);
    for (const reader of plan.readers) assert.ok(allowed.has(reader.countryCode));
  });

  it('orders only books that are on sale, once per reader, and the same country per reader', () => {
    const sellable = new Set(
      plan.books
        .filter((b) => b.status === 'published' || b.status === 'archived')
        .map((b) => b.id),
    );
    const owned = new Set<string>();
    const countryOf = new Map(plan.readers.map((r) => [r.id, r.countryCode]));
    for (const order of plan.orders) {
      assert.equal(order.countryCode, countryOf.get(order.readerId));
      assert.ok(order.bookIds.length >= 1 && order.bookIds.length <= 3);
      for (const bookId of order.bookIds) {
        assert.ok(sellable.has(bookId));
        const key = `${order.readerId}:${bookId}`;
        assert.ok(!owned.has(key), 'a reader buys a book once');
        owned.add(key);
      }
    }
  });

  it('refunds about 3% of orders in full and exactly one in part', () => {
    const full = plan.orders.filter((o) => o.refund?.kind === 'full').length;
    const partial = plan.orders.filter((o) => o.refund?.kind === 'partial');
    assert.equal(partial.length, 1);
    const share = full / plan.orders.length;
    assert.ok(share > 0.02 && share < 0.045, `full refund share ${share}`);

    const [order] = partial;
    const refund = order.refund;
    assert.ok(refund && refund.kind === 'partial');
    assert.equal(order.bookIds.length, 1);
    const book = plan.books.find((b) => b.id === order.bookIds[0]);
    assert.ok(book);
    assert.ok(refund.amountCents > 0 && refund.amountCents < book.priceCents);
  });

  it('refunds after the sale and never in the future', () => {
    for (const order of plan.orders) {
      if (!order.refund) continue;
      assert.ok(order.refund.at > order.paidAt);
      assert.ok(order.refund.at <= NOW);
    }
  });

  it('dates every order within the last 6 months', () => {
    const earliest = NOW.getTime() - 183 * DAY_MS;
    for (const order of plan.orders) {
      assert.ok(order.paidAt.getTime() >= earliest, order.paidAt.toISOString());
      assert.ok(order.paidAt <= NOW, order.paidAt.toISOString());
    }
  });

  it('has a rising trend: more sales in the last month than in the first', () => {
    const inLast = plan.orders.filter((o) => o.paidAt.getTime() > NOW.getTime() - 30 * DAY_MS);
    const inFirst = plan.orders.filter(
      (o) =>
        o.paidAt.getTime() >= NOW.getTime() - 183 * DAY_MS &&
        o.paidAt.getTime() < NOW.getTime() - 153 * DAY_MS,
    );
    assert.ok(inFirst.length > 0);
    assert.ok(inLast.length > inFirst.length, `${inLast.length} vs ${inFirst.length}`);
  });

  it('has a few multi-book orders', () => {
    const multi = plan.orders.filter((o) => o.bookIds.length > 1).length;
    assert.ok(multi >= 10, `${multi}`);
  });

  it('keeps prices between 3.99 and 14.99 and genres to the five named ones', () => {
    const genres = new Set(['Fiction', 'Poetry', 'History', 'Children', 'Essays']);
    for (const book of plan.books) {
      assert.ok(book.priceCents >= 399 && book.priceCents <= 1499, `${book.priceCents}`);
      assert.ok(genres.has(book.genre), book.genre);
      assert.ok(['sq', 'en'].includes(book.language));
    }
    const sq = plan.books.filter((b) => b.language === 'sq').length;
    assert.ok(sq > plan.books.length / 2 && sq < plan.books.length);
  });

  it('mixes statuses: published, drafts, ready, one archived, one rejected upload', () => {
    const count = (status: string) => plan.books.filter((b) => b.status === status).length;
    assert.ok(count('published') > count('draft'));
    assert.ok(count('draft') >= 2);
    assert.ok(count('ready') >= 1 && count('ready') <= 3);
    assert.equal(count('archived'), 1);
    assert.equal(count('rejected'), 1);
  });

  it('gives each publisher a rate that starts before its earliest sale, one a future rate', () => {
    for (const publisher of plan.publishers) {
      const ids = new Set(
        plan.books.filter((b) => b.publisherId === publisher.id).map((b) => b.id),
      );
      const sales = plan.orders
        .filter((o) => o.bookIds.some((id) => ids.has(id)))
        .map((o) => o.paidAt.getTime());
      assert.ok(publisher.rate.effectiveFrom.getTime() < Math.min(...sales));
      assert.ok(publisher.rate.rateBps > 0);
      if (publisher.futureRate) assert.ok(publisher.futureRate.effectiveFrom > NOW);
    }
    assert.equal(plan.publishers.filter((p) => p.futureRate).length, 1);
    assert.ok(new Set(plan.publishers.map((p) => p.rate.rateBps)).size > 1);
  });

  it('puts a book on sale only after it was published', () => {
    const publishedAt = new Map(plan.books.map((b) => [b.id, b.publishedAt]));
    for (const order of plan.orders) {
      for (const bookId of order.bookIds) {
        const at = publishedAt.get(bookId);
        assert.ok(at && at <= order.paidAt);
      }
    }
  });

  it('has unique titles and ISBNs', () => {
    assert.equal(new Set(plan.books.map((b) => b.title)).size, plan.books.length);
    assert.equal(new Set(plan.books.map((b) => b.isbn13)).size, plan.books.length);
    for (const book of plan.books) assert.match(book.isbn13, /^[0-9]{13}$/);
  });

  it('uses no real publisher, author or title (denylist)', () => {
    // Compared squashed, so spaces, punctuation and diacritics cannot hide a match.
    const denied = (value: string, list: string[]) =>
      list.some((entry) => squash(value).includes(squash(entry)));
    for (const publisher of plan.publishers) {
      assert.ok(!denied(publisher.name, REAL_PUBLISHERS), publisher.name);
      assert.ok(!denied(publisher.contactEmail, REAL_PUBLISHERS), publisher.contactEmail);
      assert.ok(!denied(publisher.loginEmail, REAL_PUBLISHERS), publisher.loginEmail);
      assert.ok(!denied(publisher.loginName, REAL_PUBLISHERS), publisher.loginName);
    }
    for (const book of plan.books) {
      assert.ok(!denied(book.author, REAL_AUTHORS), book.author);
      assert.ok(!denied(book.title, REAL_PUBLISHERS), book.title);
      assert.ok(!denied(book.title, REAL_TITLES), book.title);
    }
    for (const reader of plan.readers) {
      assert.ok(!denied(reader.displayName, REAL_AUTHORS), reader.displayName);
    }
  });

  it('archives its one archived book 60 to 120 days after launch, before now, after a sale', () => {
    const archived = plan.books.filter((b) => b.archivedAt);
    assert.equal(archived.length, 1);
    const [book] = archived;
    assert.ok(book.publishedAt && book.archivedAt);
    assert.ok(book.archivedAt > book.publishedAt);
    assert.ok(book.archivedAt < NOW);
    const days = (book.archivedAt.getTime() - book.publishedAt.getTime()) / DAY_MS;
    assert.ok(days > 0 && days <= 120.5, `${days} days`);
    const sales = plan.orders.filter((o) => o.bookIds.includes(book.id));
    assert.ok(sales.length >= 1);
    for (const order of sales) assert.ok(order.paidAt < (book.archivedAt as Date));
  });

  it('keeps ISBNs valid: 13 digits with a correct check digit', () => {
    for (const { isbn13 } of plan.books) {
      const sum = [...isbn13.slice(0, 12)].reduce(
        (acc, digit, i) => acc + Number(digit) * (i % 2 === 0 ? 1 : 3),
        0,
      );
      assert.equal(Number(isbn13[12]), (10 - (sum % 10)) % 10, isbn13);
    }
  });

  it('writes sample text for every ingested book', () => {
    for (const book of plan.books) {
      if (book.status === 'draft' || book.status === 'rejected') continue;
      assert.ok(book.chapters.length >= 2);
      for (const chapter of book.chapters) {
        assert.ok(chapter.paragraphs.length >= 2);
        for (const text of [chapter.title, ...chapter.paragraphs]) {
          assert.doesNotMatch(text, /[<>&]/, 'must be safe to place in the EPUB XML unescaped');
        }
      }
    }
  });
});
