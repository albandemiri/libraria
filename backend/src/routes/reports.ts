import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errors';
import { pool } from '../db/pool';
import { type ItemStatus, METRICS_SQL, type ReportFilters, salesBase } from '../reports/base';
import { CSV_HEADERS, type SalesLine, toCsvRow } from '../reports/csv';
import { type Metrics, toMetrics } from '../reports/metrics';
import { coverThumbUrl } from './publisher-books';
import { resolvePublisherScope } from './publisher-scope';

export const reportsRouter = Router();

// Financial data: never stored by a browser cache or shared proxy.
reportsRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, 'Not a real date');

export const rangeQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    // Admin-only; ignored for publisher accounts, which are always scoped.
    publisherId: z.string().uuid('Not a valid publisher id').optional(),
  })
  .superRefine((value, ctx) => {
    const from = new Date(`${value.from}T00:00:00Z`);
    const to = new Date(`${value.to}T00:00:00Z`);
    if (to <= from) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
      return;
    }
    const limit = new Date(from);
    limit.setUTCFullYear(limit.getUTCFullYear() + 3);
    if (to > limit) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'Range cannot exceed 3 years' });
    }
  });

export const granularitySchema = z.object({
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

type Granularity = z.infer<typeof granularitySchema>['granularity'];

const summaryBookSchema = z.object({ bookId: z.string().uuid('Not a valid book id').optional() });

const STEP = { day: '1 day', week: '1 week', month: '1 month' } as const;

/** Totals and a per-period series for any salesBase scope. Shared with the platform reports. */
export async function summaryReport(base: { sql: string; params: unknown[] }, g: Granularity) {
  const totals = await pool.query(
    `WITH s AS (${base.sql}) SELECT ${METRICS_SQL} FROM s`,
    base.params,
  );
  const series = await pool.query(
    `WITH s AS (${base.sql}),
          periods AS (
            SELECT generate_series(date_trunc('${g}', $2::date::timestamp),
                                   date_trunc('${g}', $3::date::timestamp - interval '1 day'),
                                   interval '${STEP[g]}') AS period
          ),
          bucketed AS (
            SELECT s.*, date_trunc('${g}', s.paid_at AT TIME ZONE 'UTC') AS period FROM s
          )
     SELECT to_char(p.period, 'YYYY-MM-DD') AS period_start, ${METRICS_SQL}
       FROM periods p
       LEFT JOIN bucketed s ON s.period = p.period
      GROUP BY p.period
      ORDER BY p.period`,
    base.params,
  );
  return {
    totals: toMetrics(totals.rows[0]),
    series: series.rows.map((row) => ({
      periodStart: row.period_start as string,
      ...toMetrics(row),
    })),
  };
}

reportsRouter.get('/summary', async (req: Request, res: Response) => {
  const query = rangeQuerySchema.parse(req.query);
  const { granularity: g } = granularitySchema.parse(req.query); // enum-validated, safe to inline
  const publisherId = resolvePublisherScope(req, query.publisherId);
  const { bookId } = summaryBookSchema.parse(req.query);
  const base = salesBase({
    publisherId,
    from: query.from,
    to: query.to,
    ...(bookId !== undefined ? { bookId } : {}),
  });
  res.json(await summaryReport(base, g));
});

const byGrossDesc = (a: Metrics, b: Metrics) => b.grossCents - a.grossCents;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

reportsRouter.get('/by-book', async (req: Request, res: Response) => {
  const query = rangeQuerySchema.parse(req.query);
  const publisherId = resolvePublisherScope(req, query.publisherId);
  const base = salesBase({ publisherId, from: query.from, to: query.to });
  const result = await pool.query(
    `WITH s AS (${base.sql})
     SELECT s.book_id, MAX(s.title) AS title,
            MAX(bk.cover_image_url) AS cover_image_url,
            MAX(bk.cover_thumb_key) AS cover_thumb_key,
            MAX(bk.cover_version) AS cover_version,
            ${METRICS_SQL}
       FROM s JOIN books bk ON bk.id = s.book_id
      GROUP BY s.book_id`,
    base.params,
  );
  const rows = result.rows
    .map((row) => ({
      book: {
        id: row.book_id as string,
        title: row.title as string,
        coverImageUrl: (row.cover_image_url as string | null) ?? null,
        coverThumbUrl: coverThumbUrl(
          row.book_id as string,
          row.cover_thumb_key as string | null,
          row.cover_version as number,
        ),
      },
      ...toMetrics(row),
    }))
    .sort(
      (a, b) => byGrossDesc(a, b) || cmp(a.book.title, b.book.title) || cmp(a.book.id, b.book.id),
    );
  res.json({ rows });
});

reportsRouter.get('/by-country', async (req: Request, res: Response) => {
  const query = rangeQuerySchema.parse(req.query);
  const publisherId = resolvePublisherScope(req, query.publisherId);
  const base = salesBase({ publisherId, from: query.from, to: query.to });
  const result = await pool.query(
    `WITH s AS (${base.sql})
     SELECT s.customer_country AS country, ${METRICS_SQL}
       FROM s GROUP BY s.customer_country`,
    base.params,
  );
  const rows = result.rows
    .map((row) => ({ country: (row.country as string | null) ?? null, ...toMetrics(row) }))
    .sort((a, b) => {
      if (byGrossDesc(a, b)) return byGrossDesc(a, b);
      if (a.country === b.country) return 0;
      if (a.country === null) return 1; // unknown last
      if (b.country === null) return -1;
      return cmp(a.country, b.country);
    });
  res.json({ rows });
});

// ---------------------------------------------------------------------------
// Sales ledger and CSV export
// ---------------------------------------------------------------------------

/** Mutable only so tests can lower the cap without inserting 50,000 rows. */
export const exportLimits = { maxRows: 50_000 };

const salesFilterSchema = z.object({
  bookId: z.string().uuid('Not a valid book id').optional(),
  // "unknown" selects sales whose buyer country is not known.
  country: z
    .string()
    .regex(/^([A-Za-z]{2}|unknown)$/, 'Use a 2-letter country code or "unknown"')
    .optional(),
  status: z.enum(['paid', 'partially_refunded', 'refunded', 'disputed']).optional(),
  q: z.string().trim().min(1).max(100).optional(),
});

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const csvLangSchema = z.object({ lang: z.enum(['en', 'sq']).default('en') });

function salesFilters(req: Request): { filters: ReportFilters; from: string; to: string } {
  const query = rangeQuerySchema.parse(req.query);
  const extra = salesFilterSchema.parse(req.query);
  const publisherId = resolvePublisherScope(req, query.publisherId);
  const filters: ReportFilters = { publisherId, from: query.from, to: query.to };
  if (extra.bookId !== undefined) filters.bookId = extra.bookId;
  if (extra.status !== undefined) filters.status = extra.status;
  if (extra.q !== undefined) filters.q = extra.q;
  if (extra.country !== undefined) {
    filters.country = extra.country === 'unknown' ? null : extra.country.toUpperCase();
  }
  return { filters, from: query.from, to: query.to };
}

const LINE_COLUMNS = `s.item_id, s.refunded_at, s.paid_at, s.transaction_id, s.book_id, s.title, s.customer_country,
       s.item_status, s.gross_cents, s.tax_cents, s.raw_fee_cents, s.commission_rate_bps,
       (s.commission_cents - s.commission_reversed_cents) AS line_commission_cents,
       s.commission_cents AS commission_at_sale_cents,
       s.commission_reversed_cents,
       (s.earnings_cents - s.earnings_reversed_cents) AS line_earnings_cents,
       s.earnings_cents AS earnings_at_sale_cents,
       s.earnings_reversed_cents,
       s.refunds_cents, s.split`;

// Newest first; the item id makes ties deterministic.
const LINE_ORDER = 'ORDER BY s.paid_at DESC, s.item_id';

function toSalesLine(row: Record<string, unknown>): SalesLine {
  const nullableNumber = (value: unknown) => (value === null ? null : Number(value));
  return {
    itemId: row.item_id as string,
    refundedAt: row.refunded_at === null ? null : (row.refunded_at as Date).toISOString(),
    paidAt: (row.paid_at as Date).toISOString(),
    transactionId: row.transaction_id as string,
    book: { id: row.book_id as string, title: row.title as string },
    country: (row.customer_country as string | null) ?? null,
    status: row.item_status as ItemStatus,
    unitPriceCents: Number(row.gross_cents),
    taxCents: Number(row.tax_cents),
    feeCents: nullableNumber(row.raw_fee_cents),
    commissionRateBps: nullableNumber(row.commission_rate_bps),
    commissionCents: Number(row.line_commission_cents),
    commissionAtSaleCents: Number(row.commission_at_sale_cents),
    commissionReversedCents: Number(row.commission_reversed_cents),
    earningsCents: Number(row.line_earnings_cents),
    earningsAtSaleCents: Number(row.earnings_at_sale_cents),
    earningsReversedCents: Number(row.earnings_reversed_cents),
    refundedCents: Number(row.refunds_cents),
    split: row.split as SalesLine['split'],
  };
}

reportsRouter.get('/sales', async (req: Request, res: Response) => {
  const { filters } = salesFilters(req);
  const { page, limit } = pageSchema.parse(req.query);
  const base = salesBase(filters);
  const total = await pool.query(
    `WITH s AS (${base.sql}) SELECT COUNT(*)::int AS n FROM s`,
    base.params,
  );
  const count = total.rows[0].n as number;
  const result = await pool.query(
    `WITH s AS (${base.sql})
     SELECT ${LINE_COLUMNS} FROM s ${LINE_ORDER}
     LIMIT $${base.params.length + 1} OFFSET $${base.params.length + 2}`,
    [...base.params, limit, (page - 1) * limit],
  );
  res.json({
    lines: result.rows.map(toSalesLine),
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
  });
});

const ordersPageSchema = z.object({
  page: pageSchema.shape.page,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Filters select ORDERS: an order is listed when any of this publisher's lines in it matches all
// the filters, and it then returns all of this publisher's lines. Paginated by distinct
// transaction. Both CTEs come from salesBase, so tenant scope and rules are the single definition;
// they share $1-$3 (publisher, from, to) and the filtered one adds the filter parameters.
reportsRouter.get('/orders', async (req: Request, res: Response) => {
  const { filters } = salesFilters(req);
  const { page, limit } = ordersPageSchema.parse(req.query);
  const matching = salesBase(filters);
  const all = salesBase({ publisherId: filters.publisherId, from: filters.from, to: filters.to });
  const n = matching.params.length;
  const selected = `selected AS (SELECT f.transaction_id, MAX(f.paid_at) AS order_paid_at
                                   FROM f GROUP BY f.transaction_id)`;
  const total = await pool.query(
    `WITH f AS (${matching.sql}), ${selected} SELECT COUNT(*)::int AS n FROM selected`,
    matching.params,
  );
  const count = total.rows[0].n as number;
  const result = await pool.query(
    `WITH f AS (${matching.sql}), s AS (${all.sql}), ${selected},
          page AS (
            SELECT transaction_id, order_paid_at FROM selected
             ORDER BY order_paid_at DESC, transaction_id
             LIMIT $${n + 1} OFFSET $${n + 2}
          )
     SELECT ${LINE_COLUMNS}
       FROM s JOIN page p ON p.transaction_id = s.transaction_id
      ORDER BY p.order_paid_at DESC, p.transaction_id, s.item_id`,
    [...matching.params, limit, (page - 1) * limit],
  );
  const orders: Array<{ transactionId: string; paidAt: string; lines: SalesLine[] }> = [];
  for (const row of result.rows) {
    const line = toSalesLine(row);
    const last = orders[orders.length - 1];
    if (last && last.transactionId === line.transactionId) last.lines.push(line);
    else orders.push({ transactionId: line.transactionId, paidAt: line.paidAt, lines: [line] });
  }
  res.json({
    orders,
    pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
  });
});

reportsRouter.get('/sales.csv', async (req: Request, res: Response) => {
  const { filters, from, to } = salesFilters(req);
  const { lang } = csvLangSchema.parse(req.query);
  const base = salesBase(filters);
  const result = await pool.query(
    `WITH s AS (${base.sql})
     SELECT ${LINE_COLUMNS} FROM s ${LINE_ORDER} LIMIT $${base.params.length + 1}`,
    [...base.params, exportLimits.maxRows + 1],
  );
  if (result.rows.length > exportLimits.maxRows) {
    throw new AppError(
      422,
      `This export has more than ${exportLimits.maxRows} rows. Narrow the date range or add filters.`,
      'EXPORT_TOO_LARGE',
    );
  }
  const lines = [
    CSV_HEADERS[lang].join(','),
    ...result.rows.map((row) => toCsvRow(toSalesLine(row))),
  ];
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="libraria-sales-${from}-${to}.csv"`);
  res.send(`﻿${lines.join('\r\n')}\r\n`);
});
