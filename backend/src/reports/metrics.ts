/** One set of sales figures, shared by every report so numbers always agree. */
export interface Metrics {
  grossCents: number;
  refundsCents: number;
  taxCents: number;
  feeCents: number;
  /** gross - tax - fee (nulls as 0). */
  netCents: number;
  commissionAtSaleCents: number;
  commissionReversedCents: number;
  commissionCents: number;
  /** Net of items whose split is not done (pending or no rate). */
  unsplitCents: number;
  earningsAtSaleCents: number;
  earningsReversedCents: number;
  earningsCents: number;
  copies: number;
  refundedCopies: number;
}

// Invariant: netCents = commissionAtSaleCents + unsplitCents + earningsAtSaleCents.

export const ZERO_METRICS: Metrics = {
  grossCents: 0,
  refundsCents: 0,
  taxCents: 0,
  feeCents: 0,
  netCents: 0,
  commissionAtSaleCents: 0,
  commissionReversedCents: 0,
  commissionCents: 0,
  unsplitCents: 0,
  earningsAtSaleCents: 0,
  earningsReversedCents: 0,
  earningsCents: 0,
  copies: 0,
  refundedCopies: 0,
};

/** Maps a row carrying the METRICS_SQL columns (bigint strings or numbers). */
export function toMetrics(row: Record<string, string | number | null>): Metrics {
  const n = (key: string) => Number(row[key] ?? 0);
  return {
    grossCents: n('gross_cents'),
    refundsCents: n('refunds_cents'),
    taxCents: n('tax_cents'),
    feeCents: n('fee_cents'),
    netCents: n('net_cents'),
    commissionAtSaleCents: n('commission_at_sale_cents'),
    commissionReversedCents: n('commission_reversed_cents'),
    commissionCents: n('commission_cents'),
    unsplitCents: n('unsplit_cents'),
    earningsAtSaleCents: n('earnings_at_sale_cents'),
    earningsReversedCents: n('earnings_reversed_cents'),
    earningsCents: n('earnings_cents'),
    copies: n('copies'),
    refundedCopies: n('refunded_copies'),
  };
}
