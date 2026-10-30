import { Router, type RequestHandler } from 'express';
import type { RateLimiters } from '../../middleware/rate-limit';
import { createTaskController } from './task.controller';
import type { TaskService } from './task.service';

export function tasksRouter(deps: {
  tasks: TaskService;
  authenticate: RequestHandler;
  limiters: RateLimiters;
}): Router {
  const c = createTaskController(deps.tasks);
  const router = Router();

  // Deny by default: every task route requires a verified session.
  router.use(deps.authenticate, deps.limiters.api);

  router.get('/', deps.limiters.search, c.list);
  router.post('/', c.create);
  router.get('/:id', c.get);
  router.patch('/:id', c.update);
  router.patch('/:id/status', c.updateStatus);
  router.delete('/:id', c.remove);

  return router;
}
