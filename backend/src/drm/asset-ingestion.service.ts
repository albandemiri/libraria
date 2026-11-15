import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { isPgError, PG_UNIQUE_VIOLATION } from '../db/errors';
import { pool, withTransaction } from '../db/pool';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/errors';
import type { AssetRow, AssetState } from './asset-repository';
import { audit } from './drm.audit';
import { assetAad, encryptAsset } from './encryption.service';
import { runValidation } from './epub/run-validation';
import { keyManagement } from './key-management.service';
import { malwareScanner } from './malware-scanner';
import { objectStorage } from './object-storage';

/**
 * Asset ingestion: upload -> validating -> scanning -> encrypting -> storing -> ready.
 *
 * Job state machine (asset_jobs): queued -> running -> done | failed.
 * - A claim moves queued -> running and counts an attempt.
 * - A retryable error puts the job back to queued with backoff (30 s, then 2 min);
 *   after MAX_ATTEMPTS the job and the asset become `failed` and the original is kept.
 * - A rejection (bad EPUB, malware) is final: asset `rejected`, job `done`.
 * - A job left `running` by a crashed worker is reclaimed once its lock is older
 *   than 3x the processing timeout; its next claim counts as another attempt, so a
 *   job that keeps killing the worker still ends `failed`.
 * - Fencing: every claim writes a new `lease_id`. Each state write of a run is
 *   conditional on its lease, and the completion/rejection/failure transactions
 *   lock the job row first and abort if the lease changed. A heartbeat detects a
 *   lost lease and aborts the run; a wall-clock cap aborts a hung one (retryable).
 */

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [30_000, 120_000];
const FAILED_ORIGINAL_RETENTION_DAYS = 7;

const quarantineKey = (assetId: string) => `quarantine/${assetId}`;
/**
 * One object per claim. The lease id makes the key unique even when an admin retry
 * restarts the attempt counter, so no run can ever write over or delete the object
 * another run committed.
 */
const assetKey = (assetId: string, version: number, attempt: number, leaseId: string) =>
  `assets/${assetId}/v${version}/a${attempt}-${leaseId}`;
const coverKey = (bookId: string, assetId: string) => `covers/${bookId}/${assetId}`;

/** An error worth retrying (scanner down, worker thread died, storage hiccup). */
class RetryableError extends Error {
  constructor(
    readonly reasonCode: string,
    readonly reasonDetail: string,
    cause?: unknown,
  ) {
    super(reasonDetail, { cause });
    this.name = 'RetryableError';
  }
}

/** This run no longer owns its job (it was reclaimed): stop, and change nothing. */
class LeaseLostError extends Error {
  constructor() {
    super('Job lease lost');
    this.name = 'LeaseLostError';
  }
}

/** An error that retrying cannot fix (the original is gone, attempts used up). */
class TerminalError extends Error {
  constructor(
    readonly reasonCode: string,
    readonly reasonDetail: string,
  ) {
    super(reasonDetail);
    this.name = 'TerminalError';
  }
}

const TERMINAL_STATES = `('ready', 'rejected', 'failed')`;

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Creates version n+1 in state `uploaded`, parks the original in quarantine and
 * queues the job. Throws 404 for an unknown book and 409 ASSET_PROCESSING when
 * the book already has an asset in flight.
 */
