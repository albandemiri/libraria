import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { normalizeCountry } from '../country';
import { parseMinorUnits } from '../money';
import { verifyWebhookSignature } from '../signature';
import {
  type CheckoutRequest,
  type CheckoutResult,
  type PaymentProvider,
  PaymentProviderError,
  type ProviderEvent,
  type ProviderLineItem,
  type RefundLine,
} from './types';

/**
 * Paddle Billing (v2 API) adapter.
 *
 * Paddle is merchant of record: it charges the customer, collects VAT and pays
 * Libraria its earnings. Books are sent as non-catalog items with the price
 * set server-side from our database, tax-inclusive (`tax_mode: internal`) and
 * in the `ebooks` tax category, which must be enabled on the Paddle account.
 *
 * Fulfilment keys off `transaction.completed` (Paddle's recommended signal),
 * not `transaction.paid`. Refunds and chargebacks arrive as adjustments and
 * only count once their status is `approved`.
 *
 * Field paths marked VERIFY were not confirmed against the published schema
 * when this was written; they are parsed leniently and fail closed (event
 * ignored, nothing granted). Confirm them against a sandbox payload.
 */

export const PADDLE_SIGNATURE_HEADER = 'paddle-signature';

const API_BASE = {
  sandbox: 'https://sandbox-api.paddle.com',
  production: 'https://api.paddle.com',
} as const;

export type PaddleEnvironment = keyof typeof API_BASE;

const amount = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    return parseMinorUnits(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'not an integer amount' });
    return z.NEVER;
  }
});

const createResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    // VERIFY: checkout link path on the create-transaction response.
    checkout: z.object({ url: z.string().url().nullable() }).nullable().optional(),
    items: z
      .array(
        z.object({
          price: z
            .object({
              id: z.string(),
              custom_data: z.record(z.string(), z.unknown()).nullable().optional(),
            })
            .passthrough(),
        }),
      )
      .optional(),
  }),
});

const envelopeSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  occurred_at: z.coerce.date().nullable().optional(),
  data: z.unknown(),
});

const customDataSchema = z
  .object({ libraria_transaction_id: z.string().uuid().optional() })
  .passthrough()
  .nullable()
  .optional();

const transactionDataSchema = z.object({
  id: z.string(),
  custom_data: customDataSchema,
});

const completedDataSchema = transactionDataSchema.extend({
  // VERIFY: billing country path on the completed transaction.
  address: z.object({ country_code: z.unknown() }).passthrough().nullable().optional(),
  details: z.object({
    totals: z.object({
      subtotal: amount,
      tax: amount,
      total: amount,
      fee: amount.nullable().optional(),
      earnings: amount.nullable().optional(),
      currency_code: z.string().length(3),
    }),
    // VERIFY: per-line-item fields. Only id is required; the rest degrade
    // to proportional allocation in the ledger if absent.
    line_items: z
      .array(
        z
          .object({
            id: z.string(),
            price_id: z.string().nullable().optional(),
            totals: z
              .object({ tax: amount.optional(), total: amount.optional() })
              .partial()
              .nullable()
              .optional(),
          })
          .passthrough(),
      )
      .default([]),
  }),
});

const adjustmentDataSchema = z.object({
  id: z.string(),
  action: z.string(),
  status: z.string(),
  transaction_id: z.string(),
  items: z
    .array(
      z.object({
        item_id: z.string(),
        type: z.string(),
        amount: amount.nullable().optional(),
      }),
    )
    .default([]),
  totals: z.object({ total: amount }).partial().nullable().optional(),
});

export interface PaddleConfig {
  apiKey: string;
  webhookSecret: string;
  environment: PaddleEnvironment;
  toleranceSeconds: number;
  fetch?: typeof fetch;
}

