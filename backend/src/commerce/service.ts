import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { isPgError, PG_UNIQUE_VIOLATION } from '../db/errors';
import { pool, withTransaction } from '../db/pool';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/errors';
import { reverseShares, splitEarnings } from './commission';
import { allocate } from './money';
import { rateInForceSql } from './rates';
import {
  type PaymentProvider,
  PaymentProviderError,
  type ProviderEvent,
  type ProviderName,
} from './providers/types';
import { canTransition, MONEY_TAKEN_STATES, type TransactionStatus } from './transaction-state';

/** Launch decision: EUR only. Extend deliberately, with reporting per currency. */
export const SUPPORTED_CURRENCIES = ['EUR'] as const;

export const MAX_CHECKOUT_ITEMS = 20;

// ---------------------------------------------------------------------------
// Checkout (spec 7.1 steps 1-3)
// ---------------------------------------------------------------------------

export interface CheckoutInput {
  userId: string;
  bookIds: string[];
  idempotencyKey?: string;
}

export interface CheckoutOutcome {
  transactionId: string;
  /** False when an idempotency key matched an earlier checkout. */
  created: boolean;
}

/**
 * Creates a pending transaction with price snapshots, then a provider
 * checkout for it. Grants nothing: access follows only a verified webhook.
 */
