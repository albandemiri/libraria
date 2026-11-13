import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { signWebhook, verifyWebhookSignature, WebhookVerificationError } from './signature';

const SECRET = 'pdl_ntfset_test_secret';
const BODY = Buffer.from('{"event_id":"evt_1","event_type":"transaction.completed"}');
const NOW = new Date('2026-11-13T10:00:00Z');
const TS = Math.floor(NOW.getTime() / 1000);
const opts = { now: NOW, toleranceSeconds: 5 };

function h1(secret: string, ts: number, body: Buffer) {
  return createHmac('sha256', secret).update(`${ts}:`).update(body).digest('hex');
}

function rejects(header: string | undefined, body = BODY, reason?: RegExp) {
  assert.throws(
    () => verifyWebhookSignature(header, body, SECRET, opts),
    (error: unknown) =>
      error instanceof WebhookVerificationError && (!reason || reason.test(error.reason)),
  );
}

describe('webhook signatures', () => {
  it("accepts Paddle's format: hex HMAC-SHA256 of 'timestamp:rawBody'", () => {
    verifyWebhookSignature(`ts=${TS};h1=${h1(SECRET, TS, BODY)}`, BODY, SECRET, opts);
  });

  it('round-trips with signWebhook', () => {
    verifyWebhookSignature(signWebhook(BODY, SECRET, NOW), BODY, SECRET, opts);
  });

  it('accepts any of several h1 values (secret rotation)', () => {
    const header = `ts=${TS};h1=${h1('old-secret', TS, BODY)};h1=${h1(SECRET, TS, BODY)}`;
    verifyWebhookSignature(header, BODY, SECRET, opts);
  });

  it('rejects a missing header', () => rejects(undefined, BODY, /missing signature/));

  it('rejects a modified body', () => {
    const header = `ts=${TS};h1=${h1(SECRET, TS, BODY)}`;
    rejects(header, Buffer.from(`${BODY.toString()} `), /mismatch/);
  });

  it('rejects a signature made with another secret', () =>
    rejects(`ts=${TS};h1=${h1('attacker', TS, BODY)}`, BODY, /mismatch/));

  it('rejects a replayed request outside the tolerance window', () => {
    const old = TS - 60;
    rejects(`ts=${old};h1=${h1(SECRET, old, BODY)}`, BODY, /tolerance/);
  });

  it('rejects a timestamp from the future beyond tolerance', () => {
    const future = TS + 60;
    rejects(`ts=${future};h1=${h1(SECRET, future, BODY)}`, BODY, /tolerance/);
  });

  it('rejects a signature whose timestamp was swapped', () => {
    // Signed at TS-1, header claims TS: the HMAC covers the timestamp.
    rejects(`ts=${TS};h1=${h1(SECRET, TS - 1, BODY)}`, BODY, /mismatch/);
  });

  it('rejects malformed headers without throwing anything else', () => {
    for (const header of [
      '',
      'garbage',
      'ts=abc;h1=00',
      `ts=${TS}`,
      `ts=${TS};h1=zz`,
      `h1=${'0'.repeat(64)}`,
    ]) {
      rejects(header);
    }
  });
});
