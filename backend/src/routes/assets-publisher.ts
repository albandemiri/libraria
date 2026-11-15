import { type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { pool } from '../db/pool';
import type { AssetRow } from '../drm/asset-repository';
import { activateAsset, enqueueUpload } from '../drm/asset-ingestion.service';
import { authContext, requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { rateLimit } from '../middleware/rate-limit';
import { cutOffUnreadBody, rawBodyWithLimit } from '../middleware/raw-body';
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

/**
 * 404 unless the book exists within the caller's publisher scope. With `forWrite`, an archived
 * book is refused too (409 BOOK_ARCHIVED): it is read-only until restored.
 */
async function requireBookInScope(req: Request, bookId: string, forWrite = false): Promise<void> {
  const { rows } = await pool.query<{ archived: boolean }>(
    `SELECT archived_at IS NOT NULL AS archived FROM books
      WHERE id = $1 AND ($2::uuid IS NULL OR publisher_id = $2)`,
    [bookId, bookWriteScope(req)],
  );
  if (!rows[0]) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
  if (forWrite && rows[0].archived) {
    throw new AppError(
      409,
      'This title is archived and read-only. Restore it before changing its files.',
      'BOOK_ARCHIVED',
    );
  }
}

// ---------------------------------------------------------------------------
// Upload: registered by app.ts BEFORE express.json(), so the body is only ever
// seen by express.raw() with the hard limit, on this one route.
// ---------------------------------------------------------------------------

/** Refuses unknown books and busy books before a single body byte is read. */
const guardUpload: RequestHandler = async (req, _res, next) => {
  const { bookId } = bookParamSchema.parse(req.params);
  await requireBookInScope(req, bookId, true);
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

const rawEpubBody = rawBodyWithLimit(
  () => env.ASSET_MAX_UPLOAD_BYTES,
  UPLOAD_TYPES,
  'PAYLOAD_TOO_LARGE',
);

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
  cutOffUnreadBody,
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
  await requireBookInScope(req, bookId, true);
  await activateAsset(bookId, assetId, authContext(req).userId);
  const { rows } = await pool.query<AssetWithCurrent>(
    `${ASSET_SELECT} WHERE ba.book_id = $1 AND ba.id = $2`,
    [bookId, assetId],
  );
  res.json({ asset: formatAsset(rows[0]) });
});