export async function createCheckout(
  provider: PaymentProvider,
  input: CheckoutInput,
): Promise<CheckoutOutcome> {
  const bookIds = [...new Set(input.bookIds)];

  if (input.idempotencyKey) {
    const existing = await findByIdempotencyKey(input.userId, input.idempotencyKey, bookIds);
    if (existing) return { transactionId: existing, created: false };
  }

  // Prices, currency and publisher come from the database, never the client.
  const { rows: books } = await pool.query<{
    id: string;
    title: string;
    price_cents: number;
    currency: string;
    publisher_id: string;
    commission_rate_bps: number | null;
  }>(
    `SELECT b.id, b.title, b.price_cents, b.currency, b.publisher_id,
            ${rateInForceSql('b.publisher_id')} AS commission_rate_bps
       FROM books b
      WHERE b.id = ANY($1::uuid[]) AND b.is_available`,
    [bookIds],
  );

  if (books.length !== bookIds.length) {
    throw new AppError(404, 'One or more books are not available for purchase', 'NOT_FOUND');
  }

  // Policy: no contract rate in force, no sale (never a silent 0% commission).
  if (books.some((book) => book.commission_rate_bps === null)) {
    throw new AppError(409, 'One or more books are not for sale right now', 'BOOK_NOT_FOR_SALE');
  }

  const currencies = new Set(books.map((book) => book.currency.trim()));
  const [currency] = currencies;
  if (
    currencies.size !== 1 ||
    !(SUPPORTED_CURRENCIES as readonly string[]).includes(currency as string)
  ) {
    throw new AppError(400, 'These books cannot be bought together', 'UNSUPPORTED_CURRENCY');
  }

  const { rows: owned } = await pool.query<{ book_id: string }>(
    `SELECT book_id FROM entitlements
      WHERE user_id = $1 AND book_id = ANY($2::uuid[]) AND status = 'active'`,
    [input.userId, bookIds],
  );
  if (owned.length > 0) {
    throw new AppError(409, 'You already own one or more of these books', 'ALREADY_OWNED');
  }

  // Keep the caller's order so receipts list books as chosen. Every id is
  // present: the length check above guarantees it.
  const byId = new Map(books.map((book) => [book.id, book]));
  const ordered = bookIds.flatMap((id) => byId.get(id) ?? []);
  const total = ordered.reduce((sum, book) => sum + book.price_cents, 0);

  let created: { transactionId: string; items: Array<{ id: string; book_id: string }> };
  try {
    created = await withTransaction(async (client) => {
      const txn = await client.query<{ id: string }>(
        `INSERT INTO transactions (user_id, total_cents, currency, status, provider, idempotency_key)
         VALUES ($1, $2, $3, 'pending', $4, $5)
         RETURNING id`,
        [input.userId, total, currency, provider.name, input.idempotencyKey ?? null],
      );
      const transactionId = txn.rows[0].id;

      const items = await client.query<{ id: string; book_id: string }>(
        `INSERT INTO transaction_items
           (transaction_id, book_id, publisher_id, title, unit_price_cents, currency,
            commission_rate_bps)
         SELECT $1, b.id, b.publisher_id, b.title, b.price_cents, b.currency, chosen.rate_bps
           FROM unnest($2::uuid[], $3::int[]) WITH ORDINALITY AS chosen(book_id, rate_bps, position)
           JOIN books b ON b.id = chosen.book_id
          ORDER BY chosen.position
         RETURNING id, book_id`,
        [
          transactionId,
          ordered.map((book) => book.id),
          ordered.map((book) => book.commission_rate_bps),
        ],
      );

      return { transactionId, items: items.rows };
    });
  } catch (error) {
    // Two concurrent requests with the same idempotency key: the loser
    // returns the winner's transaction.
    if (input.idempotencyKey && isPgError(error, PG_UNIQUE_VIOLATION)) {
      const existing = await findByIdempotencyKey(input.userId, input.idempotencyKey, bookIds);
      if (existing) return { transactionId: existing, created: false };
    }
    throw error;
  }

  let checkout: Awaited<ReturnType<PaymentProvider['createCheckout']>>;
  try {
    checkout = await provider.createCheckout({
      transactionId: created.transactionId,
      currency: currency as string,
      items: created.items.flatMap((item) => {
        const book = byId.get(item.book_id);
        return book
          ? [
              {
                itemId: item.id,
                bookId: book.id,
                title: book.title,
                unitPriceCents: book.price_cents,
              },
            ]
          : [];
      }),
    });
  } catch (error) {
    logger.error('payment provider checkout failed', {
      transactionId: created.transactionId,
      provider: provider.name,
      err: error,
    });
    await pool.query(
      `UPDATE transactions SET status = 'failed', review_reason = 'provider checkout failed'
        WHERE id = $1`,
      [created.transactionId],
    );
    if (error instanceof PaymentProviderError) {
      throw new AppError(502, 'The payment provider is unavailable', 'PAYMENT_PROVIDER_ERROR');
    }
    throw error;
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE transactions SET provider_transaction_id = $2, checkout_url = $3 WHERE id = $1`,
      [created.transactionId, checkout.providerTransactionId, checkout.checkoutUrl],
    );
    for (const item of created.items) {
      const priceId = checkout.priceIds[item.id];
      if (priceId) {
        await client.query(`UPDATE transaction_items SET provider_price_id = $2 WHERE id = $1`, [
          item.id,
          priceId,
        ]);
      }
    }
  });

  return { transactionId: created.transactionId, created: true };
}

async function findByIdempotencyKey(
  userId: string,
  key: string,
  bookIds: string[],
): Promise<string | null> {
  const { rows } = await pool.query<{ id: string; book_ids: string[] }>(
    `SELECT t.id, array_agg(ti.book_id::text ORDER BY ti.book_id) AS book_ids
       FROM transactions t
       JOIN transaction_items ti ON ti.transaction_id = t.id
      WHERE t.user_id = $1 AND t.idempotency_key = $2
      GROUP BY t.id`,
    [userId, key],
  );

  const existing = rows[0];
  if (!existing) return null;

  const requested = [...bookIds].sort();
  const sameBooks =
    existing.book_ids.length === requested.length &&
    existing.book_ids.every((id, index) => id === requested[index]);

  if (!sameBooks) {
    throw new AppError(
      409,
      'This idempotency key was already used for a different checkout',
      'IDEMPOTENCY_KEY_REUSED',
    );
  }
  return existing.id;
}

// ---------------------------------------------------------------------------
// Webhooks (spec 7.1 steps 5-8, 7.2)
// ---------------------------------------------------------------------------

export interface WebhookResult {
  outcome: 'applied' | 'ignored' | 'duplicate';
  detail: string | null;
  transactionId: string | null;
}

/**
 * Verifies, records and applies one provider webhook, exactly once.
 *
 * Everything happens in one database transaction: the event row (unique per
 * provider event id), the transaction state change and any entitlement grant
 * or revocation commit together or not at all. A crash mid-way rolls back
 * the event row too, so the provider's retry reprocesses it.
 */
export async function processWebhook(
  provider: PaymentProvider,
  rawBody: Buffer,
  header: (name: string) => string | undefined,
): Promise<WebhookResult> {
  // Throws WebhookVerificationError before anything is written.
  const event = provider.parseWebhook(rawBody, header);
  const digest = createHash('sha256').update(rawBody).digest('hex');

  return withTransaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO payment_events
         (provider, provider_event_id, event_type, occurred_at, outcome, payload_sha256)
       VALUES ($1, $2, $3, $4, 'ignored', $5)
       ON CONFLICT (provider, provider_event_id) DO NOTHING
       RETURNING id`,
      [provider.name, event.providerEventId, event.eventType, event.occurredAt, digest],
    );

    if (inserted.rowCount === 0) {
      return { outcome: 'duplicate', detail: 'event already processed', transactionId: null };
    }

    const result = await applyEvent(client, provider.name, event);

    await client.query(
      `UPDATE payment_events SET outcome = $2, detail = $3, transaction_id = $4 WHERE id = $1`,
      [inserted.rows[0].id, result.outcome, result.detail, result.transactionId],
    );

    return result;
  });
}

