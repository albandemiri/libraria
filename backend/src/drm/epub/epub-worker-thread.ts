import { parentPort, workerData } from 'node:worker_threads';
import { type ValidateResult, validateEpub } from './validate-epub';

/**
 * Worker thread entry: validates one EPUB and posts the result back. Spawned
 * by run-validation.ts with hard memory limits; the parent enforces the wall
 * clock timeout by terminating this thread.
 */

export type WorkerMessage = { kind: 'result'; result: ValidateResult } | { kind: 'error' };

/**
 * Test hooks, honoured only outside production AND only when the explicit
 * LIBRARIA_EPUB_TEST_HOOKS=1 flag is set. They let tests prove the parent's
 * timeout, error and memory handling against a misbehaving thread.
 */
function runTestHook(data: Buffer): void {
  if (process.env.NODE_ENV === 'production' || process.env.LIBRARIA_EPUB_TEST_HOOKS !== '1') return;
  const marker = data.toString('latin1', 0, 32);
  if (marker.startsWith('__EPUB_TEST_BUSY_LOOP__')) {
    for (;;) {
      // spin until the parent terminates this thread
    }
  }
  if (marker.startsWith('__EPUB_TEST_THROW__')) throw new Error('boom-secret');
  if (marker.startsWith('__EPUB_TEST_OOM__')) {
    const hog: number[][] = [];
    for (;;) hog.push(new Array<number>(1_000_000).fill(1));
  }
}

async function main(): Promise<void> {
  const port = parentPort;
  if (!port) return;
  try {
    const input = workerData as { data: Uint8Array };
    const data = Buffer.from(input.data.buffer, input.data.byteOffset, input.data.byteLength);
    runTestHook(data);
    const result = await validateEpub(data);
    port.postMessage({ kind: 'result', result } satisfies WorkerMessage);
  } catch {
    // The error text could carry internals; the parent only needs to know it failed.
    port.postMessage({ kind: 'error' } satisfies WorkerMessage);
  }
}

void main();
