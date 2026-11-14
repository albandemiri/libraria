import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { verifyWebhookSignature } from '../signature';
import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  ProviderEvent,
  ProviderLineItem,
  ProviderTotals,
} from './types';

/**
 * Development/test stand-in for a payment provider.
 *
 * Unlike the old simulated checkout it grants nothing by itself: a payment
 * only "happens" when a signed webhook arrives (sent by the sandbox routes or
 * by tests), and that webhook goes through the same verification and ledger
 * code as a real Paddle event.
 *
 * Its webhook body is a provider event in Libraria's own normalised shape.
 */

export const SIMULATED_SIGNATURE_HEADER = 'libraria-sandbox-signature';

/** Illustrative numbers so dashboards show realistic splits in development. */
const SIMULATED_VAT_RATE = 0.2;
const SIMULATED_FEE_RATE = 0.05;
const SIMULATED_FEE_FIXED_CENTS = 50;

const cents = z.number().int();

const eventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('payment_succeeded'),
    countryCode: z.string().nullable().optional(),
    totals: z.object({
      currency: z.string().length(3),
      subtotalCents: cents,
      taxCents: cents,
      totalCents: cents,
      feeCents: cents.nullable(),
      earningsCents: cents.nullable(),
    }),
    lineItems: z.array(
      z.object({
        providerLineItemId: z.string(),
        providerPriceId: z.string().nullable(),
        taxCents: cents.nullable(),
        totalCents: cents.nullable(),
      }),
    ),
  }),
  z.object({ kind: z.literal('payment_failed') }),
  z.object({ kind: z.literal('checkout_cancelled') }),
  z.object({
    kind: z.literal('refund'),
    adjustmentId: z.string(),
    lines: z.array(
      z.object({
        providerLineItemId: z.string(),
        full: z.boolean(),
        amountCents: cents.nullable(),
      }),
    ),
  }),
  z.object({ kind: z.literal('dispute_opened') }),
  z.object({ kind: z.literal('dispute_won') }),
  z.object({ kind: z.literal('chargeback'), adjustmentId: z.string(), amountCents: cents }),
]);

const envelopeSchema = z.object({
  providerEventId: z.string().min(1).max(200),
  eventType: z.string().min(1).max(100),
  occurredAt: z.coerce.date().nullable(),
  providerTransactionId: z.string().nullable(),
  internalTransactionId: z.string().uuid().nullable(),
  event: eventSchema,
});

export type SimulatedWebhookBody = z.input<typeof envelopeSchema>;

export class SimulatedProvider implements PaymentProvider {
  readonly name = 'simulated' as const;

  constructor(
    private readonly secret: string,
    private readonly toleranceSeconds: number,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    return {
      providerTransactionId: `sim_txn_${randomUUID()}`,
      checkoutUrl: null,
      priceIds: Object.fromEntries(
        request.items.map((item) => [item.itemId, `sim_pri_${item.itemId}`]),
      ),
    };
  }

  parseWebhook(rawBody: Buffer, header: (name: string) => string | undefined): ProviderEvent {
    verifyWebhookSignature(header(SIMULATED_SIGNATURE_HEADER), rawBody, this.secret, {
      toleranceSeconds: this.toleranceSeconds,
    });

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return unparseable('body is not JSON');
    }

    const parsed = envelopeSchema.safeParse(json);
    if (!parsed.success) {
      return unparseable(parsed.error.issues[0]?.message ?? 'invalid event');
    }

    const { event, ...base } = parsed.data;
    if (event.kind === 'payment_succeeded') {
      return { ...base, ...event, countryCode: event.countryCode ?? null };
    }
    return { ...base, ...event };
  }
}

function unparseable(reason: string): ProviderEvent {
  return {
    kind: 'ignored',
    reason: `unparseable: ${reason}`,
    providerEventId: `unparseable_${randomUUID()}`,
    eventType: 'unknown',
    occurredAt: null,
    providerTransactionId: null,
    internalTransactionId: null,
  };
}

/**
 * Builds plausible provider totals for a simulated payment: VAT included in
 * the price, and a percentage-plus-fixed provider fee, split across items.
 */
export function simulatedPaymentTotals(
  currency: string,
  items: Array<{ priceId: string; unitPriceCents: number }>,
): { totals: ProviderTotals; lineItems: ProviderLineItem[] } {
  const lineItems = items.map((item, index) => {
    const tax = Math.round(item.unitPriceCents - item.unitPriceCents / (1 + SIMULATED_VAT_RATE));
    return {
      providerLineItemId: `sim_li_${index}_${item.priceId}`,
      providerPriceId: item.priceId,
      taxCents: tax,
      totalCents: item.unitPriceCents,
    };
  });

  const total = items.reduce((sum, item) => sum + item.unitPriceCents, 0);
  const tax = lineItems.reduce((sum, line) => sum + (line.taxCents ?? 0), 0);
  const fee = total === 0 ? 0 : Math.round(total * SIMULATED_FEE_RATE) + SIMULATED_FEE_FIXED_CENTS;

  // Keep the fee from exceeding what is left after tax on tiny prices.
  const boundedFee = Math.min(fee, total - tax);

  return {
    totals: {
      currency,
      subtotalCents: total - tax,
      taxCents: tax,
      totalCents: total,
      feeCents: boundedFee,
      earningsCents: total - tax - boundedFee,
    },
    lineItems,
  };
}
