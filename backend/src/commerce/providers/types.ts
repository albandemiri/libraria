/**
 * The boundary between Libraria's commerce domain and a payment provider.
 * Adapters translate provider APIs and webhooks into these shapes, so the
 * ledger logic (commerce/service.ts) never sees provider-specific payloads.
 */

export type ProviderName = 'simulated' | 'paddle';

export interface CheckoutItem {
  itemId: string;
  bookId: string;
  title: string;
  unitPriceCents: number;
}

export interface CheckoutRequest {
  transactionId: string;
  currency: string;
  items: CheckoutItem[];
}

export interface CheckoutResult {
  providerTransactionId: string;
  /** Where the customer pays. Null for the simulated provider. */
  checkoutUrl: string | null;
  /** Provider price id per Libraria item id, to map webhook line items back. */
  priceIds: Record<string, string>;
}

export interface ProviderTotals {
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  /** Provider fee and seller earnings; null if the provider has not reported them. */
  feeCents: number | null;
  earningsCents: number | null;
}

export interface ProviderLineItem {
  providerLineItemId: string;
  providerPriceId: string | null;
  taxCents: number | null;
  totalCents: number | null;
}

export interface RefundLine {
  providerLineItemId: string;
  /** Full refunds revoke access; partial refunds (goodwill credits) do not. */
  full: boolean;
  amountCents: number | null;
}

interface EventBase {
  providerEventId: string;
  eventType: string;
  occurredAt: Date | null;
  providerTransactionId: string | null;
  /** Libraria transaction id, when the provider echoes our custom data. */
  internalTransactionId: string | null;
}

export type ProviderEvent = EventBase &
  (
    | {
        kind: 'payment_succeeded';
        totals: ProviderTotals;
        lineItems: ProviderLineItem[];
        /** Buyer's billing country (ISO alpha-2); null when the provider did not report it. */
        countryCode: string | null;
      }
    | { kind: 'payment_failed' }
    | { kind: 'checkout_cancelled' }
    | { kind: 'refund'; adjustmentId: string; lines: RefundLine[] }
    | { kind: 'dispute_opened' }
    | { kind: 'dispute_won' }
    | { kind: 'chargeback'; adjustmentId: string; amountCents: number }
    | { kind: 'ignored'; reason: string }
  );

export interface PaymentProvider {
  readonly name: ProviderName;

  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * Authenticates and parses a webhook. Throws WebhookVerificationError if
   * the request did not come from the provider; returns a `kind: 'ignored'`
   * event for authentic events Libraria does not act on.
   */
  parseWebhook(rawBody: Buffer, header: (name: string) => string | undefined): ProviderEvent;

  /** Fetches the buyer's country for a transaction when the webhook lacked it. Never throws. */
  lookupCountry?(providerTransactionId: string): Promise<string | null>;
}

/** The provider could not be reached or rejected the request. */
export class PaymentProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PaymentProviderError';
  }
}
