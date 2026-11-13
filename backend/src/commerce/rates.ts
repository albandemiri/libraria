import { pool } from '../db/pool';

/**
 * SQL subquery for one column of the rate in force right now for a
 * publisher: the latest rate that has already started. The one definition of
 * "in force", used by checkout, the storefront and the portal.
 *
 * `publisherIdSql` is a column reference or placeholder written by us (for
 * example `b.publisher_id` or `$1`), never user input.
 */
export function rateInForceSql(
  publisherIdSql: string,
  column: 'rate_bps' | 'id' = 'rate_bps',
): string {
  return `(SELECT r.${column}
             FROM publisher_commission_rates r
            WHERE r.publisher_id = ${publisherIdSql} AND r.effective_from <= CURRENT_TIMESTAMP
            ORDER BY r.effective_from DESC
            LIMIT 1)`;
}

/** A publisher's contract rate as admins and the publisher portal see it. */
export interface CommissionRate {
  id: string;
  rateBps: number;
  effectiveFrom: string;
  contractReference: string | null;
  /** True on exactly one row: the latest one that has already started. */
  inForce: boolean;
}

interface RateRow {
  id: string;
  rate_bps: number;
  effective_from: Date;
  contract_reference: string | null;
  in_force: boolean;
}

/** All rates for a publisher, newest start date first. */
export async function listRates(publisherId: string): Promise<CommissionRate[]> {
  const { rows } = await pool.query<RateRow>(
    `SELECT id, rate_bps, effective_from, contract_reference,
            (id = ${rateInForceSql('$1', 'id')}) IS TRUE AS in_force
       FROM publisher_commission_rates
      WHERE publisher_id = $1
      ORDER BY effective_from DESC`,
    [publisherId],
  );
  return rows.map((row) => ({
    id: row.id,
    rateBps: row.rate_bps,
    effectiveFrom: row.effective_from.toISOString(),
    contractReference: row.contract_reference,
    inForce: row.in_force,
  }));
}
