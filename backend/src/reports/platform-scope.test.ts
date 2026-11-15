import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLATFORM_SCOPE, salesBase } from './base';

const range = { from: '2025-03-01', to: '2025-04-01' };

describe('salesBase scope', () => {
  it('fails closed unless given a publisher uuid or PLATFORM_SCOPE', () => {
    for (const bad of [null, undefined, '', 'platform', 'all', 'not-a-uuid', 0]) {
      assert.throws(
        // biome-ignore lint/suspicious/noExplicitAny: feeding deliberately wrong values.
        () => salesBase({ publisherId: bad as any, ...range }),
        /publisher id or PLATFORM_SCOPE/,
        String(bad),
      );
    }
  });

  it('scopes to one publisher by default and to everyone only for PLATFORM_SCOPE', () => {
    const one = salesBase({ publisherId: '11111111-1111-4111-8111-111111111111', ...range });
    assert.match(one.sql, /ti\.publisher_id = \$1/);
    const all = salesBase({ publisherId: PLATFORM_SCOPE, ...range });
    assert.match(all.sql, /\$1::uuid IS NULL/);
    assert.equal(all.params[0], null);
  });
});
