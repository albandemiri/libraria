import type { BookDetail, Viewer } from '../lib/types';

export type PurchaseState =
  | 'guest_can_buy'
  | 'can_buy'
  | 'pending'
  | 'owned'
  | 'owned_taken_down'
  | 'not_for_sale'
  | 'refunded';

/** Which purchase box a reader sees. The order matters: ownership wins over everything else. */
export function purchaseState(book: BookDetail, viewer?: Viewer | null): PurchaseState {
  if (viewer?.owned && book.availability === 'taken_down') return 'owned_taken_down';
  if (viewer?.owned) return 'owned';
  if (viewer?.pendingTransactionId) return 'pending';
  if (!book.forSale || book.availability !== 'on_sale') return 'not_for_sale';
  if (viewer?.refund) return 'refunded';
  if (viewer) return 'can_buy';
  return 'guest_can_buy';
}
