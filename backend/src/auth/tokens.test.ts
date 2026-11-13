import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { signAccessToken, verifyAccessToken } from './tokens';

describe('Auth Tokens', () => {
  const validContext = {
    userId: '123e4567-e89b-12d3-a456-426614174000',
    role: 'reader' as const,
    publisherId: null,
  };

  it('signs and verifies a valid reader token', () => {
    const token = signAccessToken(validContext);
    assert.ok(typeof token === 'string' && token.length > 0);

    const verified = verifyAccessToken(token);
    assert.deepEqual(verified, validContext);
  });

  it('signs and verifies a valid publisher token', () => {
    const publisherContext = {
      userId: '123e4567-e89b-12d3-a456-426614174001',
      role: 'publisher' as const,
      publisherId: '123e4567-e89b-12d3-a456-426614174002',
    };

    const token = signAccessToken(publisherContext);
    const verified = verifyAccessToken(token);
    assert.deepEqual(verified, publisherContext);
  });

  it('returns null for an invalid or tampered token', () => {
    assert.equal(verifyAccessToken('invalid.jwt.token'), null);
    assert.equal(verifyAccessToken(''), null);
  });
});
