import type { Request, Response } from 'express';
import type { Config } from '../../config/env';
import type { Csrf } from '../../middleware/csrf';
import { requireAuth } from '../../middleware/authenticate';
import type { AuthService, ClientMeta } from './auth.service';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './cookies';

const meta = (req: Request): ClientMeta => ({ userAgent: req.get('user-agent') });

const refreshCookie = (req: Request): string | undefined => {
  const v: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof v === 'string' ? v : undefined;
};

/** Thin HTTP adapter: parse input, call the service, set cookies, shape the response. */
export function createAuthController(config: Config, auth: AuthService, csrf: Csrf) {
  return {
    csrf(req: Request, res: Response) {
      const token = csrf.issue(req, res);
      res.json({ data: { csrfToken: token } });
    },

    async register(req: Request, res: Response) {
      const { user, tokens } = await auth.register(req.body, meta(req));
      setAuthCookies(res, config, tokens);
      csrf.issue(req, res);
      res.status(201).json({ data: { user } });
    },

    async login(req: Request, res: Response) {
      const { user, tokens } = await auth.login(req.body, meta(req));
      setAuthCookies(res, config, tokens);
      csrf.issue(req, res);
      res.json({ data: { user } });
    },

    async refresh(req: Request, res: Response) {
      try {
        const { user, tokens } = await auth.refresh(refreshCookie(req), meta(req));
        setAuthCookies(res, config, tokens);
        res.json({ data: { user } });
      } catch (err) {
        clearAuthCookies(res, config);
        throw err;
      }
    },

    async logout(req: Request, res: Response) {
      await auth.logout(refreshCookie(req));
      clearAuthCookies(res, config);
      res.status(204).end();
    },

    async me(req: Request, res: Response) {
      const user = await auth.me(requireAuth(req).userId);
      res.json({ data: { user } });
    },

    async changePassword(req: Request, res: Response) {
      const { user, tokens } = await auth.changePassword(requireAuth(req).userId, req.body, meta(req));
      setAuthCookies(res, config, tokens);
      res.json({ data: { user } });
    },
  };
}
