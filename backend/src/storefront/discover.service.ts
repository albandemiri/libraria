import { MONEY_TAKEN_STATES } from '../commerce/transaction-state';
import { pool } from '../db/pool';
import { buildBookFilter, ownedSql } from './books-query';
import { type PublisherSummary, publisherSummaries } from './publishers';
import { STORE_BOOK_COLUMNS, type StoreBook, type StoreBookRow, toStoreBook } from './store-book';

export type DiscoverSection =
  | { type: 'featured'; book: StoreBook; related: StoreBook | null }
  | {
      type: 'strip';
      items: Array<{ label: 'new' | 'top_month' | 'genre' | 'publisher'; book: StoreBook }>;
    }
  | {
      type: 'continue_reading';
      items: Array<{
        book: StoreBook;
        percent: number | null;
        chapterTitle: string | null;
        lastReadAt: string;
      }>;
    }
  | { type: 'new_releases'; lead: StoreBook; books: StoreBook[] }
  | { type: 'most_read'; since: string; books: StoreBook[] }
  | {
      type: 'genres';
      genres: Array<{ genre: string; bookCount: number; coverBookIds: string[] }>;
    }
  | { type: 'publisher_spotlight'; publisher: PublisherSummary; books: StoreBook[] }
  | { type: 'interlude'; genre: string; bookCount: number; books: StoreBook[] };

