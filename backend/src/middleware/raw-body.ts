import type { Request, RequestHandler, Response } from 'express';
import { AppError, type ErrorCode } from './errors';

/** How long a refused client may keep sending before its connection is cut. */
const REFUSED_BODY_GRACE_MS = 1000;

/**
 * Once the response is out, discards whatever the client still sends for a short
 * grace and then cuts the connection if the body is still not finished. Closing
 * at once would reset a socket with unread data, and the client would never see
 * the answer; never closing would let an unread body hold the connection open
 * until the server's request timeout.
 */
const armed = new WeakSet<Request>();

function dropUnreadBodyAfterResponse(req: Request, res: Response): void {
  if (armed.has(req)) return;
  armed.add(req);
  res.once('finish', () => {
    if (req.readableEnded) return;
    req.on('data', () => undefined); // discard, never buffer
    req.resume();
    setTimeout(() => {
      if (!req.readableEnded) req.socket.destroy();
    }, REFUSED_BODY_GRACE_MS).unref();
  });
}

/**
 * Put first on a raw-upload route: whichever handler answers (401, 403, 404,
 * 415, 429, ...) without reading the body, the connection does not hang on it.
 */
export const cutOffUnreadBody: RequestHandler = (req, res, next) => {
  dropUnreadBodyAfterResponse(req, res);
  next();
};

/**
 * Reads a raw upload body with a hard byte limit, answering 413 the moment it
 * is exceeded: at once for a declared Content-Length over the limit (nothing is
 * read), and on the first byte past the limit for a chunked body. Unlike a
 * parser that drains the body before it reports the error, a never-ending
 * upload gets its answer immediately; the connection is then cut off after a short grace if it is still sending, instead of drained.
 * Only the bytes up to the limit are ever held in memory.
 *
 * A request whose media type is not in `types` is passed on without reading
 * anything; the handler after this one answers 415.
 */
export function rawBodyWithLimit(
  maxBytes: () => number,
  types: readonly string[],
  tooLargeCode: ErrorCode,
): RequestHandler {
  return (req, res, next) => {
    const mediaType = (req.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!types.includes(mediaType)) {
      next(); // No body is read; the handler answers 415.
      return;
    }

    const limit = maxBytes();
    const refuse = () => {
      req.removeAllListeners('data');
      req.removeAllListeners('end');
      req.on('data', () => undefined); // discard whatever still arrives, never buffer it
      dropUnreadBodyAfterResponse(req, res);
      next(new AppError(413, 'Request body is too large', tooLargeCode));
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
}