interface TransactionRow {
  id: string;
  user_id: string;
  status: TransactionStatus;
  currency: string;
  total_cents: string;
  provider_transaction_id: string | null;
}

interface ItemRow {
  id: string;
  book_id: string;
  unit_price_cents: string;
  refunded_cents: string;
  refunded_at: Date | null;
  provider_price_id: string | null;
  provider_line_item_id: string | null;
  commission_rate_bps: number | null;
  platform_commission_cents: string | null;
  publisher_earnings_cents: string | null;
}

type Applied = {
  outcome: 'applied' | 'ignored';
  detail: string | null;
  transactionId: string | null;
};

async function applyEvent(
  client: PoolClient,
  providerName: ProviderName,
  event: ProviderEvent,
): Promise<Applied> {
  if (event.kind === 'ignored') {
    return { outcome: 'ignored', detail: event.reason, transactionId: null };
  }

  const { rows } = await client.query<TransactionRow>(
    `SELECT id, user_id, status, currency, total_cents, provider_transaction_id
       FROM transactions
      WHERE provider = $1
        AND (($2::uuid IS NOT NULL AND id = $2) OR ($3::text IS NOT NULL AND provider_transaction_id = $3))
      FOR UPDATE`,
    [providerName, event.internalTransactionId, event.providerTransactionId],
  );

  if (rows.length !== 1) {
    logger.warn('webhook for unknown transaction', {
      provider: providerName,
      providerEventId: event.providerEventId,
      matches: rows.length,
    });
    return { outcome: 'ignored', detail: 'unknown transaction', transactionId: null };
  }

  const txn = rows[0];
  const ignore = (detail: string): Applied => ({
    outcome: 'ignored',
    detail,
    transactionId: txn.id,
  });
  const applied = (detail: string): Applied => ({
    outcome: 'applied',
    detail,
    transactionId: txn.id,
  });

  // Our custom data and the provider's id must agree.
  if (
    event.providerTransactionId &&
    txn.provider_transaction_id &&
    event.providerTransactionId !== txn.provider_transaction_id
  ) {
    logger.error('webhook transaction reference mismatch', {
      transactionId: txn.id,
      providerEventId: event.providerEventId,
    });
    return ignore('provider transaction reference mismatch');
  }

  const { rows: items } = await client.query<ItemRow>(
    `SELECT id, book_id, unit_price_cents, refunded_cents, refunded_at,
            provider_price_id, provider_line_item_id,
            commission_rate_bps, platform_commission_cents, publisher_earnings_cents
       FROM transaction_items
      WHERE transaction_id = $1
      ORDER BY created_at, id
      FOR UPDATE`,
    [txn.id],
  );

  switch (event.kind) {
    case 'payment_succeeded':
      return applyPayment(client, txn, items, event, applied, ignore);

    case 'payment_failed':
      if (!canTransition(txn.status, 'failed')) return ignore(`no effect on ${txn.status}`);
      await setStatus(client, txn.id, 'failed');
      return applied('payment attempt failed');

    case 'checkout_cancelled':
      if (!canTransition(txn.status, 'cancelled')) return ignore(`no effect on ${txn.status}`);
      await setStatus(client, txn.id, 'cancelled');
      return applied('checkout cancelled');

    case 'refund':
      return applyRefund(client, providerName, txn, items, event, applied, ignore);

    case 'chargeback':
      return applyChargeback(client, providerName, txn, items, event, applied, ignore);

    case 'dispute_opened':
      // Access is kept while a dispute is open (policy: revoke only if lost).
      if (!canTransition(txn.status, 'disputed')) return ignore(`no effect on ${txn.status}`);
      await setStatus(client, txn.id, 'disputed');
      return applied('dispute opened');

    case 'dispute_won': {
      if (txn.status === 'disputed') {
        const partly = items.some((item) => Number(item.refunded_cents) > 0);
        await setStatus(client, txn.id, partly ? 'partially_refunded' : 'paid');
        return applied('dispute resolved in our favour');
      }
      if (txn.status === 'refunded') {
        // Chargeback reversed after access was revoked: a person decides.
        await flagForReview(client, txn.id, 'chargeback reversed; access not restored');
        return ignore('chargeback reversed after revocation; flagged for review');
      }
      return ignore(`no effect on ${txn.status}`);
    }
  }
}

