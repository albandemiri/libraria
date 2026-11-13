import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRateSchema } from './admin';

describe('createRateSchema', () => {
  it('accepts a whole number of basis points with optional date and reference', () => {
    assert.deepEqual(createRateSchema.parse({ rateBps: 1750 }), { rateBps: 1750 });
    const full = createRateSchema.parse({
      rateBps: 2000,
      effectiveFrom: '2027-01-01T00:00:00Z',
      contractReference: '  Contract 2027/14  ',
    });
    assert.equal(full.contractReference, 'Contract 2027/14');
  });

  it('rejects rates outside 0..10000 or with fractions', () => {
    for (const rateBps of [10001, -1, 12.5]) {
      assert.equal(createRateSchema.safeParse({ rateBps }).success, false, String(rateBps));
    }
  });

  it('rejects an overlong reference and a non-ISO date', () => {
    assert.equal(
      createRateSchema.safeParse({ rateBps: 2000, contractReference: 'x'.repeat(201) }).success,
      false,
    );
    assert.equal(
      createRateSchema.safeParse({ rateBps: 2000, effectiveFrom: 'next tuesday' }).success,
      false,
    );
  });

  it('rejects start dates the database cannot store as a 400, not a 500', () => {
    // ISO-valid, but Postgres has no year 0.
    for (const effectiveFrom of ['0000-01-01T00:00:00Z', '1969-12-31T23:59:59Z']) {
      assert.equal(
        createRateSchema.safeParse({ rateBps: 2000, effectiveFrom }).success,
        false,
        effectiveFrom,
      );
    }
    assert.equal(
      createRateSchema.safeParse({ rateBps: 2000, effectiveFrom: '1970-01-01T00:00:00Z' }).success,
      true,
    );
  });
});
