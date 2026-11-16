import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { optionalAuth } from '../middleware/auth';
import { buildBookFilter, likePattern, ownedSql } from '../storefront/books-query';
import { STORE_BOOK_COLUMNS, type StoreBookRow, toStoreBook } from '../storefront/store-book';

export const searchRouter = Router();

const suggestQuerySchema = z.object({ q: z.string().trim().min(2).max(100) });

searchRouter.get('/suggest', optionalAuth, async (req: Request, res: Response) => {
  const { q } = suggestQuerySchema.parse(req.query);
  const viewerId = req.auth?.userId ?? null;
  const pattern = likePattern(q);
  // Storefront visibility (available ebooks) is shared with every other storefront query.
  const visible = buildBookFilter({}, null, 1).where;

  // $1 pattern, $2 raw query (for match position), $3 viewer when signed in.
  const [titles, authors, publishers] = await Promise.all([
    pool.query<StoreBookRow>(
      `SELECT ${STORE_BOOK_COLUMNS},
              ${viewerId ? ownedSql('$3') : 'FALSE'} AS owned
         FROM books b
         JOIN publishers p ON p.id = b.publisher_id
         LEFT JOIN book_sales s ON s.book_id = b.id
        WHERE ${visible} AND (b.title ILIKE $1 OR b.author ILIKE $1)
        ORDER BY NULLIF(strpos(lower(b.title), lower($2)), 0) ASC NULLS LAST,
                 COALESCE(s.sales_count, 0) DESC, b.title ASC
        LIMIT 5`,
      viewerId ? [pattern, q, viewerId] : [pattern, q],
    ),
    pool.query<{ author: string; book_count: string; main_genre: string }>(
      `WITH per_genre AS (
         SELECT b.author, b.genre, COUNT(*) AS n
           FROM books b JOIN publishers p ON p.id = b.publisher_id
          WHERE ${visible} AND b.author ILIKE $1
          GROUP BY b.author, b.genre)
       SELECT author, SUM(n) AS book_count, (ARRAY_AGG(genre ORDER BY n DESC, genre))[1] AS main_genre
         FROM per_genre
        GROUP BY author
        ORDER BY NULLIF(strpos(lower(author), lower($2)), 0) ASC NULLS LAST, SUM(n) DESC, author ASC
        LIMIT 3`,
      [pattern, q],
    ),
    pool.query<{ id: string; name: string; book_count: string }>(
      `SELECT p.id, p.name, COUNT(*) AS book_count
         FROM publishers p JOIN books b ON b.publisher_id = p.id
        WHERE ${visible} AND p.name ILIKE $1
        GROUP BY p.id, p.name
        ORDER BY NULLIF(strpos(lower(p.name), lower($2)), 0) ASC NULLS LAST, COUNT(*) DESC, p.name ASC
        LIMIT 3`,
      [pattern, q],
    ),
  ]);

  res.json({
    titles: titles.rows.map((row) => toStoreBook(row, viewerId)),
    authors: authors.rows.map((r) => ({
      name: r.author,
      bookCount: Number(r.book_count),
      mainGenre: r.main_genre,
    })),
    publishers: publishers.rows.map((r) => ({
      id: r.id,
      name: r.name,
      bookCount: Number(r.book_count),
    })),
  });
});
