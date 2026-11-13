import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reverseShares, splitEarnings } from './commission';

const split = (platformCommissionCents: number, publisherEarningsCents: number) => ({
  platformCommissionCents,
  publisherEarningsCents,
});
const reversal = (platformReversedCents: number, publisherReversedCents: number) => ({
  platformReversedCents,
  publisherReversedCents,
});

/** A sale with neither VAT nor a fee: the whole price is the base. */
const untaxed = (priceCents: number) => ({ priceCents, taxCents: 0, feeCents: 0 });

describe('splitEarnings', () => {
  it('takes the rate from what is left after VAT and fees', () => {
    assert.deepEqual(splitEarnings(untaxed(1000), 2000), split(200, 800));
    assert.deepEqual(splitEarnings(untaxed(1000), 1750), split(175, 825));
    // €10 with €1.67 VAT and a €1.00 fee leaves a base of €7.33.
    assert.deepEqual(
      splitEarnings({ priceCents: 1000, taxCents: 167, feeCents: 100 }, 2000),
      split(146, 587),
    );
  });

  it('rounds Libraria down, so the publisher gets the odd cent', () => {
    assert.deepEqual(splitEarnings(untaxed(733), 2000), split(146, 587));
  });

  it('handles 0% and 100% contracts', () => {
    assert.deepEqual(splitEarnings(untaxed(1000), 0), split(0, 1000));
    assert.deepEqual(splitEarnings(untaxed(1000), 10000), split(1000, 0));
  });

  it('returns null while the provider fee, and so the base, is unknown', () => {
    assert.equal(splitEarnings({ priceCents: 1000, taxCents: 0, feeCents: null }, 2000), null);
  });

  it('takes nothing when fees consume the whole price', () => {
    assert.deepEqual(
      splitEarnings({ priceCents: 50, taxCents: 0, feeCents: 50 }, 2000),
      split(0, 0),
    );
    assert.deepEqual(
      splitEarnings({ priceCents: 50, taxCents: 0, feeCents: 70 }, 2000),
      split(0, -20),
    );
  });

  it('rejects rates outside 0..10000 basis points or not whole', () => {
    assert.throws(() => splitEarnings(untaxed(1000), -1), RangeError);
    assert.throws(() => splitEarnings(untaxed(1000), 10001), RangeError);
    assert.throws(() => splitEarnings(untaxed(1000), 12.5), RangeError);
  });
});

describe('reverseShares', () => {
  it('reverses nothing before a refund and everything on a full refund', () => {
    assert.deepEqual(reverseShares(split(200, 800), 1000, 0), reversal(0, 0));
    assert.deepEqual(reverseShares(split(200, 800), 1000, 1000), reversal(200, 800));
  });

  it('reverses in proportion, rounding in the publisher’s favour', () => {
    assert.deepEqual(reverseShares(split(146, 587), 1000, 333), reversal(49, 195));
  });

  it('never drifts across several partial refunds', () => {
    const shares = split(146, 587);
    let previous = reversal(0, 0);
    for (const refunded of [100, 350, 999, 1000]) {
      const current = reverseShares(shares, 1000, refunded);
      assert.ok(current.platformReversedCents >= previous.platformReversedCents);
      assert.ok(current.publisherReversedCents >= previous.publisherReversedCents);
      assert.ok(current.platformReversedCents <= shares.platformCommissionCents);
      assert.ok(current.publisherReversedCents <= shares.publisherEarningsCents);
      previous = current;
    }
    assert.deepEqual(previous, reversal(146, 587));
  });

  it('handles free items and negative publisher shares', () => {
    assert.deepEqual(reverseShares(split(0, 0), 0, 0), reversal(0, 0));
    assert.deepEqual(reverseShares(split(0, -20), 500, 500), reversal(0, -20));
  });
});
