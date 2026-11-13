import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkoutSchema,
  listTransactionsQuerySchema,
  transactionIdParamSchema,
} from './transactions';

describe('Transactions Validation Schemas', () => {
  const validUuid = '123e4567-e89b-12d3-a456-426614174000';

  describe('listTransactionsQuerySchema', () => {
    it('applies pagination defaults', () => {
      const parsed = listTransactionsQuerySchema.parse({});
      assert.equal(parsed.page, 1);
      assert.equal(parsed.limit, 20);
    });

    it('coerces and validates custom page and limit', () => {
      const parsed = listTransactionsQuerySchema.parse({ page: '2', limit: '50' });
      assert.equal(parsed.page, 2);
      assert.equal(parsed.limit, 50);
    });

    it('rejects invalid limit (>100) or non-positive page', () => {
      assert.throws(() => listTransactionsQuerySchema.parse({ limit: 101 }));
      assert.throws(() => listTransactionsQuerySchema.parse({ page: 0 }));
    });
  });

  describe('checkoutSchema', () => {
    it('accepts valid bookId and optional parameters', () => {
      const parsed = checkoutSchema.parse({
        bookId: validUuid,
        paymentMethodToken: 'pm_card_visa_123',
        idempotencyKey: 'client-key-456',
      });
      assert.equal(parsed.bookId, validUuid);
      assert.equal(parsed.paymentMethodToken, 'pm_card_visa_123');
      assert.equal(parsed.idempotencyKey, 'client-key-456');
    });

    it('rejects invalid bookId', () => {
      assert.throws(() => checkoutSchema.parse({ bookId: 'invalid-uuid' }));
    });
  });

  describe('transactionIdParamSchema', () => {
    it('validates UUID for id param', () => {
      const parsed = transactionIdParamSchema.parse({ id: validUuid });
      assert.equal(parsed.id, validUuid);
    });

    it('rejects non-UUID id param', () => {
      assert.throws(() => transactionIdParamSchema.parse({ id: 'abc' }));
    });
  });
});
