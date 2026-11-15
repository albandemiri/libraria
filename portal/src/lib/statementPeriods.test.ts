import { describe, expect, it } from 'vitest';
import {
  isInProgress,
  monthRange,
  monthsOfYear,
  weeksOfMonth,
  yearRange,
} from './statementPeriods';

describe('weeksOfMonth', () => {
  const cases: Array<[string, number, number, number]> = [
    ['February 2027 (28 days)', 2027, 1, 28],
    ['February 2028 (29 days)', 2028, 1, 29],
    ['April 2026 (30 days)', 2026, 3, 30],
    ['March 2026 (31 days)', 2026, 2, 31],
    // October 2026 starts on a Thursday, mid-week.
    ['October 2026 (31 days, starts mid-week)', 2026, 9, 31],
  ];
  for (const [name, year, month, days] of cases) {
    it(`covers ${name} with no gaps or overlaps`, () => {
      const m = monthRange(year, month);
      const parts = weeksOfMonth(m);
      expect(parts[0].from).toBe(m.from);
      expect(parts[parts.length - 1].to).toBe(m.to);
      for (let i = 1; i < parts.length; i++) expect(parts[i].from).toBe(parts[i - 1].to);
      const covered = parts.reduce(
        (sum, p) =>
          sum + (Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000,
        0,
      );
      expect(covered).toBe(days);
      expect(parts).toHaveLength(Math.ceil(days / 7));
    });
  }
});

describe('month and year bounds', () => {
  it('rolls December into the next January', () => {
    expect(monthRange(2026, 11)).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(yearRange(2026)).toEqual({ from: '2026-01-01', to: '2027-01-01' });
  });
  it('lists started months newest first, and none for a future year', () => {
    const today = new Date('2026-11-15T12:00:00Z');
    expect(monthsOfYear(2026, today).map((r) => r.from)[0]).toBe('2026-11-01');
    expect(monthsOfYear(2025, today)).toHaveLength(12);
    expect(monthsOfYear(2027, today)).toHaveLength(0);
  });
  it('reads in-progress in UTC', () => {
    const nov = monthRange(2026, 10);
    expect(isInProgress(nov, new Date('2026-11-30T23:30:00Z'))).toBe(true);
    expect(isInProgress(nov, new Date('2026-12-01T00:30:00Z'))).toBe(false);
  });
});
