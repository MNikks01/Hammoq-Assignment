import type { NextFunction, Request, Response } from 'express';
import { ACCESS_COOKIE } from '../modules/auth/cookies';
import type { TokenService } from '../modules/auth/tokens';
import { Errors } from '../utils/errors';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

/**
 * Stateless access-token check: verifies signature, issuer, audience and expiry of
 * the short-lived JWT in the HttpOnly cookie. No database round trip per request,
 * which keeps authenticated reads horizontally scalable. Revocation latency is
 * bounded by ACCESS_TOKEN_TTL (see docs/security.md).
 */
export function authenticate(tokens: TokenService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || token.length === 0) throw Errors.unauthenticated();
    try {
      const claims = await tokens.verifyAccess(token);
      req.auth = { userId: claims.sub, sessionId: claims.sid };
    } catch {
      throw Errors.unauthenticated('Session expired or invalid');
    }
    next();
  };
}

export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw Errors.unauthenticated();
  return req.auth;
}
