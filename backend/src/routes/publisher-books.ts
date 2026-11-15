import type { Pool } from 'pg';
import { pool } from '../db/pool';

/**
 * `has_asset` / `file_size_bytes`: whether the book has a ready current asset,
 * and that asset's original size. `ref` is the books table name or alias.
 */
export function assetColumns(ref: string): string {
  const current = `(SELECT ba.original_size_bytes FROM book_assets ba
                     WHERE ba.id = ${ref}.current_asset_id AND ba.state = 'ready')`;
  return `${current} AS file_size_bytes,
            EXISTS (SELECT 1 FROM book_assets ba
                     WHERE ba.id = ${ref}.current_asset_id AND ba.state = 'ready') AS has_asset`;
}

/** Asset states that are still being worked on by the ingestion pipeline. */
const IN_PROGRESS_ASSET_STATES = "('uploaded', 'validating', 'scanning', 'encrypting', 'storing')";

/** Whether `ref` (a books alias) has any sale, entitlement or library entry: the rows RESTRICT protects. */
export function hasSalesSql(ref: string): string {
  return `(EXISTS (SELECT 1 FROM transaction_items ti WHERE ti.book_id = ${ref}.id)
        OR EXISTS (SELECT 1 FROM entitlements en WHERE en.book_id = ${ref}.id)
        OR EXISTS (SELECT 1 FROM user_libraries ul WHERE ul.book_id = ${ref}.id))`;
}

/** Whether an asset of `ref` is still in the ingestion pipeline. */
export function hasProcessingAssetSql(ref: string): string {
  return `EXISTS (SELECT 1 FROM book_assets dp
                   WHERE dp.book_id = ${ref}.id AND dp.state IN ${IN_PROGRESS_ASSET_STATES})`;
}

/** The server's answer to "may this book be permanently deleted?", the same rules the DELETE route enforces. */
export const CAN_DELETE_SQL = `(b.withdrawn_at IS NULL
  AND NOT b.is_available
  AND NOT ${hasProcessingAssetSql('b')}
  AND NOT ${hasSalesSql('b')})`;

/**
 * Derived publisher-facing status of a book, in precedence order: withdrawn,
 * archived, published, processing (any asset still in the pipeline), ready (a ready
 * current asset), else draft.
 */
export const BOOK_STATUS_SQL = `(CASE
  WHEN b.withdrawn_at IS NOT NULL THEN 'withdrawn'
  WHEN b.archived_at IS NOT NULL THEN 'archived'
  WHEN b.is_available THEN 'published'
  WHEN EXISTS (SELECT 1 FROM book_assets pa
                WHERE pa.book_id = b.id AND pa.state IN ${IN_PROGRESS_ASSET_STATES}) THEN 'processing'
  WHEN EXISTS (SELECT 1 FROM book_assets ra
                WHERE ra.id = b.current_asset_id AND ra.state = 'ready') THEN 'ready'
  ELSE 'draft'
END)`;

export interface PublisherBookRow {
  status: 'draft' | 'processing' | 'ready' | 'published' | 'archived' | 'withdrawn';
  can_delete: boolean;
  latest_asset_state: string | null;
  latest_asset_reason_code: string | null;
  id: string;
  publisher_id: string;
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  price_cents: number;
  currency: string;
  cover_image_url: string | null;
  cover_thumb_key: string | null;
  cover_version: number;
  published_at: Date | null;
  is_available: boolean;
  media_type: 'ebook' | 'audiobook';
  duration_seconds: number | null;
  /** original_size_bytes of the current asset; null without a ready one. */
  file_size_bytes: string | null;
  has_asset: boolean;
  sales_count: number;
  total_revenue_cents: number;
  /** Publisher's share after refund reversals. */
  earnings_cents?: string;
  created_at: Date;
  updated_at: Date;
  total_count?: string;
}

/** The thumbnail only exists for an uploaded cover; the version busts caches on change. */
export function coverThumbUrl(id: string, thumbKey: string | null, version: number): string | null {
  return thumbKey ? `/api/v1/books/${id}/cover?size=thumb&v=${version}` : null;
}

export function formatPublisherBook(row: PublisherBookRow) {
  return {
    id: row.id,
    publisherId: row.publisher_id,
    title: row.title,
    author: row.author,
    isbn13: row.isbn13,
    description: row.description,
    genre: row.genre,
    language: row.language,
    price: {
      amountCents: row.price_cents,
      currency: row.currency,
    },
    coverImageUrl: row.cover_image_url,
    coverThumbUrl: coverThumbUrl(row.id, row.cover_thumb_key, row.cover_version),
    publishedAt: row.published_at,
    isAvailable: row.is_available,
    mediaType: row.media_type,
    durationSeconds: row.duration_seconds,
    status: row.status,
    canDelete: row.can_delete,
    latestAsset: row.latest_asset_state
      ? { state: row.latest_asset_state, reasonCode: row.latest_asset_reason_code }
      : null,
    hasAsset: row.has_asset,
    fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
    metrics: {
      salesCount: Number(row.sales_count ?? 0),
      totalRevenueCents: Number(row.total_revenue_cents ?? 0),
      earningsCents: Number(row.earnings_cents ?? 0),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The one column list and the joins behind every publisher book payload, so the
 * list, the single book and every write response share a shape. The books table
 * is aliased `b`; `s` is the sales view and `la` the latest asset.
 */
export const BOOK_SELECT_COLUMNS = `b.id,
            b.publisher_id,
            b.title,
            b.author,
            b.isbn13,
            b.description,
            b.genre,
            b.language,
            b.price_cents,
            b.currency,
            b.cover_image_url,
            b.cover_thumb_key,
            b.cover_version,
            b.published_at,
            b.is_available,
            b.media_type,
            b.duration_seconds,
            ${BOOK_STATUS_SQL} AS status,
            ${CAN_DELETE_SQL} AS can_delete,
            la.state AS latest_asset_state,
            la.reason_code AS latest_asset_reason_code,
            ${assetColumns('b')},
            b.created_at,
            b.updated_at,
            COALESCE(s.sales_count, 0) AS sales_count,
            COALESCE(s.total_revenue, 0) AS total_revenue_cents,
            COALESCE(s.earnings, 0)::bigint AS earnings_cents`;

export const BOOK_JOINS = `FROM books b
       LEFT JOIN (SELECT book_id, sales_count, gross_revenue_cents AS total_revenue,
                         publisher_earnings_cents AS earnings
                    FROM book_sales) s ON s.book_id = b.id
       LEFT JOIN LATERAL (SELECT state, reason_code FROM book_assets
                           WHERE book_id = b.id
                           ORDER BY version DESC
                           LIMIT 1) la ON TRUE`;

/** One book in the publisher shape, within the caller's scope (null scope: any publisher). */
export async function loadPublisherBook(
  id: string,
  scope: string | null,
  db: Pick<Pool, 'query'> = pool,
): Promise<PublisherBookRow | undefined> {
  const result = await db.query<PublisherBookRow>(
    `SELECT ${BOOK_SELECT_COLUMNS}
       ${BOOK_JOINS}
      WHERE b.id = $1
        AND ($2::uuid IS NULL OR b.publisher_id = $2)`,
    [id, scope],
  );
  return result.rows[0];
}