export async function enqueueUpload(
  bookId: string,
  uploadedBy: string | null,
  data: Buffer,
): Promise<AssetRow> {
  const assetId = randomUUID();
  const key = quarantineKey(assetId);
  let stored = false;

  try {
    return await withTransaction(async (client) => {
      // Serialises concurrent uploads and activations of one book.
      const book = await client.query('SELECT id FROM books WHERE id = $1 FOR UPDATE', [bookId]);
      if (book.rowCount === 0)
        throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');

      const inFlight = await client.query(
        `SELECT 1 FROM book_assets WHERE book_id = $1 AND state NOT IN ${TERMINAL_STATES}`,
        [bookId],
      );
      if (inFlight.rowCount) throw processingConflict();

      const { rows: versions } = await client.query<{ version: number }>(
        `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM book_assets WHERE book_id = $1`,
        [bookId],
      );
      const version = versions[0].version;

      const { rows } = await client.query<AssetRow>(
        `INSERT INTO book_assets (id, book_id, version, state, original_size_bytes, uploaded_by)
         VALUES ($1, $2, $3, 'uploaded', $4, $5)
         RETURNING *`,
        [assetId, bookId, version, data.length, uploadedBy],
      );
      await client.query(`INSERT INTO asset_jobs (asset_id) VALUES ($1)`, [assetId]);
      await audit(
        {
          actorId: uploadedBy,
          action: 'asset.uploaded',
          resourceType: 'book_asset',
          resourceId: assetId,
          metadata: { bookId, version, sizeBytes: data.length },
        },
        client,
      );

      // Last, so a failed insert never leaves an object behind; the catch below
      // removes it if the commit itself fails.
      await objectStorage().put(key, data);
      stored = true;
      return rows[0];
    });
  } catch (error) {
    if (stored)
      await objectStorage()
        .delete(key)
        .catch(() => undefined);
    if (isPgError(error, PG_UNIQUE_VIOLATION)) throw processingConflict();
    throw error;
  }
}

function processingConflict(): AppError {
  return new AppError(
    409,
    'This book already has an upload in progress. Wait for it to finish.',
    'ASSET_PROCESSING',
  );
}

const TERMINAL_ASSET_STATES = ['ready', 'rejected', 'failed'];

/**
 * Enqueues and processes in one go, for the seed and tests. Returns the asset as it ended up.
 * With `waitMs`, an idle queue (another worker holds the job, or a retry is backing off) is not
 * the end: it keeps working and polling until the asset is terminal or the time is up.
 */
export async function ingestNow(
  bookId: string,
  uploadedBy: string | null,
  data: Buffer,
  options: { waitMs?: number } = {},
): Promise<AssetRow> {
  const asset = await enqueueUpload(bookId, uploadedBy, data);
  for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
    const outcome = await processNextJob();
    const current = await getAsset(asset.id);
    if (TERMINAL_ASSET_STATES.includes(current.state)) return current;
    if (outcome === 'idle') break;
  }
  return waitForTerminalAsset(asset.id, options.waitMs ?? 0);
}

/** Polls (and helps with the queue) until the asset is terminal or `waitMs` has passed. */
export async function waitForTerminalAsset(
  assetId: string,
  waitMs: number,
  pollMs = 250,
): Promise<AssetRow> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const current = await getAsset(assetId);
    if (TERMINAL_ASSET_STATES.includes(current.state) || Date.now() >= deadline) return current;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    await processNextJob();
  }
}

async function getAsset(assetId: string): Promise<AssetRow> {
  const { rows } = await pool.query<AssetRow>('SELECT * FROM book_assets WHERE id = $1', [assetId]);
  if (!rows[0]) throw new AppError(404, 'Asset not found', 'NOT_FOUND');
  return rows[0];
}

// ---------------------------------------------------------------------------
// Claiming and running jobs
// ---------------------------------------------------------------------------

interface ClaimedJob {
  id: string;
  assetId: string;
  attempts: number;
  /** Written at the claim. Every write of this run is conditional on it still being current. */
  leaseId: string;
}

interface RunContext {
  job: ClaimedJob;
  signal: AbortSignal;
  /** Rejects as soon as the run is aborted (lease lost, wall-clock cap), whatever `p` is doing. */
  guard<T>(p: Promise<T>): Promise<T>;
  /** Objects this run wrote and no committed asset points at yet. */
  objectKeys: string[];
  pendingPut?: Promise<unknown>;
  committed: boolean;
}

interface JobTimings {
  capMs: number;
  heartbeatMs: number;
}

let timingsOverride: JobTimings | null = null;

/** Test seam: shorter wall-clock cap and heartbeat interval; null restores the defaults. */
export function setJobTimingsForTests(timings: JobTimings | null): void {
  timingsOverride = timings;
}

/**
 * Longest one run may take: the validation thread (1x), scanner (clamd timeout),
 * and generous headroom for storage and KMS (2x). A run that heartbeats past it
 * is hung, so it is aborted and retried instead of blocking the book forever.
 */