export class PaddleProvider implements PaymentProvider {
  readonly name = 'paddle' as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: PaddleConfig) {
    this.fetchImpl = config.fetch ?? fetch;
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const body = {
      collection_mode: 'automatic',
      currency_code: request.currency,
      custom_data: { libraria_transaction_id: request.transactionId },
      items: request.items.map((item) => ({
        quantity: 1,
        price: {
          name: truncate(item.title, 150),
          description: truncate(`E-book: ${item.title}`, 500),
          unit_price: { amount: String(item.unitPriceCents), currency_code: request.currency },
          tax_mode: 'internal',
          custom_data: { libraria_item_id: item.itemId, libraria_book_id: item.bookId },
          product: {
            name: truncate(item.title, 200),
            tax_category: 'ebooks',
            custom_data: { libraria_book_id: item.bookId },
          },
        },
      })),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(`${API_BASE[this.config.environment]}/transactions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new PaymentProviderError('Paddle request failed', { cause: error });
    }

    if (!response.ok) {
      // Paddle error bodies describe the request, not the customer; still,
      // keep only the status and error code in the message.
      const detail = await response
        .json()
        .then((json: { error?: { code?: string } }) => json?.error?.code)
        .catch(() => undefined);
      throw new PaymentProviderError(
        `Paddle create transaction returned ${response.status}${detail ? ` (${detail})` : ''}`,
      );
    }

    const parsed = createResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new PaymentProviderError('Unexpected Paddle create transaction response');
    }

    const { data } = parsed.data;
    const responseItems = data.items ?? [];
    const priceIds: Record<string, string> = {};

    request.items.forEach((item, index) => {
      // Prefer our echoed custom data; fall back to request order.
      const echoed = responseItems.find(
        (candidate) => candidate.price.custom_data?.libraria_item_id === item.itemId,
      );
      const priceId = echoed?.price.id ?? responseItems[index]?.price.id;
      if (priceId) priceIds[item.itemId] = priceId;
    });

    return {
      providerTransactionId: data.id,
      checkoutUrl: data.checkout?.url ?? null,
      priceIds,
    };
  }

  async lookupCountry(providerTransactionId: string): Promise<string | null> {
    try {
      const response = await this.fetchImpl(
        `${API_BASE[this.config.environment]}/transactions/${encodeURIComponent(providerTransactionId)}?include=address`,
        {
          headers: { Authorization: `Bearer ${this.config.apiKey}` },
          signal: AbortSignal.timeout(3_000),
        },
      );
      if (!response.ok) return null;
      const json = (await response.json()) as { data?: { address?: { country_code?: unknown } } };
      // VERIFY: address path on the get-transaction response.
      return normalizeCountry(json?.data?.address?.country_code);
    } catch {
      return null;
    }
  }

  parseWebhook(rawBody: Buffer, header: (name: string) => string | undefined): ProviderEvent {
    verifyWebhookSignature(header(PADDLE_SIGNATURE_HEADER), rawBody, this.config.webhookSecret, {
      toleranceSeconds: this.config.toleranceSeconds,
    });

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return ignored(`unparseable_${randomUUID()}`, 'unknown', null, 'body is not JSON');
    }

    const envelope = envelopeSchema.safeParse(json);
    if (!envelope.success) {
      return ignored(`unparseable_${randomUUID()}`, 'unknown', null, 'invalid envelope');
    }

    const { event_id: eventId, event_type: eventType, data } = envelope.data;
    const occurredAt = envelope.data.occurred_at ?? null;

    try {
      return mapEvent(eventId, eventType, occurredAt, data);
    } catch (error) {
      const reason = error instanceof z.ZodError ? error.issues[0]?.message : String(error);
      return ignored(eventId, eventType, occurredAt, `unparseable ${eventType}: ${reason}`);
    }
  }
}

function mapEvent(
  eventId: string,
  eventType: string,
  occurredAt: Date | null,
  data: unknown,
): ProviderEvent {
  const base = { providerEventId: eventId, eventType, occurredAt };

  switch (eventType) {
    case 'transaction.completed': {
      const txn = completedDataSchema.parse(data);
      const { totals } = txn.details;
      const lineItems: ProviderLineItem[] = txn.details.line_items.map((line) => ({
        providerLineItemId: line.id,
        providerPriceId: line.price_id ?? null,
        taxCents: line.totals?.tax ?? null,
        totalCents: line.totals?.total ?? null,
      }));
      return {
        ...base,
        kind: 'payment_succeeded',
        providerTransactionId: txn.id,
        internalTransactionId: txn.custom_data?.libraria_transaction_id ?? null,
        totals: {
          currency: totals.currency_code,
          subtotalCents: totals.subtotal,
          taxCents: totals.tax,
          totalCents: totals.total,
          feeCents: totals.fee ?? null,
          earningsCents: totals.earnings ?? null,
        },
        lineItems,
        countryCode: normalizeCountry(txn.address?.country_code),
      };
    }

    case 'transaction.payment_failed':
    case 'transaction.canceled': {
      const txn = transactionDataSchema.parse(data);
      return {
        ...base,
        kind: eventType === 'transaction.canceled' ? 'checkout_cancelled' : 'payment_failed',
        providerTransactionId: txn.id,
        internalTransactionId: txn.custom_data?.libraria_transaction_id ?? null,
      };
    }

    case 'adjustment.created':
    case 'adjustment.updated': {
      const adjustment = adjustmentDataSchema.parse(data);
      const adjustmentBase = {
        ...base,
        providerTransactionId: adjustment.transaction_id,
        internalTransactionId: null,
      };

      // pending_approval may still be rejected; only approved is final.
      if (adjustment.status !== 'approved') {
        return { ...adjustmentBase, kind: 'ignored', reason: `adjustment ${adjustment.status}` };
      }

      switch (adjustment.action) {
        case 'refund': {
          const lines: RefundLine[] = adjustment.items.map((item) => ({
            providerLineItemId: item.item_id,
            full: item.type === 'full',
            amountCents: item.amount ?? null,
          }));
          return { ...adjustmentBase, kind: 'refund', adjustmentId: adjustment.id, lines };
        }
        case 'chargeback':
          return {
            ...adjustmentBase,
            kind: 'chargeback',
            adjustmentId: adjustment.id,
            amountCents: adjustment.totals?.total ?? 0,
          };
        case 'chargeback_warning':
          return { ...adjustmentBase, kind: 'dispute_opened' };
        case 'chargeback_warning_reverse':
        case 'chargeback_reverse':
          return { ...adjustmentBase, kind: 'dispute_won' };
        default:
          // credit / credit_reverse: account credits, no effect on access.
          return { ...adjustmentBase, kind: 'ignored', reason: `adjustment ${adjustment.action}` };
      }
    }

    default:
      return ignored(eventId, eventType, occurredAt, 'event type not handled');
  }
}

function ignored(
  providerEventId: string,
  eventType: string,
  occurredAt: Date | null,
  reason: string,
): ProviderEvent {
  return {
    kind: 'ignored',
    reason,
    providerEventId,
    eventType,
    occurredAt,
    providerTransactionId: null,
    internalTransactionId: null,
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
