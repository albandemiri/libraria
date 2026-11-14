import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeCountry } from './country';

describe('normalizeCountry', () => {
  it('trims and upper-cases a two-letter code', () => {
    assert.equal(normalizeCountry(' de '), 'DE');
  });

  it('returns null for anything else', () => {
    for (const value of ['DEU', '', null, 42, 'D1']) {
      assert.equal(normalizeCountry(value), null, String(value));
    }
  });
});
