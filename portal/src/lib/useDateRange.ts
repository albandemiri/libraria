import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type DateRange, presetRange } from './periods';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | null): number | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  // Round-trip so impossible dates such as 2026-02-31 (which Date rolls over) are rejected.
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value ? null : ms;
}

function validRange(from: string | null, to: string | null): DateRange | null {
  const a = parseDate(from);
  const b = parseDate(to);
  if (a === null || b === null || from === null || to === null) return null;
  if (b <= a) return null;
  // Same rule as the API's rangeQuerySchema: `to` may be at most three calendar years after `from`.
  const limit = new Date(a);
  limit.setUTCFullYear(limit.getUTCFullYear() + 3);
  if (b > limit.getTime()) return null;
  return { from, to };
}

/** Query params that only make sense inside one range; a range change clears them. */
const RANGE_BOUND_PARAMS = ['book', 'country', 'page'];

const fallbackRange = () => presetRange('this_month', new Date());

/**
 * The one date range shared by every range page, kept in the URL as `?from&to`. Anything invalid
 * reads as this month, so no page ever sends a bad range. This hook never writes the URL on
 * its own; `useRangeUrlRewrite` (called once, by the shell) tidies a bad URL.
 */
export function useDateRange(): { range: DateRange; setRange: (next: DateRange) => void } {
  const [params, setParams] = useSearchParams();
  const from = params.get('from');
  const to = params.get('to');

  const parsed = useMemo(() => validRange(from, to), [from, to]);
  const fallback = useMemo(fallbackRange, []);
  const range = parsed ?? fallback;

  const setRange = useCallback(
    (next: DateRange) => {
      setParams((prev) => {
        const out = new URLSearchParams(prev);
        out.set('from', next.from);
        out.set('to', next.to);
        // Filters whose options come from the range (book, country) and the page number belong
        // to the old range, so they go in the same URL write; no request mixes old and new.
        for (const key of RANGE_BOUND_PARAMS) out.delete(key);
        return out;
      });
    },
    [setParams],
  );

  return { range, setRange };
}

/** Rewrites a missing or invalid `?from&to` to the default range, once. Owned by the shell. */
export function useRangeUrlRewrite(enabled: boolean): void {
  const [params, setParams] = useSearchParams();
  const valid = validRange(params.get('from'), params.get('to')) !== null;
  useEffect(() => {
    if (!enabled || valid) return;
    const fallback = fallbackRange();
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('from', fallback.from);
        next.set('to', fallback.to);
        return next;
      },
      { replace: true },
    );
  }, [enabled, valid, setParams]);
}
