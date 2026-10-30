import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/authenticate';
import type { RateLimiters } from '../../middleware/rate-limit';
import type { AuthService } from '../auth/auth.service';
import { clearAuthCookies } from '../auth/cookies';
import type { Config } from '../../config/env';

const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) }).strict();

/**
 * DELETE /api/v1/users/me — permanently deletes the account, all of its tasks and
 * sessions. Requires the current password (re-authentication for a destructive act).
 */
export function usersRouter(deps: {
  config: Config;
  auth: AuthService;
  authenticate: RequestHandler;
  limiters: RateLimiters;
}): Router {
  const router = Router();
  router.delete('/me', deps.authenticate, deps.limiters.authIp, async (req, res) => {
    const { userId } = requireAuth(req);
    const { password } = deleteAccountSchema.parse(req.body);
    await deps.auth.deleteAccount(userId, password);
    clearAuthCookies(res, deps.config);
    res.status(204).end();
  });
  return router;
}
