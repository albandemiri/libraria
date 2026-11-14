export type PresetId = 'this_month' | 'last_month' | 'last_90_days' | 'this_year';
export type DateRange = { from: string; to: string };
export type Granularity = 'day' | 'week' | 'month';

const DAY_MS = 86_400_000;

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const parse = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Ranges are UTC dates; `to` is exclusive. */
export function presetRange(id: PresetId, today: Date): DateRange {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  switch (id) {
    case 'this_month':
      return { from: iso(Date.UTC(y, m, 1)), to: iso(Date.UTC(y, m + 1, 1)) };
    case 'last_month':
      return { from: iso(Date.UTC(y, m - 1, 1)), to: iso(Date.UTC(y, m, 1)) };
    case 'last_90_days': {
      const tomorrow = Date.UTC(y, m, today.getUTCDate() + 1);
      return { from: iso(tomorrow - 90 * DAY_MS), to: iso(tomorrow) };
    }
    case 'this_year':
      return { from: iso(Date.UTC(y, 0, 1)), to: iso(Date.UTC(y + 1, 0, 1)) };
  }
}

/** The same number of days immediately before `range`. */
export function previousRange(range: DateRange): DateRange {
  const from = parse(range.from);
  const to = parse(range.to);
  return { from: iso(from - (to - from)), to: range.from };
}

export function granularityFor(range: DateRange): Granularity {
  const days = Math.round((parse(range.to) - parse(range.from)) / DAY_MS);
  if (days <= 62) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}
