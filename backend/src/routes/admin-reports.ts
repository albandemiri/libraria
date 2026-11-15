import { type Request, type Response, Router } from 'express';
import { rateInForceSql } from '../commerce/rates';
import { pool } from '../db/pool';
import { METRICS_SQL, PLATFORM_SCOPE, salesBase } from '../reports/base';
import { toMetrics } from '../reports/metrics';
import { granularitySchema, rangeQuerySchema, summaryReport } from './reports';

/**
 * Platform-wide figures: the publisher reports' own salesBase and METRICS_SQL without the
 * publisher filter, so the by-publisher rows sum exactly to the totals. Mounted by admin.ts.
 */
export const adminReportsRouter = Router();

// Financial data: never stored by a browser cache or shared proxy.
adminReportsRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

adminReportsRouter.get('/summary', async (req: Request, res: Response) => {
  const { from, to } = rangeQuerySchema.parse(req.query);
  const { granularity } = granularitySchema.parse(req.query);
  res.json(await summaryReport(salesBase({ publisherId: PLATFORM_SCOPE, from, to }), granularity));
});

/** One row per publisher, including those with no sales in the period. */
adminReportsRouter.get('/by-publisher', async (req: Request, res: Response) => {
  const { from, to } = rangeQuerySchema.parse(req.query);
  const base = salesBase({ publisherId: PLATFORM_SCOPE, from, to });
  const result = await pool.query(
    `WITH s AS (${base.sql})
     SELECT p.id AS publisher_id, p.name AS publisher_name,
            ${rateInForceSql('p.id')} AS current_rate_bps,
            ${METRICS_SQL}
       FROM publishers p
       LEFT JOIN s ON s.publisher_id = p.id
      GROUP BY p.id, p.name
      ORDER BY COALESCE(SUM(s.gross_cents), 0) DESC, p.name, p.id`,
    base.params,
  );
  res.json({
    rows: result.rows.map((row) => ({
      publisherId: row.publisher_id as string,
      publisherName: row.publisher_name as string,
      currentRateBps: (row.current_rate_bps as number | null) ?? null,
      ...toMetrics(row),
    })),
  });
});