const wallClockCapMs = () =>
  timingsOverride?.capMs ?? 3 * env.ASSET_PROCESSING_TIMEOUT_MS + env.CLAMAV_TIMEOUT_MS;
const heartbeatIntervalMs = () =>
  timingsOverride?.heartbeatMs ?? Math.max(1000, env.ASSET_PROCESSING_TIMEOUT_MS);

/**
 * Claims one due job. FOR UPDATE SKIP LOCKED lets several workers poll
 * concurrently without ever taking the same job; a `running` job whose lock has
 * gone stale (worker crashed or hung) is claimable again. Each claim gets a new
 * lease id, which fences out whoever held the job before.
 */
async function claimJob(): Promise<ClaimedJob | null> {
  const staleSeconds = (3 * env.ASSET_PROCESSING_TIMEOUT_MS) / 1000;
  const leaseId = randomUUID();
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM asset_jobs
        WHERE (state = 'queued' AND run_after <= NOW())
           OR (state = 'running' AND locked_at < NOW() - $1::double precision * interval '1 second')
        ORDER BY run_after, created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
      [staleSeconds],
    );
    if (!rows[0]) return null;
    const claimed = await client.query<{ id: string; asset_id: string; attempts: number }>(
      `UPDATE asset_jobs
          SET state = 'running', locked_at = NOW(), attempts = attempts + 1, lease_id = $2
        WHERE id = $1
    RETURNING id, asset_id, attempts`,
      [rows[0].id, leaseId],
    );
    const job = claimed.rows[0];
    return { id: job.id, assetId: job.asset_id, attempts: job.attempts, leaseId };
  });
}

/**
 * Locks the job row and checks the run still owns it. Completion, rejection and
 * failure transactions start with this, so a fenced-out run aborts before it
 * can write anything.
 */
async function lockLease(client: PoolClient, job: ClaimedJob): Promise<void> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM asset_jobs WHERE id = $1 AND state = 'running' AND lease_id = $2 FOR UPDATE`,
    [job.id, job.leaseId],
  );
  if (!rowCount) throw new LeaseLostError();
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Claims and runs at most one job. */
export async function processNextJob(): Promise<'processed' | 'idle'> {
  const job = await claimJob();
  if (!job) return 'idle';

  const controller = new AbortController();
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
      once: true,
    });
  });
  aborted.catch(() => undefined);
  const ctx: RunContext = {
    job,
    signal: controller.signal,
    guard: (p) => Promise.race([p, aborted]),
    objectKeys: [],
    committed: false,
  };

  // While we work the lock must not look stale to another worker, and if the
  // lease is gone anyway (reclaimed) this run must stop rather than carry on.
  const heartbeat = setInterval(() => {
    pool
      .query(
        `UPDATE asset_jobs SET locked_at = NOW()
          WHERE id = $1 AND state = 'running' AND lease_id = $2`,
        [job.id, job.leaseId],
      )
      .then((result) => {
        if (result.rowCount === 0) controller.abort(new LeaseLostError());
      })
      .catch((error) =>
        logger.warn('job heartbeat failed', {
          jobId: job.id,
          errorName: errorName(error),
          errorMessage: errorMessage(error),
        }),
      );
  }, heartbeatIntervalMs());
  heartbeat.unref();
  const cap = setTimeout(
    () =>
      controller.abort(
        new RetryableError('PROCESSING_TIMEOUT', 'Processing the book took too long.'),
      ),
    wallClockCapMs(),
  );
  cap.unref();

  try {
    await processAsset(ctx);
  } catch (error) {
    if (!ctx.committed) await discardOwnObjects(ctx);
    try {
      if (error instanceof LeaseLostError) throw error;
      await handleFailure(job, error);
    } catch (inner) {
      if (!(inner instanceof LeaseLostError)) throw inner;
      // Another run owns the job now; whatever it does is authoritative.
      logger.warn('job lease lost, abandoning run', { jobId: job.id, assetId: job.assetId });
    }
  } finally {
    clearInterval(heartbeat);
    clearTimeout(cap);
  }
  return 'processed';
}

/** Deletes what a run that did not commit wrote, once any in-flight put has settled. */
async function discardOwnObjects(ctx: RunContext): Promise<void> {
  if (ctx.pendingPut) {
    await Promise.race([
      ctx.pendingPut.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5000).unref()),
    ]);
  }
  for (const key of ctx.objectKeys) {
    // Belt and braces: only ever delete an object this claim itself named.
    if (!key.includes(ctx.job.leaseId)) continue;
    await objectStorage()
      .delete(key)
      .catch((error) =>
        logger.warn('could not remove an abandoned object', {
          key,
          errorName: errorName(error),
          errorMessage: errorMessage(error),
        }),
      );
  }
}

/** Moves the asset to a processing state, but only for the current lease holder, never off a terminal state. */
async function setState(ctx: RunContext, state: AssetState): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE book_assets SET state = $2
      WHERE id = $1 AND state NOT IN ${TERMINAL_STATES}
        AND EXISTS (SELECT 1 FROM asset_jobs j
                     WHERE j.id = $3 AND j.state = 'running' AND j.lease_id = $4)`,
    [ctx.job.assetId, state, ctx.job.id, ctx.job.leaseId],
  );
  if (!rowCount) throw new LeaseLostError();
}

