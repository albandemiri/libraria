import { pool } from '../db/pool';
import { buildBookFilter } from './books-query';

export interface PublisherSummary {
  id: string;
  name: string;
  country: string | null;
  bookCount: number;
  /** Genres of the publisher's storefront books, most books first. */
  genres: string[];
  newestYear: number | null;
}

interface SummaryRow {
  id: string;
  name: string;
  country: string | null;
  book_count: string;
  genres: string[];
  newest_year: number | null;
}

/**
 * Public summaries (sorted by name) of publishers that have at least one
 * storefront book; every figure counts storefront books only. `ids` narrows the
 * result. Never selects contact or bank fields.
 */
export async function publisherSummaries(ids?: string[]): Promise<PublisherSummary[]> {
  if (ids && ids.length === 0) return [];
  const visible = buildBookFilter({}, null, 1);
  const params = [...visible.params];
  let idFilter = '';
  if (ids) {
    params.push(ids);
    idFilter = ` AND p.id = ANY($${params.length}::uuid[])`;
  }

  const { rows } = await pool.query<SummaryRow>(
    `WITH per_genre AS (
       SELECT p.id AS publisher_id, b.genre, COUNT(*) AS n,
              MAX(EXTRACT(YEAR FROM b.published_at))::int AS newest_year
         FROM books b JOIN publishers p ON p.id = b.publisher_id
        WHERE ${visible.where}${idFilter}
        GROUP BY p.id, b.genre)
     SELECT p.id, p.name, p.country::text AS country,
            SUM(g.n) AS book_count,
            ARRAY_AGG(g.genre ORDER BY g.n DESC, g.genre) AS genres,
            MAX(g.newest_year) AS newest_year
       FROM publishers p JOIN per_genre g ON g.publisher_id = p.id
      GROUP BY p.id, p.name, p.country
      ORDER BY p.name ASC, p.id ASC`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    country: r.country,
    bookCount: Number(r.book_count),
    genres: r.genres,
    newestYear: r.newest_year,
  }));
}
