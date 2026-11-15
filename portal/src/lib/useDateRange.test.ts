import { act, renderHook } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { presetRange } from './periods';
import { useDateRange, useRangeUrlRewrite } from './useDateRange';

function setup(search: string, rewrite = true) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [`/sales${search}`] }, children);
  return renderHook(
    () => {
      const dr = useDateRange();
      useRangeUrlRewrite(rewrite);
      const location = useLocation();
      return { ...dr, search: location.search };
    },
    { wrapper },
  );
}

const fallback = () => presetRange('this_month', new Date());

describe('useDateRange', () => {
  it('parses a valid range from the URL', () => {
    const { result } = setup('?from=2026-01-01&to=2026-03-01');
    expect(result.current.range).toEqual({ from: '2026-01-01', to: '2026-03-01' });
    expect(result.current.search).toBe('?from=2026-01-01&to=2026-03-01');
  });

  it('defaults to this month when the URL has no range, and writes it', () => {
    const { result } = setup('');
    const def = fallback();
    expect(result.current.range).toEqual(def);
    expect(result.current.search).toBe(`?from=${def.from}&to=${def.to}`);
  });

  it.each([
    ['reversed', '?from=2026-03-01&to=2026-01-01'],
    ['empty', '?from=2026-03-01&to=2026-03-01'],
    ['over three years', '?from=2022-01-01&to=2026-01-02'],
    ['garbage', '?from=abc&to=2026-01-01'],
    ['impossible date', '?from=2026-02-31&to=2026-03-31'],
  ])('falls back to the default and rewrites the URL for a %s range', (_name, search) => {
    const { result } = setup(search);
    const def = fallback();
    expect(result.current.range).toEqual(def);
    expect(result.current.search).toBe(`?from=${def.from}&to=${def.to}`);
  });

  it('keeps other query params when rewriting', () => {
    const { result } = setup('?q=x&from=abc&to=def');
    const def = fallback();
    const params = new URLSearchParams(result.current.search);
    expect(params.get('q')).toBe('x');
    expect(params.get('from')).toBe(def.from);
  });

  it('accepts exactly three calendar years, like the API, and no more', () => {
    expect(setup('?from=2026-01-01&to=2029-01-01').result.current.range.to).toBe('2029-01-01');
    expect(setup('?from=2026-01-01&to=2029-01-02').result.current.range).toEqual(fallback());
  });

  it('clears range-bound filters and the page when the range changes, keeps the rest', () => {
    const { result } = setup(
      '?from=2026-01-01&to=2026-03-01&q=x&book=b&country=AL&page=3&status=paid',
    );
    act(() => result.current.setRange({ from: '2026-05-01', to: '2026-06-01' }));
    const params = new URLSearchParams(result.current.search);
    expect(params.get('from')).toBe('2026-05-01');
    expect(params.get('q')).toBe('x');
    expect(params.get('status')).toBe('paid');
    expect(params.has('book')).toBe(false);
    expect(params.has('country')).toBe(false);
    expect(params.has('page')).toBe(false);
  });

  it('does not touch the URL when the rewrite is off', () => {
    const { result } = setup('?from=abc&to=def', false);
    expect(result.current.range).toEqual(fallback());
    expect(result.current.search).toBe('?from=abc&to=def');
  });
});