async function applyPayment(
  client: PoolClient,
  txn: TransactionRow,
  items: ItemRow[],
  event: Extract<ProviderEvent, { kind: 'payment_succeeded' }>,
  applied: (detail: string) => Applied,
  ignore: (detail: string) => Applied,
): Promise<Applied> {
  if (!canTransition(txn.status, 'paid')) return ignore(`already ${txn.status}`);

  const { totals, lineItems } = event;
  const prices = items.map((item) => Number(item.unit_price_cents));
  const expectedTotal = prices.reduce((sum, price) => sum + price, 0);

  // Map provider line items back to ours by price id; a single-item order
  // needs no mapping.
  const lineFor = (item: ItemRow) =>
    lineItems.find(
      (line) => line.providerPriceId && line.providerPriceId === item.provider_price_id,
    ) ?? (items.length === 1 && lineItems.length === 1 ? lineItems[0] : undefined);
  const lines = items.map(lineFor);

  // Per-line tax when the provider gave it for every line; otherwise split.
  const lineTaxes = lines.map((line) => line?.taxCents ?? null);
  const taxes = lineTaxes.every((tax): tax is number => tax !== null)
    ? lineTaxes
    : allocate(Math.max(totals.taxCents, 0), prices);
  const fees = totals.feeCents == null ? null : allocate(Math.max(totals.feeCents, 0), prices);

  const unsplit = new Set<string>();
  for (const [index, item] of items.entries()) {
    const fee = fees?.[index] ?? null;
    const net = fee == null ? null : prices[index] - taxes[index] - fee;
    // Items checked out before commission rates existed have no rate: no split.
    const split =
      item.commission_rate_bps === null
        ? null
        : splitEarnings(
            { priceCents: prices[index], taxCents: taxes[index], feeCents: fee },
            item.commission_rate_bps,
          );
    if (split === null) {
      unsplit.add(
        item.commission_rate_bps === null ? 'no rate snapshot' : 'provider fee unreported',
      );
    }
    await client.query(
      `UPDATE transaction_items
          SET tax_cents = $2, provider_fee_cents = $3, net_cents = $4,
              provider_line_item_id = COALESCE($5, provider_line_item_id),
              platform_commission_cents = $6, publisher_earnings_cents = $7
        WHERE id = $1`,
      [
        item.id,
        taxes[index],
        fee,
        net,
        lines[index]?.providerLineItemId ?? null,
        split?.platformCommissionCents ?? null,
        split?.publisherEarningsCents ?? null,
      ],
    );
  }

  await client.query(
    `UPDATE transactions
        SET status = 'paid', paid_at = COALESCE($2, CURRENT_TIMESTAMP),
            subtotal_cents = $3, tax_cents = $4, provider_fee_cents = $5, earnings_cents = $6,
            provider_transaction_id = COALESCE(provider_transaction_id, $7)
      WHERE id = $1`,
    [
      txn.id,
      event.occurredAt,
      totals.subtotalCents,
      totals.taxCents,
      totals.feeCents,
      totals.earningsCents,
      event.providerTransactionId,
    ],
  );

  // Never a silent 0%: shares that could not be computed need a person.
  if (unsplit.size > 0) {
    await flagForReview(client, txn.id, `commission not split: ${[...unsplit].join(', ')}`);
  }

  // The provider charged what we asked for, or nobody gets a book until a
  // person has looked at it. Money was taken either way, so status is paid.
  if (totals.currency !== txn.currency.trim() || totals.totalCents !== expectedTotal) {
    logger.error('payment amount mismatch', {
      transactionId: txn.id,
      expectedCents: expectedTotal,
      expectedCurrency: txn.currency,
      reportedCents: totals.totalCents,
      reportedCurrency: totals.currency,
    });
    await flagForReview(client, txn.id, 'amount mismatch; entitlements withheld');
    return applied('paid; entitlements withheld (amount mismatch)');
  }

  let alreadyOwned = 0;
  for (const item of items) {
    const granted = await client.query(
      `INSERT INTO entitlements (user_id, book_id, source, source_item_id)
       VALUES ($1, $2, 'purchase', $3)
       ON CONFLICT (user_id, book_id) WHERE status = 'active' DO NOTHING`,
      [txn.user_id, item.book_id, item.id],
    );
    if (granted.rowCount === 0) alreadyOwned += 1;

    await client.query(
      `INSERT INTO user_libraries (user_id, book_id, transaction_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, book_id) DO NOTHING`,
      [txn.user_id, item.book_id, txn.id],
    );
  }

  if (alreadyOwned > 0) {
    // E.g. two checkouts for the same book both paid. Needs a refund.
    await flagForReview(client, txn.id, `duplicate purchase of ${alreadyOwned} book(s)`);
  }

  return applied(`paid; ${items.length - alreadyOwned} entitlement(s) granted`);
}