/** Lets an abort (lease lost, wall-clock cap) pass through instead of being re-labelled. */
function rethrowIfAborted(ctx: RunContext, error: unknown): void {
  if (ctx.signal.aborted && error === ctx.signal.reason) throw error;
}

async function processAsset(ctx: RunContext): Promise<void> {
  const { job } = ctx;
  const { rows } = await pool.query<AssetRow>('SELECT * FROM book_assets WHERE id = $1', [
    job.assetId,
  ]);
  const asset = rows[0];
  if (!asset || asset.state === 'ready' || asset.state === 'rejected') {
    // Nothing left to do (a duplicate of work already finished).
    await pool.query(
      `UPDATE asset_jobs SET state = 'done', locked_at = NULL
        WHERE id = $1 AND state = 'running' AND lease_id = $2`,
      [job.id, job.leaseId],
    );
    return;
  }
  if (job.attempts > MAX_ATTEMPTS) {
    throw new TerminalError('PROCESSING_ERROR', 'The book could not be processed.');
  }

  // A missing original is final; an I/O error reading it is worth retrying.
  let original: Buffer;
  try {
    if (!(await ctx.guard(objectStorage().head(quarantineKey(asset.id))))) {
      throw new TerminalError('PROCESSING_ERROR', 'The uploaded file is no longer available.');
    }
    original = await ctx.guard(objectStorage().get(quarantineKey(asset.id)));
  } catch (error) {
    rethrowIfAborted(ctx, error);
    if (error instanceof TerminalError) throw error;
    throw new RetryableError('PROCESSING_ERROR', 'The uploaded file could not be read.', error);
  }

  await setState(ctx, 'validating');
  const validation = await ctx.guard(
    runValidation(original, { timeoutMs: env.ASSET_PROCESSING_TIMEOUT_MS }),
  );
  if (!validation.ok) {
    if (
      validation.reasonCode === 'PROCESSING_TIMEOUT' ||
      validation.reasonCode === 'PROCESSING_ERROR'
    ) {
      throw new RetryableError(validation.reasonCode, validation.detail);
    }
    await rejectAsset(ctx, asset, validation.reasonCode, validation.detail);
    return;
  }

  await setState(ctx, 'scanning');
  const scan = await ctx.guard(malwareScanner().scan(original));
  if (scan.result === 'error') {
    // The scanner's message can name hosts; it goes to the log only.
    logger.warn('malware scanner unavailable', { assetId: asset.id, message: scan.message });
    throw new RetryableError('SCAN_UNAVAILABLE', 'The malware scanner was unavailable.');
  }
  if (scan.result === 'infected') {
    await rejectAsset(ctx, asset, 'MALWARE_DETECTED', 'The file was flagged as malware.');
    return;
  }

  await setState(ctx, 'encrypting');
  const dek = await ctx.guard(keyManagement().generateDataKey());
  let encrypted: ReturnType<typeof encryptAsset>;
  try {
    encrypted = encryptAsset(
      original,
      dek.plaintext,
      assetAad({ assetId: asset.id, version: asset.version, kmsKeyId: dek.keyId }),
    );
  } finally {
    dek.plaintext.fill(0);
  }

  await setState(ctx, 'storing');
  // One key per attempt: a committed object is never overwritten, and a run
  // that lost its lease can only ever delete its own object.
  const objectKey = assetKey(asset.id, asset.version, job.attempts, job.leaseId);
  const sha256 = createHash('sha256').update(encrypted.ciphertext).digest('hex');
  await storeVerified(ctx, objectKey, encrypted.ciphertext, sha256);
  if (validation.cover) {
    await ctx.guard(objectStorage().put(coverKey(asset.book_id, asset.id), validation.cover.data));
  }

  await completeAsset(ctx, asset, {
    objectKey,
    ciphertextSize: encrypted.ciphertext.length,
    sha256,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    wrapped: dek.wrapped,
    keyId: dek.keyId,
    keyVersion: dek.keyVersion,
    metadata: validation.metadata,
    hasCover: validation.cover !== null,
  });
  logger.info('asset ready', { assetId: asset.id, bookId: asset.book_id, version: asset.version });
}

