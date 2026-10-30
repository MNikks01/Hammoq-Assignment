import { Router } from 'express';
import type { Redis } from 'ioredis';
import { isRedisReady } from '../../cache/redis';
import { pingMongo } from '../../database/mongo';

export interface LifecycleState {
  shuttingDown: boolean;
}

/**
 * /health/live  — the process can serve HTTP. No dependency checks, so a database
 *                 outage never causes the orchestrator to restart healthy pods.
 * /health/ready — this instance should receive traffic: not draining and MongoDB
 *                 reachable. Redis is optional (degraded mode), so it is reported
 *                 but does not fail readiness. The Mongo ping result is cached
 *                 briefly so frequent probes cannot add meaningful database load.
 */
export function healthRouter(deps: { state: LifecycleState; redis?: Redis }): Router {
  const router = Router();
  let cached: { at: number; ok: boolean } | undefined;

  router.get('/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    if (deps.state.shuttingDown) {
      res.status(503).json({ status: 'draining' });
      return;
    }
    if (!cached || Date.now() - cached.at > 1_000) {
      cached = { at: Date.now(), ok: await pingMongo() };
    }
    const redis = deps.redis ? (isRedisReady(deps.redis) ? 'up' : 'down') : 'disabled';
    res.status(cached.ok ? 200 : 503).json({
      status: cached.ok ? (redis === 'down' ? 'degraded' : 'ready') : 'not_ready',
      checks: { mongo: cached.ok ? 'up' : 'down', redis },
    });
  });

  return router;
}
