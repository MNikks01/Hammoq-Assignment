import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../../middleware/authenticate';
import type { RateLimiters } from '../../middleware/rate-limit';
import type { DashboardService } from './dashboard.service';

export function dashboardRouter(deps: {
  dashboard: DashboardService;
  authenticate: RequestHandler;
  limiters: RateLimiters;
}): Router {
  const router = Router();
  router.use(deps.authenticate, deps.limiters.api);
  router.get('/summary', async (req, res) => {
    res.json({ data: await deps.dashboard.summary(requireAuth(req).userId) });
  });
  return router;
}