export interface DiscoverResponse {
  issue: {
    isoYear: number;
    isoWeek: number;
    date: string;
    bookCount: number;
    publisherCount: number;
  };
  sections: DiscoverSection[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO-8601 year and week of a date, evaluated in UTC. */
export function isoWeek(date: Date): { isoYear: number; isoWeek: number } {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Move to the Thursday of this week: it decides which year the week belongs to.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return {
    isoYear: d.getUTCFullYear(),
    isoWeek: Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7),
  };
}

/**
 * Stable within an ISO week, rotating between weeks. Sorts a copy by id (or by
 * the string itself), so the input order never matters and is never mutated.
 */
export function weeklyPick<T extends { id: string } | string>(
  items: T[],
  now: Date,
): T | undefined {
  if (items.length === 0) return undefined;
  const key = (item: T): string => (typeof item === 'string' ? item : item.id);
  const sorted = [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const { isoYear, isoWeek: week } = isoWeek(now);
  return sorted[(isoYear * 53 + week) % sorted.length];
}

interface LightBook {
  id: string;
  genre: string;
  publisherId: string;
  publishedAt: Date | null;
  hasCover: boolean;
}

const NEWEST = 'b.published_at DESC NULLS LAST, b.created_at DESC, b.id ASC';

/** Every storefront book in newest-first order, with only what the rules need. */
async function loadLightBooks(): Promise<LightBook[]> {
  const visible = buildBookFilter({}, null, 1);
  const { rows } = await pool.query<{
    id: string;
    genre: string;
    publisher_id: string;
    published_at: Date | null;
    has_cover: boolean;
  }>(
    `SELECT b.id, b.genre, b.publisher_id, b.published_at,
            b.cover_image_url IS NOT NULL AS has_cover
       FROM books b JOIN publishers p ON p.id = b.publisher_id
      WHERE ${visible.where}
      ORDER BY ${NEWEST}`,
    visible.params,
  );
  return rows.map((r) => ({
    id: r.id,
    genre: r.genre,
    publisherId: r.publisher_id,
    publishedAt: r.published_at,
    hasCover: r.has_cover,
  }));
}

/** Storefront books sold (paid, unrefunded items) in the window, best sellers first. */
async function loadMostReadIds(since: Date, now: Date): Promise<string[]> {
  const visible = buildBookFilter({}, null, 4);
  const { rows } = await pool.query<{ id: string }>(
    `SELECT b.id
       FROM transaction_items ti
       JOIN transactions t ON t.id = ti.transaction_id
       JOIN books b ON b.id = ti.book_id
       JOIN publishers p ON p.id = b.publisher_id
      WHERE ${visible.where}
        AND ti.refunded_at IS NULL
        AND t.status::text = ANY($1::text[])
        AND t.paid_at >= $2 AND t.paid_at <= $3
      GROUP BY b.id
      ORDER BY COUNT(*) DESC, ${NEWEST}
      LIMIT 5`,
    [MONEY_TAKEN_STATES, since, now, ...visible.params],
  );
  return rows.map((r) => r.id);
}

interface ContinueRow extends StoreBookRow {
  last_read_at: Date;
  reading_progress: { percent?: unknown; chapterTitle?: unknown } | null;
}

async function loadContinueReading(
  viewerId: string,
): Promise<Extract<DiscoverSection, { type: 'continue_reading' }> | null> {
  const visible = buildBookFilter({}, null, 2);
  const { rows } = await pool.query<ContinueRow>(
    `SELECT ${STORE_BOOK_COLUMNS}, ${ownedSql('$1')} AS owned,
            ul.last_read_at, ul.reading_progress
       FROM user_libraries ul
       JOIN books b ON b.id = ul.book_id
       JOIN publishers p ON p.id = b.publisher_id
      WHERE ul.user_id = $1 AND ul.last_read_at IS NOT NULL
        AND ${ownedSql('$1')}
        AND ${visible.where}
      ORDER BY ul.last_read_at DESC
      LIMIT 3`,
    [viewerId, ...visible.params],
  );
  if (rows.length === 0) return null;
  return {
    type: 'continue_reading',
    items: rows.map((r) => ({
      book: toStoreBook(r, viewerId),
      percent: typeof r.reading_progress?.percent === 'number' ? r.reading_progress.percent : null,
      chapterTitle:
        typeof r.reading_progress?.chapterTitle === 'string'
          ? r.reading_progress.chapterTitle
          : null,
      lastReadAt: r.last_read_at.toISOString(),
    })),
  };
}

async function hydrate(ids: string[], viewerId: string | null): Promise<Map<string, StoreBook>> {
  if (ids.length === 0) return new Map();
  const visible = buildBookFilter({}, viewerId, 3);
  const { rows } = await pool.query<StoreBookRow>(
    `SELECT ${STORE_BOOK_COLUMNS}, ${ownedSql('$1')} AS owned
       FROM books b JOIN publishers p ON p.id = b.publisher_id
      WHERE ${visible.where} AND b.id = ANY($2::uuid[])`,
    [viewerId, ids, ...visible.params],
  );
  return new Map(rows.map((r) => [r.id, toStoreBook(r, viewerId)]));
}

export async function buildDiscover(viewerId: string | null, now: Date): Promise<DiscoverResponse> {
  const since = new Date(now.getTime() - 30 * DAY_MS);
  const [books, mostReadIds, summaries, continueReading] = await Promise.all([
    loadLightBooks(),
    loadMostReadIds(since, now),
    publisherSummaries(),
    viewerId ? loadContinueReading(viewerId) : Promise.resolve(null),
  ]);

  const week = isoWeek(now);
  const covered = books.filter((b) => b.hasCover);
  const recentCutoff = now.getTime() - 60 * DAY_MS;
  const recent = covered.filter(
    (b) =>
      b.publishedAt &&
      b.publishedAt.getTime() >= recentCutoff &&
      b.publishedAt.getTime() <= now.getTime(),
  );
  const featured = weeklyPick(recent.length > 0 ? recent : covered, now);
  const related = featured
    ? (covered.find((b) => b.id !== featured.id && b.genre === featured.genre) ??
      books.find((b) => b.id !== featured.id && b.publisherId === featured.publisherId) ??
      null)
    : null;

  const newest = books.filter((b) => b.id !== featured?.id);
  const newReleases = newest.slice(0, 5);

  const genreCounts = new Map<string, LightBook[]>();
  for (const b of books) genreCounts.set(b.genre, [...(genreCounts.get(b.genre) ?? []), b]);
  const genres = [...genreCounts.entries()]
    .map(([genre, list]) => ({
      genre,
      bookCount: list.length,
      coverBookIds: list
        .filter((b) => b.hasCover)
        .slice(0, 3)
        .map((b) => b.id),
    }))
    .sort((a, b) => b.bookCount - a.bookCount || a.genre.localeCompare(b.genre));

  const interludeGenre = weeklyPick(
    genres.filter((g) => g.bookCount >= 5).map((g) => g.genre),
    now,
  );
  const interludeBooks = interludeGenre ? (genreCounts.get(interludeGenre) ?? []) : [];
  const spotlight = weeklyPick(summaries, now);
  const spotlightBooks = spotlight ? books.filter((b) => b.publisherId === spotlight.id) : [];

  // The strip: one candidate per label, never repeating a book.
  const stripUsed = new Set<string>();
  const strip: Array<{ label: 'new' | 'top_month' | 'genre' | 'publisher'; id: string }> = [];
  const candidates: Array<['new' | 'top_month' | 'genre' | 'publisher', string[]]> = [
    ['new', newest.map((b) => b.id)],
    ['top_month', mostReadIds],
    ['genre', interludeBooks.map((b) => b.id)],
    ['publisher', spotlightBooks.map((b) => b.id)],
  ];
  for (const [label, ids] of candidates) {
    const id = ids.find((candidate) => !stripUsed.has(candidate));
    if (id) {
      stripUsed.add(id);
      strip.push({ label, id });
    }
  }

  const wanted = new Set<string>([
    ...(featured ? [featured.id] : []),
    ...(related ? [related.id] : []),
    ...strip.map((s) => s.id),
    ...newReleases.map((b) => b.id),
    ...mostReadIds,
    ...spotlightBooks.slice(0, 4).map((b) => b.id),
    ...interludeBooks.slice(0, 5).map((b) => b.id),
  ]);
  const byId = await hydrate([...wanted], viewerId);
  const pick = (ids: string[]): StoreBook[] =>
    ids.flatMap((id) => {
      const book = byId.get(id);
      return book ? [book] : [];
    });

  const sections: DiscoverSection[] = [];
  const featuredBook = featured ? byId.get(featured.id) : undefined;
  if (featuredBook) {
    sections.push({
      type: 'featured',
      book: featuredBook,
      related: related ? (byId.get(related.id) ?? null) : null,
    });
  }
  const stripItems = strip.flatMap((s) => {
    const book = byId.get(s.id);
    return book ? [{ label: s.label, book }] : [];
  });
  if (stripItems.length > 0) sections.push({ type: 'strip', items: stripItems });
  if (continueReading) sections.push(continueReading);
  const releases = pick(newReleases.map((b) => b.id));
  if (releases.length > 0) {
    sections.push({ type: 'new_releases', lead: releases[0], books: releases.slice(1) });
  }
  const mostRead = pick(mostReadIds);
  if (mostRead.length > 0) {
    sections.push({ type: 'most_read', since: since.toISOString(), books: mostRead });
  }
  if (genres.length > 0) sections.push({ type: 'genres', genres });
  if (spotlight && spotlightBooks.length > 0) {
    sections.push({
      type: 'publisher_spotlight',
      publisher: spotlight,
      books: pick(spotlightBooks.slice(0, 4).map((b) => b.id)),
    });
  }
  if (interludeGenre) {
    sections.push({
      type: 'interlude',
      genre: interludeGenre,
      bookCount: interludeBooks.length,
      books: pick(interludeBooks.slice(0, 5).map((b) => b.id)),
    });
  }

  return {
    issue: {
      isoYear: week.isoYear,
      isoWeek: week.isoWeek,
      date: now.toISOString().slice(0, 10),
      bookCount: books.length,
      publisherCount: summaries.length,
    },
    sections,
  };
}
