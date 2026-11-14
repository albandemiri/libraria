/**
 * The single definition of what counts as a sale and how each money figure is
 * derived (spec "Reporting rules"). Every report wraps salesBase() as a CTE
 * and aggregates with METRICS_SQL, so totals cannot disagree across pages.
 */

export type ItemStatus = 'paid' | 'partially_refunded' | 'refunded' | 'disputed';

export interface ReportFilters {
  publisherId: string;
  /** Inclusive UTC date, YYYY-MM-DD. */
  from: string;
  /** Exclusive UTC date, YYYY-MM-DD. */
  to: string;
  bookId?: string;
  /** undefined: any country; null: unknown country; string: that country. */
  country?: string | null;
  status?: ItemStatus;
}

export function salesBase(filters: ReportFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [filters.publisherId, filters.from, filters.to];
  const outer: string[] = [];
  if (filters.bookId !== undefined) {
    params.push(filters.bookId);
    outer.push(`book_id = $${params.length}`);
  }
  if (filters.country === null) {
    outer.push('customer_country IS NULL');
  } else if (filters.country !== undefined) {
    params.push(filters.country);
    outer.push(`customer_country = $${params.length}`);
  }
  if (filters.status !== undefined) {
    params.push(filters.status);
    outer.push(`item_status = $${params.length}`);
  }

  const sql = `SELECT * FROM (
    SELECT ti.id AS item_id,
           t.id AS transaction_id,
           t.paid_at,
           ti.book_id,
           ti.title,
           t.customer_country,
           CASE WHEN ti.refunded_at IS NOT NULL THEN 'refunded'
                WHEN ti.refunded_cents > 0 THEN 'partially_refunded'
                WHEN t.status = 'disputed' THEN 'disputed'
                ELSE 'paid' END AS item_status,
           CASE WHEN ti.commission_rate_bps IS NULL THEN 'no_rate'
                WHEN ti.platform_commission_cents IS NULL THEN 'pending'
                ELSE 'done' END AS split,
           ti.provider_fee_cents::bigint AS raw_fee_cents,
           ti.commission_rate_bps AS commission_rate_bps,
           ti.unit_price_cents::bigint AS gross_cents,
           ti.refunded_cents::bigint AS refunds_cents,
           COALESCE(ti.tax_cents, 0)::bigint AS tax_cents,
           COALESCE(ti.provider_fee_cents, 0)::bigint AS fee_cents,
           (ti.unit_price_cents - COALESCE(ti.tax_cents, 0)
              - COALESCE(ti.provider_fee_cents, 0))::bigint AS net_cents,
           COALESCE(ti.platform_commission_cents, 0)::bigint AS commission_cents,
           COALESCE(ti.platform_commission_reversed_cents, 0)::bigint AS commission_reversed_cents,
           COALESCE(ti.publisher_earnings_cents, 0)::bigint AS earnings_cents,
           COALESCE(ti.publisher_earnings_reversed_cents, 0)::bigint AS earnings_reversed_cents
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti.transaction_id
     WHERE ti.publisher_id = $1
       AND t.status IN ('paid', 'partially_refunded', 'disputed', 'refunded')
       AND t.paid_at >= ($2::date)::timestamp AT TIME ZONE 'UTC'
       AND t.paid_at < ($3::date)::timestamp AT TIME ZONE 'UTC'
  ) base${outer.length ? ` WHERE ${outer.join(' AND ')}` : ''}`;
  return { sql, params };
}

/** Aggregates over the base CTE aliased `s`; column names map to Metrics. */
export const METRICS_SQL = `
  COALESCE(SUM(s.gross_cents), 0)::bigint AS gross_cents,
  COALESCE(SUM(s.refunds_cents), 0)::bigint AS refunds_cents,
  COALESCE(SUM(s.tax_cents), 0)::bigint AS tax_cents,
  COALESCE(SUM(s.fee_cents), 0)::bigint AS fee_cents,
  COALESCE(SUM(s.net_cents), 0)::bigint AS net_cents,
  COALESCE(SUM(s.commission_cents), 0)::bigint AS commission_at_sale_cents,
  COALESCE(SUM(s.commission_reversed_cents), 0)::bigint AS commission_reversed_cents,
  COALESCE(SUM(s.commission_cents - s.commission_reversed_cents), 0)::bigint AS commission_cents,
  COALESCE(SUM(s.net_cents) FILTER (WHERE s.split <> 'done'), 0)::bigint AS unsplit_cents,
  COALESCE(SUM(s.earnings_cents), 0)::bigint AS earnings_at_sale_cents,
  COALESCE(SUM(s.earnings_reversed_cents), 0)::bigint AS earnings_reversed_cents,
  COALESCE(SUM(s.earnings_cents - s.earnings_reversed_cents), 0)::bigint AS earnings_cents,
  COUNT(s.item_id) FILTER (WHERE s.item_status <> 'refunded')::bigint AS copies,
  COUNT(s.item_id) FILTER (WHERE s.item_status = 'refunded')::bigint AS refunded_copies`;
