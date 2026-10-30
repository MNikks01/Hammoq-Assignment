import { CSRF_HEADER } from '@taskmanager/contracts';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import type { Redis } from 'ioredis';
import { createDashboardCache } from './cache/dashboard-cache';
import type { Config } from './config/env';
import { authenticate } from './middleware/authenticate';
import { inFlightLimiter, requestDeadline } from './middleware/backpressure';
import { createCsrf } from './middleware/csrf';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { httpLogger } from './middleware/http-logger';
import { createRateLimiters } from './middleware/rate-limit';
import { requireJson } from './middleware/require-json';
import { authRouter } from './modules/auth/auth.routes';
import { createAuthService } from './modules/auth/auth.service';
import { createTokenService } from './modules/auth/tokens';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { createDashboardService } from './modules/dashboard/dashboard.service';
import { healthRouter, type LifecycleState } from './modules/health/health.routes';
import { tasksRouter } from './modules/tasks/task.routes';
import { createTaskService } from './modules/tasks/task.service';
import { usersRouter } from './modules/users/users.routes';
import { registry } from './observability/metrics';
import { safeEqual } from './utils/crypto';

export interface AppDeps {
  config: Config;
  redis?: Redis;
  state?: LifecycleState;
}

/**
 * Builds the Express application without binding a port, so tests can drive it
 * with supertest and server.ts owns process lifecycle concerns.
 */
export function createApp({ config, redis, state = { shuttingDown: false } }: AppDeps): Express {
  const tokens = createTokenService(config);
  const csrf = createCsrf(config);
  const limiters = createRateLimiters(config, redis);
  const requireSession = authenticate(tokens);
  const dashboardCache = createDashboardCache(redis, config.DASHBOARD_CACHE_TTL_SECONDS);
  const auth = createAuthService(config, tokens);
  const tasks = createTaskService({ dashboardCache, queryTimeoutMs: config.DB_QUERY_TIMEOUT_MS });
  const dashboard = createDashboardService({
    cache: dashboardCache,
    queryTimeoutMs: config.DB_QUERY_TIMEOUT_MS,
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  // Only trust X-Forwarded-For from the configured number of proxy hops.
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(httpLogger());

  // Operational endpoints sit in front of load shedding so probes keep answering under pressure.
  app.use('/health', healthRouter({ state, redis }));
  app.get('/metrics', async (req, res) => {
    const token = req.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const allowed = config.METRICS_TOKEN ? safeEqual(token, config.METRICS_TOKEN) : !config.isProduction;
    if (!allowed) {
      res.status(404).end();
      return;
    }
    res.set('Content-Type', registry.contentType).send(await registry.metrics());
  });

  app.use(
    helmet({
      // The API only ever returns JSON, so the strictest policy applies.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  const allowedOrigins = new Set(config.WEB_ORIGIN);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, origin === undefined || allowedOrigins.has(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', CSRF_HEADER, 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
    }),
  );

  app.use(inFlightLimiter(config.MAX_IN_FLIGHT));
  app.use(requestDeadline(config.REQUEST_TIMEOUT_MS));
  app.use(requireJson);
  app.use(express.json({ limit: '16kb', strict: true }));
  app.use(cookieParser());

  const api = Router();
  api.use((_req, res, next) => {
    // Responses are per-user; no shared cache (CDN/proxy) may store them.
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  api.use(csrf.protect);
  api.use('/auth', authRouter({ config, auth, csrf, authenticate: requireSession, limiters }));
  api.use('/users', usersRouter({ config, auth, authenticate: requireSession, limiters }));
  api.use('/tasks', tasksRouter({ tasks, authenticate: requireSession, limiters }));
  api.use('/dashboard', dashboardRouter({ dashboard, authenticate: requireSession, limiters }));
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
