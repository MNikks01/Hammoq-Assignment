import { CSRF_COOKIE, CSRF_HEADER } from '@taskmanager/contracts';
import type { NextFunction, Request, Response } from 'express';
import type { Config } from '../config/env';
import { hmac, randomToken, safeEqual } from '../utils/crypto';
import { Errors } from '../utils/errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Signed double-submit CSRF protection.
 *
 * The token is `<random>.<hmac(COOKIE_SECRET, random)>`, stored in a readable,
 * SameSite=Strict cookie. State-changing requests must echo it in the
 * X-CSRF-Token header. A cross-site attacker can neither read the cookie nor set
 * the custom header without a CORS preflight that our allowlist rejects; the
 * signature prevents forging tokens via cookie injection from a sibling subdomain.
 */
export function createCsrf(config: Config) {
  const sign = (nonce: string) => `${nonce}.${hmac(config.COOKIE_SECRET, nonce)}`;

  const isValid = (token: string) => {
    const [nonce, sig, ...rest] = token.split('.');
    if (!nonce || !sig || rest.length > 0) return false;
    return safeEqual(sign(nonce), token);
  };

  const issue = (req: Request, res: Response): string => {
    const existing: unknown = req.cookies?.[CSRF_COOKIE];
    const token = typeof existing === 'string' && isValid(existing) ? existing : sign(randomToken(18));
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // must be readable by the SPA to echo it in the header
      secure: config.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/',
      maxAge: config.SESSION_ABSOLUTE_TTL * 1000,
    });
    return token;
  };

  const protect = (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    const header = req.get(CSRF_HEADER);
    if (typeof cookie !== 'string' || !header || !safeEqual(cookie, header) || !isValid(cookie)) {
      throw Errors.csrf();
    }
    next();
  };

  return { issue, protect, isValid };
}

export type Csrf = ReturnType<typeof createCsrf>;
