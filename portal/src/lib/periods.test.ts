import { describe, expect, it } from 'vitest';
import { granularityFor, presetRange, previousRange } from './periods';

const today = new Date('2026-11-13T10:00:00Z');

describe('presetRange', () => {
  it('this_month', () => {
    expect(presetRange('this_month', today)).toEqual({ from: '2026-11-01', to: '2026-12-01' });
  });
  it('last_month', () => {
    expect(presetRange('last_month', today)).toEqual({ from: '2026-10-01', to: '2026-11-01' });
  });
  it('last_90_days ends tomorrow (exclusive) and spans 90 days', () => {
    expect(presetRange('last_90_days', today)).toEqual({ from: '2026-08-16', to: '2026-11-14' });
  });
  it('this_year', () => {
    expect(presetRange('this_year', today)).toEqual({ from: '2026-01-01', to: '2027-01-01' });
  });
  it('last_month rolls over the year boundary', () => {
    expect(presetRange('last_month', new Date('2026-01-05T00:00:00Z'))).toEqual({
      from: '2025-12-01',
      to: '2026-01-01',
    });
  });
});

describe('previousRange', () => {
  it('is the same number of days immediately before (30 days)', () => {
    expect(previousRange({ from: '2026-11-01', to: '2026-12-01' })).toEqual({
      from: '2026-10-02',
      to: '2026-11-01',
    });
  });
  it('is the same number of days immediately before (31 days)', () => {
    expect(previousRange({ from: '2026-10-01', to: '2026-11-01' })).toEqual({
      from: '2026-08-31',
      to: '2026-10-01',
    });
  });
});

describe('granularityFor', () => {
  const range = (days: number) => {
    const from = new Date(Date.UTC(2026, 0, 1));
    const to = new Date(from.getTime() + days * 86_400_000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  };
  it('uses day up to 62 days', () => {
    expect(granularityFor(range(62))).toBe('day');
    expect(granularityFor(range(63))).toBe('week');
  });
  it('uses week up to 366 days', () => {
    expect(granularityFor(range(366))).toBe('week');
    expect(granularityFor(range(367))).toBe('month');
  });
});