/** Puts the ciphertext, reads it back and checks its SHA-256 before anything points at it. */
async function storeVerified(
  ctx: RunContext,
  key: string,
  ciphertext: Buffer,
  sha256: string,
): Promise<void> {
  try {
    ctx.objectKeys.push(key);
    ctx.pendingPut = objectStorage().put(key, ciphertext);
    await ctx.guard(ctx.pendingPut);
    const back = await ctx.guard(objectStorage().get(key));
    if (createHash('sha256').update(back).digest('hex') !== sha256) {
      throw new Error('stored ciphertext does not match');
    }
  } catch (error) {
    rethrowIfAborted(ctx, error);
    throw new RetryableError('PROCESSING_ERROR', 'The book could not be stored.', error);
  }
}

interface Completion {
  objectKey: string;
  ciphertextSize: number;
  sha256: string;
  nonce: Buffer;
  authTag: Buffer;
  wrapped: Buffer;
  keyId: string;
  keyVersion: string;
  metadata: unknown;
  hasCover: boolean;
}

/**
 * One transaction: key row, `ready`, metadata, and, only if the book has no
 * current asset, the pointer. The worker never moves an existing pointer, so a
 * late retry cannot overtake a newer version. It aborts (LeaseLostError) if the
 * run no longer owns the job or the asset is already terminal.
 */
async function completeAsset(ctx: RunContext, asset: AssetRow, done: Completion): Promise<void> {
  let wentLive = false;
  await withTransaction(async (client) => {
    // Lock order everywhere: book, then job, then asset.
    const { rows: books } = await client.query<{
      current_asset_id: string | null;
      cover_object_key: string | null;
    }>('SELECT current_asset_id, cover_object_key FROM books WHERE id = $1 FOR UPDATE', [
      asset.book_id,
    ]);
    await lockLease(client, ctx.job);
    const { rows: current } = await client.query<{ state: AssetState }>(
      'SELECT state FROM book_assets WHERE id = $1 FOR UPDATE',
      [asset.id],
    );
    if (!books[0] || !current[0] || isTerminal(current[0].state)) throw new LeaseLostError();

    await client.query(
      `INSERT INTO asset_keys (asset_id, wrapped_dek, kms_key_id, kms_key_version, wrapping_algorithm)
       VALUES ($1, $2, $3, $4, 'AES-256-GCM')`,
      [asset.id, done.wrapped, done.keyId, done.keyVersion],
    );
    await client.query(
      `UPDATE book_assets
          SET state = 'ready', reason_code = NULL, reason_detail = NULL,
              object_key = $2, ciphertext_size_bytes = $3, ciphertext_sha256 = $4,
              nonce = $5, auth_tag = $6, extracted_metadata = $7::jsonb, ready_at = NOW()
        WHERE id = $1`,
      [
        asset.id,
        done.objectKey,
        done.ciphertextSize,
        done.sha256,
        done.nonce,
        done.authTag,
        JSON.stringify(done.metadata),
      ],
    );

    if (books[0].current_asset_id === null) {
      await client.query('UPDATE books SET current_asset_id = $2 WHERE id = $1', [
        asset.book_id,
        asset.id,
      ]);
      await client.query(
        'UPDATE book_assets SET activated_at = NOW(), activated_by = uploaded_by WHERE id = $1',
        [asset.id],
      );
      wentLive = true;
    }
    // The EPUB's cover shows only if the asset is live and nothing was uploaded; the
    // new version in the URL makes caches fetch it.
    if (wentLive && done.hasCover && books[0].cover_object_key === null) {
      await client.query(
        `UPDATE books
            SET cover_version = cover_version + 1,
                cover_image_url = '/api/v1/books/' || id || '/cover?v=' || (cover_version + 1)
          WHERE id = $1`,
        [asset.book_id],
      );
    }

    await client.query(`UPDATE asset_jobs SET state = 'done', locked_at = NULL WHERE id = $1`, [
      ctx.job.id,
    ]);
    await audit(
      {
        actorId: asset.uploaded_by,
        action: 'asset.ready',
        resourceType: 'book_asset',
        resourceId: asset.id,
        metadata: { bookId: asset.book_id, version: asset.version, wentLive },
      },
      client,
    );
  });
  ctx.committed = true;
  await deleteQuarantine(asset.id);
}

