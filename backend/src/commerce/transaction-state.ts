/**
 * Transaction lifecycle (spec Appendix A, 16.1).
 *
 *   pending ──▶ paid ──▶ partially_refunded ──▶ refunded
 *      │         │  ▲            │                 ▲
 *      │         ▼  │            ▼                 │
 *      │       disputed ─────────────────────────────┘ (chargeback lost)
 *      ├──▶ failed ──▶ paid   (a later attempt in the same checkout succeeds)
 *      ├──▶ cancelled
 *      └──▶ expired ──▶ paid  (payment confirmed after we gave up: honour it)
 *
 * Only verified provider events move a transaction out of `pending`.
 */

export const transactionStatuses = [
  'pending',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
  'disputed',
] as const;

export type TransactionStatus = (typeof transactionStatuses)[number];

const TRANSITIONS: Record<TransactionStatus, readonly TransactionStatus[]> = {
  pending: ['paid', 'failed', 'cancelled', 'expired'],
  failed: ['paid', 'cancelled', 'expired'],
  expired: ['paid'],
  cancelled: [],
  paid: ['partially_refunded', 'refunded', 'disputed'],
  partially_refunded: ['partially_refunded', 'refunded', 'disputed'],
  disputed: ['paid', 'partially_refunded', 'refunded'],
  refunded: [],
};

export function canTransition(from: TransactionStatus, to: TransactionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** States in which the customer's money has been taken and not fully returned. */
export const MONEY_TAKEN_STATES: readonly TransactionStatus[] = [
  'paid',
  'partially_refunded',
  'disputed',
];
