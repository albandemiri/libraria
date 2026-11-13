/**
 * Platform commission: the only place the commission base and its rounding
 * are defined. To change the base (for example to "a percentage of the price
 * after VAT", with the publisher absorbing the fee), change splitEarnings
 * only; callers pass the raw sale amounts. Sales already split keep their
 * stored shares.
 *
 * Amounts are integer cents, rates integer basis points (2000 = 20%).
 * Rounding favours the publisher, both on the sale and on refunds.
 */

export const MAX_RATE_BPS = 10000;

export interface EarningsSplit {
  platformCommissionCents: number;
  publisherEarningsCents: number;
}

export interface ShareReversal {
  platformReversedCents: number;
  publisherReversedCents: number;
}

/** One sold item's money, as recorded once payment is confirmed. */
export interface SaleAmounts {
  /** Tax-inclusive price the customer paid. */
  priceCents: number;
  taxCents: number;
  /** Null while the provider has not reported it. */
  feeCents: number | null;
}

/**
 * Splits one sold item between Libraria and the publisher. The shares always
 * sum to the base. Null while the provider has not reported its fee.
 *
 * Base (option B, chosen 2026-11-13): price - VAT - provider fee.
 */
export function splitEarnings(sale: SaleAmounts, rateBps: number): EarningsSplit | null {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > MAX_RATE_BPS) {
    throw new RangeError(`Commission rate must be 0..${MAX_RATE_BPS} basis points: ${rateBps}`);
  }
  if (sale.feeCents === null) return null;
  const base = sale.priceCents - sale.taxCents - sale.feeCents;

  // Fees can exceed a very cheap book's price: Libraria then takes nothing.
  const platformCommissionCents = base <= 0 ? 0 : Math.floor((base * rateBps) / MAX_RATE_BPS);
  return {
    platformCommissionCents,
    publisherEarningsCents: base - platformCommissionCents,
  };
}

/**
 * The part of each share that is reversed once `refundedCents` of the item's
 * price has been refunded in total. Computed from the cumulative refund, so
 * several partial refunds never drift from the original shares.
 */
export function reverseShares(
  split: EarningsSplit,
  unitPriceCents: number,
  refundedCents: number,
): ShareReversal {
  if (refundedCents >= unitPriceCents) {
    return {
      platformReversedCents: split.platformCommissionCents,
      publisherReversedCents: split.publisherEarningsCents,
    };
  }
  const platform = split.platformCommissionCents;
  return {
    platformReversedCents: Math.min(
      Math.ceil((platform * refundedCents) / unitPriceCents),
      platform,
    ),
    publisherReversedCents: Math.floor(
      (split.publisherEarningsCents * refundedCents) / unitPriceCents,
    ),
  };
}
