import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  accountStatus,
  accountStatusCacheSize,
  MAX_CACHE_ENTRIES,
  setAccountStatusLoader,
} from './account-status';

describe('account status cache', () => {
  afterEach(() => setAccountStatusLoader());

  it('never grows beyond its cap', async () => {
    setAccountStatusLoader(async () => 'active');
    for (let i = 0; i < MAX_CACHE_ENTRIES + 50; i++) await accountStatus(`user-${i}`);
    assert.ok(accountStatusCacheSize() <= MAX_CACHE_ENTRIES);
  });

  it('evicts an expired entry and reloads it', async () => {
    let calls = 0;
    let status: 'active' | 'suspended' = 'active';
    setAccountStatusLoader(async () => {
      calls++;
      return status;
    });
    const realNow = Date.now;
    try {
      assert.equal(await accountStatus('u'), 'active');
      assert.equal(await accountStatus('u'), 'active');
      assert.equal(calls, 1);
      status = 'suspended';
      Date.now = () => realNow() + 31_000;
      assert.equal(await accountStatus('u'), 'suspended');
      assert.equal(calls, 2);
    } finally {
      Date.now = realNow;
    }
  });
});
