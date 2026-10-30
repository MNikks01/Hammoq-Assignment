import type { NextFunction, Request, Response } from 'express';
import { Errors } from '../utils/errors';

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Requests that carry a body must declare application/json. This blocks
 * form-encoded "simple" cross-site requests and avoids parsing unexpected formats.
 */
export function requireJson(req: Request, _res: Response, next: NextFunction): void {
  if (!BODY_METHODS.has(req.method)) return next();
  const hasBody =
    Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (hasBody && !req.is('application/json')) throw Errors.unsupportedMediaType();
  next();
}
