import type { ApiErrorBody } from '@taskmanager/contracts';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../observability/logger';
import { AppError, Errors } from '../utils/errors';

interface HttpLikeError {
  type?: string;
  status?: number;
  code?: number | string;
  name?: string;
  message?: string;
}

const MONGO_UNAVAILABLE = new Set([
  'MongoServerSelectionError',
  'MongooseServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
  'MongoPoolClearedError',
  'MongoWaitQueueTimeoutError',
  'MongoTopologyClosedError',
]);

/** Map any thrown value to a client-safe AppError. Unknown errors become a generic 500. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      err.issues
        .slice(0, 20)
        .map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message })),
    );
  }

  const e = (err ?? {}) as HttpLikeError;

  // body-parser errors
  if (e.type === 'entity.too.large')
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (e.type === 'entity.parse.failed') return new AppError(400, 'VALIDATION_ERROR', 'Malformed JSON body');
  if (e.type === 'encoding.unsupported' || e.type === 'charset.unsupported')
    return Errors.unsupportedMediaType();

  // MongoDB / Mongoose
  if (e.code === 11000) return Errors.conflict('Resource already exists');
  if (e.code === 50 || e.name === 'MongoOperationTimeoutError') return Errors.timeout();
  if (e.name && MONGO_UNAVAILABLE.has(e.name)) return Errors.unavailable();
  // With bufferCommands=false, queries issued before the first successful connection
  // fail with a plain MongooseError; that is an outage, not a bug.
  if (e.name === 'MongooseError' && /before initial connection/i.test(e.message ?? '')) {
    return Errors.unavailable();
  }
  if (e.name === 'CastError') return new AppError(400, 'VALIDATION_ERROR', 'Invalid identifier');

  return new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

export function sendError(req: Request, res: Response, appErr: AppError): void {
  const body: ApiErrorBody = {
    error: {
      code: appErr.code,
      message: appErr.message,
      requestId: String(req.id ?? 'unknown'),
      ...(appErr.details ? { details: appErr.details } : {}),
    },
  };
  if (appErr.headers) res.set(appErr.headers);
  res.status(appErr.status).json(body);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appErr = toAppError(err);
  const log = req.log ?? logger;

  if (appErr.status >= 500) {
    // Full error (with stack) stays server-side; the client gets a generic message + request id.
    log.error({ err, code: appErr.code }, 'request failed');
  } else {
    log.debug({ code: appErr.code }, 'request rejected');
  }

  if (res.headersSent) {
    // A response is already in flight (e.g. timeout already answered). Nothing safe to add.
    return;
  }
  sendError(req, res, appErr);
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(req, res, Errors.notFound('Route'));
}
