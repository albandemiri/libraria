import { randomUUID } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { activeProvider } from '../commerce/providers';
import {
  SIMULATED_SIGNATURE_HEADER,
  type SimulatedWebhookBody,
  simulatedPaymentTotals,
} from '../commerce/providers/simulated';
import { getReceipt } from '../commerce/queries';
import { processWebhook } from '../commerce/service';
import { signWebhook } from '../commerce/signature';
import { pool } from '../db/pool';
import { authContext, requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errors';

/**
 * DEVELOPMENT ONLY: plays the payment provider's part.
 *
 * Mounted only when PAYMENTS_MODE=simulated (refused in production). Each
 * call builds a provider event, signs it with the simulated webhook secret
 * and hands it to the same processWebhook() a real provider webhook uses, so
 * signature checks, idempotency and the ledger all run exactly as in
 * production.
 */
export const sandboxRouter = Router();
sandboxRouter.use(requireAuth);

const eventKinds = [
  'payment_succeeded',
  'payment_failed',
  'checkout_cancelled',
  'refund',
  'dispute_opened',
  'dispute_won',
  'chargeback',
] as const;

export const sandboxEventSchema = z.object({
  kind: z.enum(eventKinds),
  /** refund only: which books; defaults to all. */
  bookIds: z.array(z.string().uuid()).optional(),
  /** refund only: a partial (goodwill) amount instead of a full refund. */
  partialAmountCents: z.number().int().positive().optional(),
  /** payment_succeeded only: report a different total, to exercise mismatch handling. */
  overrideTotalCents: z.number().int().min(0).optional(),
  /** payment_succeeded only: buyer country; defaults to DE, null means unknown. */
  countryCode: z.string().nullable().optional(),
});

const idParamSchema = z.object({ id: z.string().uuid('Not a valid transaction id') });

sandboxRouter.post('/transactions/:id/events', async (req: Request, res: Response) => {
  const provider = activeProvider();
  if (env.PAYMENTS_MODE !== 'simulated' || provider?.name !== 'simulated') {
    throw new AppError(404, 'Route not found', 'ROUTE_NOT_FOUND');
  }

  const auth = authContext(req);
  const { id } = idParamSchema.parse(req.params);
  const input = sandboxEventSchema.parse(req.body);

  const { rows } = await pool.query<{ user_id: string; provider_transaction_id: string | null }>(
    `SELECT user_id, provider_transaction_id FROM transactions WHERE id = $1 AND provider = 'simulated'`,
    [id],
  );
  const txn = rows[0];
  if (!txn || (txn.user_id !== auth.userId && auth.role !== 'admin')) {
    throw new AppError(404, 'Transaction not found', 'NOT_FOUND');
  }

  const { rows: items } = await pool.query<{
    book_id: string;
    unit_price_cents: string;
    currency: string;
    provider_price_id: string | null;
    provider_line_item_id: string | null;
  }>(
    `SELECT book_id, unit_price_cents, currency, provider_price_id, provider_line_item_id
       FROM transaction_items WHERE transaction_id = $1 ORDER BY created_at, id`,
    [id],
  );

  let event: SimulatedWebhookBody['event'];
  switch (input.kind) {
    case 'payment_succeeded': {
      const { totals, lineItems } = simulatedPaymentTotals(
        items[0]?.currency.trim() ?? 'EUR',
        items.map((item) => ({
          priceId: item.provider_price_id ?? `sim_pri_${item.book_id}`,
          unitPriceCents: Number(item.unit_price_cents),
        })),
      );
      if (input.overrideTotalCents !== undefined) totals.totalCents = input.overrideTotalCents;
      event = {
        kind: 'payment_succeeded',
        totals,
        lineItems,
        countryCode: input.countryCode === undefined ? 'DE' : input.countryCode,
      };
      break;
    }
    case 'refund': {
      const chosen = input.bookIds
        ? items.filter((item) => input.bookIds?.includes(item.book_id))
        : items;
      event = {
        kind: 'refund',
        adjustmentId: `sim_adj_${randomUUID()}`,
        lines: chosen.map((item) => ({
          providerLineItemId: item.provider_line_item_id ?? `unpaid_${item.book_id}`,
          full: input.partialAmountCents === undefined,
          amountCents: input.partialAmountCents ?? null,
        })),
      };
      break;
    }
    case 'chargeback':
      event = {
        kind: 'chargeback',
        adjustmentId: `sim_adj_${randomUUID()}`,
        amountCents: items.reduce((sum, item) => sum + Number(item.unit_price_cents), 0),
      };
      break;
    default:
      event = { kind: input.kind };
  }

  const body: SimulatedWebhookBody = {
    providerEventId: `sim_evt_${randomUUID()}`,
    eventType: `simulated.${input.kind}`,
    occurredAt: new Date().toISOString(),
    providerTransactionId: txn.provider_transaction_id,
    internalTransactionId: id,
    event,
  };

  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = signWebhook(rawBody, env.SIMULATED_WEBHOOK_SECRET);

  const result = await processWebhook(provider, rawBody, (name) =>
    name.toLowerCase() === SIMULATED_SIGNATURE_HEADER ? signature : undefined,
  );

  res.json({ result, transaction: await getReceipt(txn.user_id, id) });
});
