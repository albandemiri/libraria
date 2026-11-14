import { type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { pool } from '../db/pool';
import type { AssetRow } from '../drm/asset-repository';
import { activateAsset, enqueueUpload } from '../drm/asset-ingestion.service';
import { authContext, requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { rateLimit } from '../middleware/rate-limit';
import { bookWriteScope } from './publisher-scope';

const bookParamSchema = z.object({ bookId: z.string().uuid('Not a valid book id') });
const assetParamSchema = bookParamSchema.extend({
  assetId: z.string().uuid('Not a valid asset id'),
});

type AssetWithCurrent = AssetRow & { is_current: boolean };

/**
 * The public shape of an asset. Built field by field so storage keys, nonces,
 * tags and key references can never leak into a response.
 */
function formatAsset(row: AssetWithCurrent, withMetadata = false) {
  return {
    id: row.id,
    version: row.version,
    state: row.state,
    reasonCode: row.reason_code,
    reasonDetail: row.reason_detail,
    originalSizeBytes: Number(row.original_size_bytes),
    isCurrent: row.is_current,
    createdAt: row.created_at,
    readyAt: row.ready_at,
    activatedAt: row.activated_at,
    ...(withMetadata && { extractedMetadata: row.extracted_metadata ?? null }),
  };
}

/** 404 unless the book exists within the caller's publisher scope. */
async function requireBookInScope(req: Request, bookId: string): Promise<void> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM books WHERE id = $1 AND ($2::uuid IS NULL OR publisher_id = $2)`,
    [bookId, bookWriteScope(req)],
  );
  if (rowCount === 0) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
}

// ---------------------------------------------------------------------------
// Upload: registered by app.ts BEFORE express.json(), so the body is only ever
// seen by express.raw() with the hard limit, on this one route.
// ---------------------------------------------------------------------------

/** Refuses unknown books and busy books before a single body byte is read. */
const guardUpload: RequestHandler = async (req, _res, next) => {
  const { bookId } = bookParamSchema.parse(req.params);
  await requireBookInScope(req, bookId);
  const { rowCount } = await pool.query(
    `SELECT 1 FROM book_assets
      WHERE book_id = $1 AND state NOT IN ('ready', 'rejected', 'failed')`,
    [bookId],
  );
  if (rowCount) {
    throw new AppError(
      409,
      'This book already has an upload in progress. Wait for it to finish.',
      'ASSET_PROCESSING',
    );
  }
  next();
};

const UPLOAD_TYPES = ['application/epub+zip', 'application/octet-stream'];

/** How long a refused client may keep sending before its connection is cut. */
const REFUSED_BODY_GRACE_MS = 1000;

/**
 * Reads the raw upload body with a hard byte limit, answering 413 the moment it
 * is exceeded: at once for a declared Content-Length over the limit (nothing is
 * read), and on the first byte past the limit for a chunked body. Unlike a
 * parser that drains the body before it reports the error, a never-ending
 * upload gets its answer immediately; the connection is then cut off after a short grace if it is still sending, instead of drained.
 * Only the bytes up to the limit are ever held in memory.
 */
const rawEpubBody: RequestHandler = (req, res, next) => {
  const mediaType = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!UPLOAD_TYPES.includes(mediaType)) {
    next(); // No body is read; the handler answers 415.
    return;
  }

  const limit = env.ASSET_MAX_UPLOAD_BYTES;
  const refuse = () => {
    req.removeAllListeners('data');
    req.removeAllListeners('end');
    req.on('data', () => undefined); // discard whatever still arrives, never buffer it
    // No `Connection: close`: closing a socket that still has unread request data
    // makes the kernel reset it, and the client then never sees the 413. Instead
    // the rest is discarded for a short grace; a client that is still sending
    // after that (an endless stream) is cut off.
    res.once('finish', () => {
      setTimeout(() => {
        if (!req.readableEnded) req.socket.destroy();
      }, REFUSED_BODY_GRACE_MS).unref();
    });
    next(new AppError(413, 'Request body is too large', 'PAYLOAD_TOO_LARGE'));
  };

  const declared = Number(req.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    refuse();
    return;
  }

  const chunks: Buffer[] = [];
  let received = 0;
  let refused = false;
  req.on('data', (chunk: Buffer) => {
    if (refused) return;
    received += chunk.length;
    if (received > limit) {
      refused = true;
      chunks.length = 0;
      refuse();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (refused) return;
    req.body = Buffer.concat(chunks, received);
    next();
  });
  req.on('error', (error) => {
    if (!refused) next(error);
  });
};

const receiveUpload: RequestHandler = async (req: Request, res: Response) => {
  const { bookId } = bookParamSchema.parse(req.params);
  if (!Buffer.isBuffer(req.body)) {
    throw new AppError(
      415,
      'Send the EPUB as the raw request body with Content-Type application/epub+zip.',
      'BAD_REQUEST',
    );
  }
  if (req.body.length === 0) {
    throw new AppError(400, 'The request body is empty.', 'VALIDATION_FAILED');
  }
  const asset = await enqueueUpload(bookId, authContext(req).userId, req.body);
  res.status(202).json({ asset: formatAsset({ ...asset, is_current: false }) });
};

export const uploadAssetHandlers: RequestHandler[] = [
  requireAuth,
  requireRole('publisher', 'admin'),
  rateLimit({
    name: 'asset-upload',
    limit: 20,
    windowMs: 60 * 60 * 1000,
    key: (req) => bookWriteScope(req) ?? authContext(req).userId,
  }),
  guardUpload,
  rawEpubBody,
  receiveUpload,
];

// ---------------------------------------------------------------------------
// Status and activation: mounted under the publisher router.
// ---------------------------------------------------------------------------

export const assetsRouter = Router({ mergeParams: true });

const ASSET_SELECT = `SELECT ba.*, (b.current_asset_id = ba.id) AS is_current
                        FROM book_assets ba JOIN books b ON b.id = ba.book_id`;

assetsRouter.get('/', async (req: Request, res: Response) => {
  const { bookId } = bookParamSchema.parse(req.params);
  await requireBookInScope(req, bookId);
  const { rows } = await pool.query<AssetWithCurrent>(
    `${ASSET_SELECT} WHERE ba.book_id = $1 ORDER BY ba.version DESC`,
    [bookId],
  );
  res.json({ assets: rows.map((row) => formatAsset(row)) });
});

assetsRouter.get('/:assetId', async (req: Request, res: Response) => {
  const { bookId, assetId } = assetParamSchema.parse(req.params);
  await requireBookInScope(req, bookId);
  const { rows } = await pool.query<AssetWithCurrent>(
    `${ASSET_SELECT} WHERE ba.book_id = $1 AND ba.id = $2`,
    [bookId, assetId],
  );
  if (!rows[0]) throw new AppError(404, 'Asset not found', 'NOT_FOUND');
  res.json({ asset: formatAsset(rows[0], true) });
});

assetsRouter.post('/:assetId/activate', async (req: Request, res: Response) => {
  const { bookId, assetId } = assetParamSchema.parse(req.params);
  await requireBookInScope(req, bookId);
  await activateAsset(bookId, assetId, authContext(req).userId);
  const { rows } = await pool.query<AssetWithCurrent>(
    `${ASSET_SELECT} WHERE ba.book_id = $1 AND ba.id = $2`,
    [bookId, assetId],
  );
  res.json({ asset: formatAsset(rows[0]) });
});
