import type { CookieOptions, Response } from 'express';
import type { Config } from '../../config/env';

export const ACCESS_COOKIE = 'tm_at';
export const REFRESH_COOKIE = 'tm_rt';
/** The refresh token is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

function base(config: Config): CookieOptions {
  return { httpOnly: true, secure: config.COOKIE_SECURE };
}

export function setAuthCookies(res: Response, config: Config, t: IssuedTokens): void {
  res.cookie(ACCESS_COOKIE, t.accessToken, {
    ...base(config),
    sameSite: 'lax',
    path: '/',
    maxAge: config.ACCESS_TOKEN_TTL * 1000,
  });
  res.cookie(REFRESH_COOKIE, t.refreshToken, {
    ...base(config),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: t.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response, config: Config): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(config), sameSite: 'lax', path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(config), sameSite: 'strict', path: REFRESH_COOKIE_PATH });
}
