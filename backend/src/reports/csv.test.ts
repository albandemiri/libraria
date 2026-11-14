import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CSV_HEADERS, csvField, formatCents, toCsvRow } from './csv';
import type { SalesLine } from './csv';

const line: SalesLine = {
  paidAt: '2026-11-05T10:00:00.000Z',
  transactionId: 't1',
  book: { id: 'b1', title: 'Plain' },
  country: 'AL',
  status: 'paid',
  unitPriceCents: 1999,
  taxCents: 5,
  feeCents: null,
  commissionRateBps: 2050,
  commissionCents: 0,
  earningsCents: -20,
  refundedCents: 0,
  split: 'pending',
};

describe('csvField', () => {
  it('quotes commas and quotes per RFC 4180', () => {
    assert.equal(csvField('Tom, "Jerry"'), '"Tom, ""Jerry"""');
  });
  it('neutralises formula characters', () => {
    assert.equal(csvField('=SUM(A1)'), "'=SUM(A1)");
    assert.equal(csvField('+1'), "'+1");
    assert.equal(csvField('-1'), "'-1");
    assert.equal(csvField('@x'), "'@x");
  });
  it('quotes line breaks', () => {
    assert.equal(csvField('line\nbreak'), '"line\nbreak"');
  });
  it('renders null as empty and numbers as-is', () => {
    assert.equal(csvField(null), '');
    assert.equal(csvField(7), '7');
  });
});

describe('formatCents', () => {
  it('uses integer arithmetic including negatives', () => {
    assert.equal(formatCents(1999), '19.99');
    assert.equal(formatCents(5), '0.05');
    assert.equal(formatCents(-20), '-0.20');
    assert.equal(formatCents(0), '0.00');
    assert.equal(formatCents(-123456), '-1234.56');
  });
});

describe('toCsvRow', () => {
  it('formats a line in column order', () => {
    assert.equal(
      toCsvRow(line),
      '2026-11-05T10:00:00.000Z,t1,b1,Plain,AL,paid,19.99,0.05,,20.50,0.00,-0.20,0.00,pending',
    );
  });
});

describe('CSV_HEADERS', () => {
  it('has 14 columns in both languages', () => {
    assert.equal(CSV_HEADERS.en.length, 14);
    assert.equal(CSV_HEADERS.sq.length, 14);
  });
});