async function applyRefund(
  client: PoolClient,
  providerName: ProviderName,
  txn: TransactionRow,
  items: ItemRow[],
  event: Extract<ProviderEvent, { kind: 'refund' }>,
  applied: (detail: string) => Applied,
  ignore: (detail: string) => Applied,
): Promise<Applied> {
  if (!MONEY_TAKEN_STATES.includes(txn.status)) return ignore(`no effect on ${txn.status}`);

  const adjustment = await recordAdjustment(
    client,
    providerName,
    txn.id,
    event.adjustmentId,
    'refund',
  );
  if (!adjustment) return ignore('refund already applied');

  let refundedTotal = 0;
  let revoked = 0;
  const unmapped: string[] = [];

  for (const line of event.lines) {
    const item =
      items.find((candidate) => candidate.provider_line_item_id === line.providerLineItemId) ??
      (items.length === 1 ? items[0] : undefined);
    if (!item) {
      unmapped.push(line.providerLineItemId);
      continue;
    }
    if (item.refunded_at) continue;

    const price = Number(item.unit_price_cents);
    const alreadyRefunded = Number(item.refunded_cents);
    const remaining = price - alreadyRefunded;
    const amount = line.full ? remaining : Math.min(Math.max(line.amountCents ?? 0, 0), remaining);
    const fullyRefunded = line.full || alreadyRefunded + amount >= price;

    await client.query(
      `UPDATE transaction_items
          SET refunded_cents = $2,
              refunded_at = CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE refunded_at END
        WHERE id = $1`,
      [item.id, alreadyRefunded + amount, fullyRefunded],
    );
    item.refunded_cents = String(alreadyRefunded + amount);
    await applyReversal(client, item);
    if (fullyRefunded) {
      item.refunded_at = new Date();
      // Policy: a full refund ends access; a partial refund (goodwill) does not.
      revoked += await revokeForItem(client, item.id, 'refund');
    }
    refundedTotal += amount;
  }

  await client.query(`UPDATE transaction_adjustments SET amount_cents = $2 WHERE id = $1`, [
    adjustment,
    refundedTotal,
  ]);

  if (unmapped.length > 0) {
    await flagForReview(client, txn.id, `refund for unknown line item(s): ${unmapped.join(', ')}`);
  }

  const next: TransactionStatus = items.every((item) => item.refunded_at)
    ? 'refunded'
    : items.some((item) => Number(item.refunded_cents) > 0)
      ? 'partially_refunded'
      : txn.status;
  if (next !== txn.status && canTransition(txn.status, next)) {
    await setStatus(client, txn.id, next);
  }

  return applied(`refunded ${refundedTotal} cents; ${revoked} entitlement(s) revoked`);
}

