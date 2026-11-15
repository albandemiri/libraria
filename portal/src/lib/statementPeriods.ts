import type { DateRange } from './periods';

/** Statements work in whole UTC calendar periods; `to` is exclusive, like every report range. */
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const WEEK_MS = 7 * 86_400_000;

export const monthRange = (year: number, month: number): DateRange => ({
  from: iso(Date.UTC(year, month, 1)),
  to: iso(Date.UTC(year, month + 1, 1)),
});

export const yearRange = (year: number): DateRange => ({
  from: iso(Date.UTC(year, 0, 1)),
  to: iso(Date.UTC(year + 1, 0, 1)),
});

/** The months of `year` that have started, newest first. `today` is the current date (read in UTC). */
export function monthsOfYear(year: number, today: Date): DateRange[] {
  const thisYear = today.getUTCFullYear();
  const last = year < thisYear ? 11 : year === thisYear ? today.getUTCMonth() : -1;
  const out: DateRange[] = [];
  for (let m = last; m >= 0; m--) out.push(monthRange(year, m));
  return out;
}

/** A month cut into 7-day parts (the last one may be shorter), oldest first. */
export function weeksOfMonth(month: DateRange): DateRange[] {
  const start = Date.parse(`${month.from}T00:00:00Z`);
  const end = Date.parse(`${month.to}T00:00:00Z`);
  const out: DateRange[] = [];
  for (let s = start; s < end; s += WEEK_MS) {
    out.push({ from: iso(s), to: iso(Math.min(s + WEEK_MS, end)) });
  }
  return out;
}

/** Whether the period contains today (a UTC date). */
export const isInProgress = (period: DateRange, today: Date) => {
  const day = today.toISOString().slice(0, 10);
  return period.from <= day && day < period.to;
};