const isTerminal = (state: AssetState) =>
  state === 'ready' || state === 'rejected' || state === 'failed';

/**
 * Removes the plaintext original and records that it is gone. A failure only
 * logs: the cleanup sweep retries every asset still unmarked.
 */
async function deleteQuarantine(assetId: string): Promise<void> {
  try {
    await objectStorage().delete(quarantineKey(assetId));
    await pool.query('UPDATE book_assets SET quarantine_deleted_at = NOW() WHERE id = $1', [
      assetId,
    ]);
  } catch (error) {
    logger.warn('quarantine cleanup failed, the sweep will retry', {
      assetId,
      errorName: errorName(error),
      errorMessage: errorMessage(error),
    });
  }
}

/** Final: the upload is refused, the job is done, the original is deleted. */
async function rejectAsset(
  ctx: RunContext,
  asset: AssetRow,
  reasonCode: string,
  reasonDetail: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await lockLease(client, ctx.job);
    const { rowCount } = await client.query(
      `UPDATE book_assets SET state = 'rejected', reason_code = $2, reason_detail = $3
        WHERE id = $1 AND state NOT IN ${TERMINAL_STATES}`,
      [asset.id, reasonCode, reasonDetail],
    );
    if (!rowCount) throw new LeaseLostError();
    await client.query(`UPDATE asset_jobs SET state = 'done', locked_at = NULL WHERE id = $1`, [
      ctx.job.id,
    ]);
    await audit(
      {
        actorId: asset.uploaded_by,
        action: 'asset.rejected',
        resourceType: 'book_asset',
        resourceId: asset.id,
        metadata: { bookId: asset.book_id, version: asset.version, reasonCode },
      },
      client,
    );
  });
  ctx.committed = true;
  await deleteQuarantine(asset.id);
  logger.info('asset rejected', { assetId: asset.id, reasonCode });
}

/**
 * Retries with backoff while attempts remain; otherwise fails the asset and
 * keeps the original. Fenced: does nothing (LeaseLostError) unless this run
 * still owns the job.
 */
