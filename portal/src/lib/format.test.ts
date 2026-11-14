import { describe, expect, it } from 'vitest';
import { countryName, formatDate, formatMoney, formatPercentBps, parseEuroInput } from './format';

describe('parseEuroInput', () => {
  it('parses comma and dot decimals into integer cents', () => {
    expect(parseEuroInput('9,99')).toBe(999);
    expect(parseEuroInput('9.99')).toBe(999);
    expect(parseEuroInput('10')).toBe(1000);
    expect(parseEuroInput('0,5')).toBe(50);
    expect(parseEuroInput(' 0 ')).toBe(0);
    expect(parseEuroInput('19.9')).toBe(1990);
  });
  it('rejects anything else', () => {
    for (const bad of ['abc', '1.234,5', '-1', '', '1,234', '9.999', '1,', ',5', '1e3']) {
      expect(parseEuroInput(bad)).toBeNull();
    }
  });
});

const normalise = (s: string) => s.replace(/[  ]/g, ' ');

describe('formatMoney', () => {
  it('formats English euros', () => {
    expect(formatMoney(123450, 'en')).toContain('€1,234.50');
  });
  it('formats Albanian euros', () => {
    const out = normalise(formatMoney(123450, 'sq'));
    expect(out).toContain('1.234,50');
    expect(out).toContain('€');
  });
});

describe('countryName', () => {
  it('translates a country code', () => {
    const name = countryName('XK', 'sq');
    expect(name).not.toBe('');
    expect(name).not.toBe('XK');
  });
  it('returns Unknown for null', () => {
    expect(countryName(null, 'en')).toBe('Unknown');
  });
  it('returns the translated Unknown for null in Albanian', () => {
    expect(countryName(null, 'sq')).not.toBe('Unknown');
  });
});

describe('formatDate', () => {
  it('formats in UTC', () => {
    expect(formatDate('2026-11-30T23:30:00Z', 'en')).toContain('30');
  });
});

describe('formatPercentBps', () => {
  it('formats basis points as a percentage', () => {
    expect(normalise(formatPercentBps(1250, 'en'))).toBe('12.5%');
  });
});
