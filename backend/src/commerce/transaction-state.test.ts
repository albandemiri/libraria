import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canTransition, type TransactionStatus, transactionStatuses } from './transaction-state';

describe('transaction state machine', () => {
  it('only lets verified outcomes leave pending', () => {
    for (const to of ['paid', 'failed', 'cancelled', 'expired'] as const) {
      assert.ok(canTransition('pending', to), `pending -> ${to}`);
    }
    for (const to of ['refunded', 'partially_refunded', 'disputed'] as const) {
      assert.ok(!canTransition('pending', to), `pending -> ${to}`);
    }
  });

  it('honours a payment that succeeds after a failed attempt or expiry', () => {
    assert.ok(canTransition('failed', 'paid'));
    assert.ok(canTransition('expired', 'paid'));
  });

  it('treats refunded and cancelled as terminal', () => {
    for (const to of transactionStatuses) {
      assert.ok(!canTransition('refunded', to), `refunded -> ${to}`);
      assert.ok(!canTransition('cancelled', to), `cancelled -> ${to}`);
    }
  });

  it('never moves a paid transaction back to an unpaid state', () => {
    const unpaid: TransactionStatus[] = ['pending', 'failed', 'cancelled', 'expired'];
    for (const from of ['paid', 'partially_refunded', 'disputed'] as const) {
      for (const to of unpaid) {
        assert.ok(!canTransition(from, to), `${from} -> ${to}`);
      }
    }
  });

  it('resolves disputes either way', () => {
    assert.ok(canTransition('paid', 'disputed'));
    assert.ok(canTransition('disputed', 'paid'));
    assert.ok(canTransition('disputed', 'refunded'));
  });

  it('allows successive partial refunds', () => {
    assert.ok(canTransition('paid', 'partially_refunded'));
    assert.ok(canTransition('partially_refunded', 'partially_refunded'));
    assert.ok(canTransition('partially_refunded', 'refunded'));
  });
});