async function handleFailure(job: ClaimedJob, error: unknown): Promise<void> {
  let reasonCode = 'PROCESSING_ERROR';
  let reasonDetail = 'The book could not be processed.';
  let retryable = true;

  if (error instanceof RetryableError) {
    reasonCode = error.reasonCode;
    reasonDetail = error.reasonDetail;
  } else if (error instanceof TerminalError) {
    reasonCode = error.reasonCode;
    reasonDetail = error.reasonDetail;
    retryable = false;
  }
  // Names, messages and ids reach the log: never the data being processed.
  const underlying = error instanceof RetryableError && error.cause ? error.cause : error;
  logger.warn('asset job failed', {
    jobId: job.id,
    assetId: job.assetId,
    attempt: job.attempts,
    reasonCode,
    errorName: errorName(underlying),
    errorMessage: errorMessage(underlying),
  });

  if (retryable && job.attempts < MAX_ATTEMPTS) {
    const backoffMs = BACKOFF_MS[Math.min(job.attempts, BACKOFF_MS.length) - 1] ?? 120_000;
    await withTransaction(async (client) => {
      await lockLease(client, job);
      const { rowCount } = await client.query(
        `UPDATE book_assets SET state = 'uploaded'
          WHERE id = $1 AND state NOT IN ${TERMINAL_STATES}`,
        [job.assetId],
      );
      if (!rowCount) throw new LeaseLostError();
      await client.query(
        `UPDATE asset_jobs
            SET state = 'queued', locked_at = NULL, last_error_code = $2,
                run_after = NOW() + $3::double precision * interval '1 millisecond'
          WHERE id = $1`,
        [job.id, reasonCode, backoffMs],
      );
    });
    return;
  }

  await withTransaction(async (client) => {
    await lockLease(client, job);
    const { rows } = await client.query<{
      book_id: string;
      version: number;
      uploaded_by: string | null;
    }>(
      `UPDATE book_assets
          SET state = 'failed', reason_code = $2, reason_detail = $3
        WHERE id = $1 AND state NOT IN ${TERMINAL_STATES}
    RETURNING book_id, version, uploaded_by`,
      [job.assetId, reasonCode, reasonDetail],
    );
    if (!rows[0]) throw new LeaseLostError();
    await client.query(
      `UPDATE asset_jobs SET state = 'failed', locked_at = NULL, last_error_code = $2 WHERE id = $1`,
      [job.id, reasonCode],
    );
    await audit(
      {
        actorId: rows[0].uploaded_by,
        action: 'asset.failed',
        resourceType: 'book_asset',
        resourceId: job.assetId,
        metadata: {
          bookId: rows[0].book_id,
          version: rows[0].version,
          reasonCode,
          attempts: job.attempts,
        },
      },
      client,
    );
  });
}

// ---------------------------------------------------------------------------
// Activation, retry, cleanup
// ---------------------------------------------------------------------------

/**
 * Makes a `ready` asset of this book the live one. Activating an older ready
 * version is a rollback. 404 when the asset is not this book's, 409 when it is
 * not ready; nothing changes in either case.
 */
export async function activateAsset(
  bookId: string,
  assetId: string,
  actorId: string | null,
): Promise<void> {
  // Whether the asset has an extracted cover is fixed when it is stored, so look outside the lock.
  const hasEpubCover = (await objectStorage().head(coverKey(bookId, assetId))) !== null;
  await withTransaction(async (client) => {
    const book = await client.query<{
      current_asset_id: string | null;
      cover_object_key: string | null;
    }>('SELECT current_asset_id, cover_object_key FROM books WHERE id = $1 FOR UPDATE', [bookId]);
    if (!book.rows[0]) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');

    const asset = await client.query<{ state: AssetState; version: number }>(
      'SELECT state, version FROM book_assets WHERE id = $1 AND book_id = $2 FOR UPDATE',
      [assetId, bookId],
    );
    if (!asset.rows[0]) throw new AppError(404, 'Asset not found', 'NOT_FOUND');
    if (asset.rows[0].state !== 'ready') {
      throw new AppError(409, 'The asset is not ready yet.', 'ASSET_PROCESSING');
    }
    if (book.rows[0].current_asset_id === assetId) return;

    await client.query('UPDATE books SET current_asset_id = $2 WHERE id = $1', [bookId, assetId]);
    if (book.rows[0].cover_object_key === null) {
      // No uploaded cover: the shown cover is the new asset's own, or none.
      await client.query(
        `UPDATE books
            SET cover_version = cover_version + 1,
                cover_image_url = CASE WHEN $2::boolean
                                       THEN '/api/v1/books/' || id || '/cover?v=' || (cover_version + 1)
                                       ELSE NULL END
          WHERE id = $1`,
        [bookId, hasEpubCover],
      );
    }
    await client.query(
      'UPDATE book_assets SET activated_at = NOW(), activated_by = $2 WHERE id = $1',
      [assetId, actorId],
    );
    await audit(
      {
        actorId,
        action: 'asset.activated',
        resourceType: 'book_asset',
        resourceId: assetId,
        metadata: {
          bookId,
          version: asset.rows[0].version,
          previousAssetId: book.rows[0].current_asset_id,
        },
      },
      client,
    );
  });
}

