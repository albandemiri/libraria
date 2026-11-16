import { rateInForceSql } from '../commerce/rates';

/**
 * Storefront responses are assembled from an explicit column list, so nothing
 * about assets or keys can leak into them.
 */
export const STORE_BOOK_COLUMNS = `
  b.id,
  b.title,
  b.author,
  b.isbn13,
  b.description,
  b.genre,
  b.language,
  b.price_cents,
  b.currency,
  b.cover_image_url,
  b.published_at,
  b.media_type,
  b.duration_seconds,
  b.publisher_id,
  p.name AS publisher_name,
  ${rateInForceSql('b.publisher_id')} IS NOT NULL AS for_sale
`;

export interface StoreBookRow {
  id: string;
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  price_cents: number;
  currency: string;
  cover_image_url: string | null;
  published_at: Date | null;
  media_type: 'ebook' | 'audiobook';
  duration_seconds: number | null;
  publisher_id: string;
  publisher_name: string;
  for_sale: boolean;
  /** Computed in SQL (see `ownedSql`); meaningful only for a signed-in viewer. */
  owned?: boolean;
}

export interface StoreBook {
  id: string;
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  price: { amountCents: number; currency: string };
  coverImageUrl: string | null;
  publishedAt: Date | null;
  mediaType: 'ebook' | 'audiobook';
  durationSeconds: number | null;
  publisher: { id: string; name: string };
  forSale: boolean;
  /** Present only when the caller is signed in. */
  owned?: boolean;
}

export function toStoreBook(row: StoreBookRow, viewerId: string | null): StoreBook {
  const book: StoreBook = {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn13: row.isbn13,
    description: row.description,
    genre: row.genre,
    language: row.language,
    price: { amountCents: row.price_cents, currency: row.currency },
    coverImageUrl: row.cover_image_url,
    publishedAt: row.published_at,
    mediaType: row.media_type,
    durationSeconds: row.duration_seconds,
    publisher: { id: row.publisher_id, name: row.publisher_name },
    // False while the publisher has no commission rate in force: checkout
    // would refuse it with BOOK_NOT_FOR_SALE, so clients hide "Buy".
    forSale: row.for_sale,
  };
  if (viewerId !== null) {
    book.owned = row.owned === true;
  }
  return book;
}
