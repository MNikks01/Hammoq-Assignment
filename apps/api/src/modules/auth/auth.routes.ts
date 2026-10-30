import { Router, type RequestHandler } from 'express';
import type { Config } from '../../config/env';
import type { Csrf } from '../../middleware/csrf';
import type { RateLimiters } from '../../middleware/rate-limit';
import { createAuthController } from './auth.controller';
import type { AuthService } from './auth.service';

export function authRouter(deps: {
  config: Config;
  auth: AuthService;
  csrf: Csrf;
  authenticate: RequestHandler;
  limiters: RateLimiters;
}): Router {
  const c = createAuthController(deps.config, deps.auth, deps.csrf);
  const { authIp, loginAccount, api } = deps.limiters;
  const router = Router();

  router.get('/csrf', c.csrf);
  router.post('/register', authIp, c.register);
  router.post('/login', authIp, loginAccount, c.login);
  router.post('/refresh', authIp, c.refresh);
  router.post('/logout', c.logout);
  router.get('/me', deps.authenticate, api, c.me);
  router.post('/change-password', deps.authenticate, authIp, c.changePassword);

  return router;
}