async function applyChargeback(
  client: PoolClient,
  providerName: ProviderName,
  txn: TransactionRow,
  items: ItemRow[],
  event: Extract<ProviderEvent, { kind: 'chargeback' }>,
  applied: (detail: string) => Applied,
  ignore: (detail: string) => Applied,
): Promise<Applied> {
  if (!canTransition(txn.status, 'refunded')) return ignore(`no effect on ${txn.status}`);

  const adjustment = await recordAdjustment(
    client,
    providerName,
    txn.id,
    event.adjustmentId,
    'chargeback',
  );
  if (!adjustment) return ignore('chargeback already applied');

  await client.query(`UPDATE transaction_adjustments SET amount_cents = $2 WHERE id = $1`, [
    adjustment,
    Math.max(event.amountCents, 0),
  ]);
  await client.query(
    `UPDATE transaction_items
        SET refunded_cents = unit_price_cents, refunded_at = COALESCE(refunded_at, CURRENT_TIMESTAMP)
      WHERE transaction_id = $1`,
    [txn.id],
  );

  let revoked = 0;
  for (const item of items) {
    item.refunded_cents = item.unit_price_cents;
    await applyReversal(client, item);
    revoked += await revokeForItem(client, item.id, 'chargeback');
  }
  await setStatus(client, txn.id, 'refunded');
  return applied(`chargeback; ${revoked} entitlement(s) revoked`);
}

/** Returns the new adjustment row id, or null if this adjustment was seen before. */
async function recordAdjustment(
  client: PoolClient,
  providerName: ProviderName,
  transactionId: string,
  providerAdjustmentId: string,
  kind: 'refund' | 'chargeback',
): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO transaction_adjustments
       (transaction_id, provider, provider_adjustment_id, kind, amount_cents)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (provider, provider_adjustment_id) DO NOTHING
     RETURNING id`,
    [transactionId, providerName, providerAdjustmentId, kind],
  );
  return rows[0]?.id ?? null;
}

/**
 * Brings an item's commission reversals in line with its cumulative refund.
 * No-op while the shares are unknown (fee not reported, or a legacy sale).
 */
async function applyReversal(client: PoolClient, item: ItemRow): Promise<void> {
  if (item.platform_commission_cents === null || item.publisher_earnings_cents === null) return;
  const reversal = reverseShares(
    {
      platformCommissionCents: Number(item.platform_commission_cents),
      publisherEarningsCents: Number(item.publisher_earnings_cents),
    },
    Number(item.unit_price_cents),
    Number(item.refunded_cents),
  );
  await client.query(
    `UPDATE transaction_items
        SET platform_commission_reversed_cents = $2, publisher_earnings_reversed_cents = $3
      WHERE id = $1`,
    [item.id, reversal.platformReversedCents, reversal.publisherReversedCents],
  );
}

async function revokeForItem(client: PoolClient, itemId: string, reason: string): Promise<number> {
  const result = await client.query(
    `UPDATE entitlements
        SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, revocation_reason = $2
      WHERE source_item_id = $1 AND status = 'active'`,
    [itemId, reason],
  );
  return result.rowCount ?? 0;
}

async function setStatus(client: PoolClient, transactionId: string, status: TransactionStatus) {
  await client.query(`UPDATE transactions SET status = $2 WHERE id = $1`, [transactionId, status]);
}

async function flagForReview(client: PoolClient, transactionId: string, reason: string) {
  logger.warn('transaction flagged for review', { transactionId, reason });
  await client.query(
    `UPDATE transactions
        SET review_reason = CASE WHEN review_reason IS NULL THEN $2 ELSE review_reason || '; ' || $2 END
      WHERE id = $1`,
    [transactionId, reason],
  );
}