/** Admin retry: re-queues a `failed` asset whose original is still in quarantine. */
export async function retryAsset(assetId: string, actorId: string): Promise<AssetRow> {
  const found = await pool.query<{ book_id: string }>(
    'SELECT book_id FROM book_assets WHERE id = $1',
    [assetId],
  );
  if (!found.rows[0]) throw new AppError(404, 'Asset not found', 'NOT_FOUND');

  try {
    return await withTransaction(async (client: PoolClient) => {
      await client.query('SELECT id FROM books WHERE id = $1 FOR UPDATE', [found.rows[0].book_id]);
      const { rows } = await client.query<AssetRow>(
        'SELECT * FROM book_assets WHERE id = $1 FOR UPDATE',
        [assetId],
      );
      const asset = rows[0];
      if (asset.state !== 'failed') {
        throw new AppError(400, 'Only failed assets can be retried.', 'BAD_REQUEST');
      }
      if (!(await objectStorage().head(quarantineKey(assetId)))) {
        throw new AppError(
          400,
          'The original upload is no longer available. Upload the book again.',
          'BAD_REQUEST',
        );
      }

      const updated = await client.query<AssetRow>(
        `UPDATE book_assets SET state = 'uploaded', reason_code = NULL, reason_detail = NULL
          WHERE id = $1 RETURNING *`,
        [assetId],
      );
      const requeued = await client.query(
        `UPDATE asset_jobs
            SET state = 'queued', attempts = 0, run_after = NOW(), locked_at = NULL,
                last_error_code = NULL, lease_id = NULL
          WHERE asset_id = $1`,
        [assetId],
      );
      if (requeued.rowCount === 0) {
        await client.query('INSERT INTO asset_jobs (asset_id) VALUES ($1)', [assetId]);
      }
      await audit(
        {
          actorId,
          action: 'asset.retry',
          resourceType: 'book_asset',
          resourceId: assetId,
          metadata: { bookId: asset.book_id, version: asset.version },
        },
        client,
      );
      return updated.rows[0];
    });
  } catch (error) {
    // Another upload went in flight meanwhile.
    if (isPgError(error, PG_UNIQUE_VIOLATION)) throw processingConflict();
    throw error;
  }
}

const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;
const QUARANTINE_KEY =
  /^quarantine\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\..+\.tmp)?$/i;

/**
 * Removes plaintext originals that must not linger. Returns how many objects it deleted.
 * - Terminal assets whose original is not yet recorded gone: `ready` and `rejected`
 *   at once (the immediate delete may have failed), `failed` after 7 days.
 *   Each is recorded in `quarantine_deleted_at`, so later sweeps skip it.
 * - Orphans: quarantine objects older than an hour that no asset row owns (a crash
 *   between the put and the commit), and abandoned partial writes.
 */
export async function sweepQuarantine(): Promise<number> {
  let removed = 0;

  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM book_assets
      WHERE quarantine_deleted_at IS NULL
        AND (state IN ('ready', 'rejected')
             OR (state = 'failed' AND updated_at < NOW() - $1::int * interval '1 day'))`,
    [FAILED_ORIGINAL_RETENTION_DAYS],
  );
  for (const { id } of rows) {
    if (await objectStorage().head(quarantineKey(id))) {
      await objectStorage().delete(quarantineKey(id));
      removed++;
    }
    await pool.query('UPDATE book_assets SET quarantine_deleted_at = NOW() WHERE id = $1', [id]);
  }

  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  for (const object of await objectStorage().list('quarantine/')) {
    if (object.modifiedAt.getTime() > cutoff) continue;
    const match = QUARANTINE_KEY.exec(object.key);
    if (!match) continue;
    const partialWrite = match[2] !== undefined;
    if (!partialWrite) {
      const owner = await pool.query('SELECT 1 FROM book_assets WHERE id = $1', [match[1]]);
      if (owner.rowCount) continue;
    }
    await objectStorage().delete(object.key);
    removed++;
  }
  return removed;
}
