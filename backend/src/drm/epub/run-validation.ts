import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { WorkerMessage } from './epub-worker-thread';
import type { ValidateResult } from './validate-epub';

export type RunValidationResult =
  | ValidateResult
  | { ok: false; reasonCode: 'PROCESSING_TIMEOUT' | 'PROCESSING_ERROR'; detail: string };

export interface RunValidationOptions {
  /** Wall-clock limit; the thread is terminated when it expires. */
  timeoutMs?: number;
  /** V8 old-generation heap limit for the thread. Default 512 MB. */
  maxOldGenerationSizeMb?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OLD_GENERATION_MB = 512;

/** ASSET_PROCESSING_TIMEOUT_MS (formally added to env.ts in a later task); falls back safely. */
function defaultTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.ASSET_PROCESSING_TIMEOUT_MS ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * Resolves the worker entry next to this module. Under tsx (dev/tests) this
 * module is a .ts file, so the thread is the .ts file too and inherits the
 * parent's execArgv (which carries the tsx loader). After `tsc` the module is
 * a .js file and so is the thread, with no loader needed.
 */
function workerFile(): string {
  const extension = path.extname(__filename);
  return path.join(__dirname, `epub-worker-thread${extension}`);
}

/**
 * Validates an EPUB in a worker thread with a memory limit and a wall-clock
 * timeout. The thread is always terminated before this resolves.
 */
export function runValidation(
  data: Buffer,
  opts: RunValidationOptions = {},
): Promise<RunValidationResult> {
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs();
  const maxOldGenerationSizeMb = opts.maxOldGenerationSizeMb ?? DEFAULT_MAX_OLD_GENERATION_MB;

  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker | undefined;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: RunValidationResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      void worker?.terminate();
      resolve(result);
    };
    const failed = (): RunValidationResult => ({
      ok: false,
      reasonCode: 'PROCESSING_ERROR',
      detail: 'The book could not be processed.',
    });

    try {
      worker = new Worker(workerFile(), {
        // A copy: the caller keeps its buffer, the thread gets its own.
        workerData: { data: new Uint8Array(data) },
        resourceLimits: {
          maxOldGenerationSizeMb,
          maxYoungGenerationSizeMb: 64,
          stackSizeMb: 4,
        },
        stdout: false,
        stderr: false,
      });
    } catch {
      resolve(failed());
      return;
    }

    timer = setTimeout(() => {
      finish({
        ok: false,
        reasonCode: 'PROCESSING_TIMEOUT',
        detail: 'Processing the book took too long.',
      });
    }, timeoutMs);

    worker.on('message', (message: WorkerMessage) => {
      if (message.kind !== 'result') return finish(failed());
      const result = message.result;
      if (result.ok && result.cover) {
        // Structured clone turns Buffers into plain Uint8Arrays.
        const { buffer, byteOffset, byteLength } = result.cover.data;
        result.cover.data = Buffer.from(buffer, byteOffset, byteLength);
      }
      finish(result);
    });
    worker.on('error', () => finish(failed()));
    worker.on('exit', () => finish(failed()));
  });
}
