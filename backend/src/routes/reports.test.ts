import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rangeQuerySchema } from './reports';

describe('rangeQuerySchema', () => {
  it('accepts a one-month range', () => {
    const parsed = rangeQuerySchema.parse({ from: '2026-11-01', to: '2026-12-01' });
    assert.equal(parsed.from, '2026-11-01');
  });

  it('accepts exactly three years', () => {
    assert.ok(rangeQuerySchema.safeParse({ from: '2023-01-01', to: '2026-01-01' }).success);
  });

  it('rejects to equal to or before from', () => {
    assert.equal(
      rangeQuerySchema.safeParse({ from: '2026-11-01', to: '2026-11-01' }).success,
      false,
    );
    assert.equal(
      rangeQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success,
      false,
    );
  });

  it('rejects a span over three years', () => {
    assert.equal(
      rangeQuerySchema.safeParse({ from: '2023-01-01', to: '2026-01-02' }).success,
      false,
    );
  });

  it('rejects non-ISO and impossible dates', () => {
    assert.equal(
      rangeQuerySchema.safeParse({ from: '01/11/2026', to: '2026-12-01' }).success,
      false,
    );
    assert.equal(
      rangeQuerySchema.safeParse({ from: '2026-11-01T00:00:00Z', to: '2026-12-01' }).success,
      false,
    );
    assert.equal(
      rangeQuerySchema.safeParse({ from: '2026-02-30', to: '2026-12-01' }).success,
      false,
    );
  });
});
