import { pool } from '../db/pool';
import type { TransactionStatus } from './transaction-state';

interface ReceiptRow {
  id: string;
  status: TransactionStatus;
  provider: string;
  currency: string;
  total_cents: string;
  checkout_url: string | null;
  created_at: Date;
  paid_at: Date | null;
  total_count: string;
  items: Array<{
    bookId: string;
    title: string;
    author: string;
    coverImageUrl: string | null;
    publisherId: string;
    publisherName: string;
    unitPriceCents: number;
    refundedCents: number;
    refunded: boolean;
  }>;
}

export function publicReceipt(row: ReceiptRow) {
  return {
    id: row.id,
    status: row.status,
    provider: row.provider,
    total: { amountCents: Number(row.total_cents), currency: row.currency.trim() },
    // Only useful while the customer still has to pay.
    checkoutUrl: row.status === 'pending' ? row.checkout_url : null,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    items: row.items.map((item) => ({
      book: {
        id: item.bookId,
        title: item.title,
        author: item.author,
        coverImageUrl: item.coverImageUrl,
        publisher: { id: item.publisherId, name: item.publisherName },
      },
      unitPriceCents: item.unitPriceCents,
      refundedCents: item.refundedCents,
      refunded: item.refunded,
    })),
  };
}

export type Receipt = ReturnType<typeof publicReceipt>;

/**
 * A user's receipts, newest first. Always scoped by user: there is no way to
 * read someone else's transaction through this function.
 */
export async function listReceipts(
  userId: string,
  options: { transactionId?: string; limit: number; offset: number },
): Promise<{ receipts: Receipt[]; total: number }> {
  const { rows } = await pool.query<ReceiptRow>(
    `SELECT t.id, t.status, t.provider, t.currency, t.total_cents, t.checkout_url,
            t.created_at, t.paid_at,
            COUNT(*) OVER() AS total_count,
            json_agg(json_build_object(
              'bookId', ti.book_id,
              'title', ti.title,
              'author', b.author,
              'coverImageUrl', b.cover_image_url,
              'publisherId', ti.publisher_id,
              'publisherName', p.name,
              'unitPriceCents', ti.unit_price_cents,
              'refundedCents', ti.refunded_cents,
              'refunded', ti.refunded_at IS NOT NULL
            ) ORDER BY ti.created_at, ti.id) AS items
       FROM transactions t
       JOIN transaction_items ti ON ti.transaction_id = t.id
       JOIN books b ON b.id = ti.book_id
       JOIN publishers p ON p.id = ti.publisher_id
      WHERE t.user_id = $1
        AND ($2::uuid IS NULL OR t.id = $2)
      GROUP BY t.id
      ORDER BY t.created_at DESC
      LIMIT $3 OFFSET $4`,
    [userId, options.transactionId ?? null, options.limit, options.offset],
  );

  return {
    receipts: rows.map(publicReceipt),
    total: rows.length > 0 ? Number(rows[0].total_count) : 0,
  };
}

export async function getReceipt(userId: string, transactionId: string): Promise<Receipt | null> {
  const { receipts } = await listReceipts(userId, { transactionId, limit: 1, offset: 0 });
  return receipts[0] ?? null;
}
