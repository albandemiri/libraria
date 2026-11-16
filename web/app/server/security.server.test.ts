import { describe, expect, it } from 'vitest';
import { assertSameOrigin } from './security.server';

const ORIGIN = 'http://localhost:5174';

function req(headers: Record<string, string>) {
  return new Request(`${ORIGIN}/gjuha`, { method: 'POST', headers });
}

describe('assertSameOrigin', () => {
  it('rejects a foreign Origin and accepts PUBLIC_ORIGIN', () => {
    expect(() => assertSameOrigin(req({ Origin: ORIGIN }))).not.toThrow();
    try {
      assertSameOrigin(req({ Origin: 'https://evil.example' }));
      expect.unreachable();
    } catch (e) {
      expect((e as Response).status).toBe(403);
    }
  });

  it('rejects an origin that differs in port or scheme', () => {
    for (const origin of ['http://localhost:5175', 'https://localhost:5174', `${ORIGIN}.evil.io`]) {
      expect(() => assertSameOrigin(req({ Origin: origin }))).toThrow();
    }
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(() => assertSameOrigin(req({ Referer: `${ORIGIN}/eksploro?x=1` }))).not.toThrow();
    expect(() => assertSameOrigin(req({ Referer: 'https://evil.example/' }))).toThrow();
    expect(() => assertSameOrigin(req({ Referer: `${ORIGIN}.evil.io/` }))).toThrow();
  });

  it('refuses a request with neither Origin nor Referer', () => {
    expect(() => assertSameOrigin(req({}))).toThrow();
  });
});
