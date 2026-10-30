import type { NextFunction, Request, RequestHandler, Response } from 'express';
import {
  ipKeyGenerator,
  MemoryStore,
  rateLimit,
  type IncrementResponse,
  type Options,
  type Store,
} from 'express-rate-limit';
import type { Redis } from 'ioredis';
import { isRedisReady } from '../cache/redis';
import type { Config } from '../config/env';
import { rateLimitRejections, rateLimitStoreFallback } from '../observability/metrics';
import { AppError } from '../utils/errors';

/**
 * Fixed-window counter in Redis shared by all API instances, with a per-instance
 * in-memory fallback while Redis is unavailable. During an outage limits become
 * per-instance (looser by a factor of the instance count) rather than failing
 * closed (blocking all traffic) or failing fully open. Fallback use is counted in
 * `rate_limit_store_fallback_total` so it is visible on dashboards.
 */
export class FailoverRedisStore implements Store {
  localKeys = false;
  prefix: string;
  private windowMs = 60_000;
  private readonly memory = new MemoryStore();

  constructor(
    private readonly redis: Redis | undefined,
    name: string,
  ) {
    this.prefix = `tm:rl:${name}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.memory.init(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    if (isRedisReady(this.redis)) {
      const k = this.prefix + key;
      try {
        const res = await this.redis.multi().incr(k).pexpire(k, this.windowMs, 'NX').pttl(k).exec();
        const totalHits = Number(res?.[0]?.[1]);
        const ttl = Number(res?.[2]?.[1]);
        if (Number.isFinite(totalHits)) {
          return { totalHits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
        }
      } catch {
        // fall through to the local store
      }
    }
    rateLimitStoreFallback.inc();
    return this.memory.increment(key);
  }

  async decrement(key: string): Promise<void> {
    if (isRedisReady(this.redis)) {
      await this.redis.decr(this.prefix + key).catch(() => undefined);
      return;
    }
    await this.memory.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    if (isRedisReady(this.redis)) await this.redis.del(this.prefix + key).catch(() => undefined);
    await this.memory.resetKey(key);
  }
}

interface LimiterSpec {
  name: string;
  windowMs: number;
  limit: number;
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
  skipSuccessfulRequests?: boolean;
}

const clientIp = (req: Request) => ipKeyGenerator(req.ip ?? 'unknown');

export function createRateLimiters(config: Config, redis: Redis | undefined) {
  const make = (spec: LimiterSpec): RequestHandler => {
    if (!config.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
    return rateLimit({
      windowMs: spec.windowMs,
      limit: spec.limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      store: new FailoverRedisStore(redis, spec.name),
      keyGenerator: spec.keyGenerator ?? clientIp,
      skip: spec.skip,
      skipSuccessfulRequests: spec.skipSuccessfulRequests ?? false,
      handler: (req: Request, _res: Response, next: NextFunction) => {
        rateLimitRejections.inc({ limiter: spec.name });
        const info = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit;
        const reset = info?.resetTime?.getTime() ?? Date.now() + spec.windowMs;
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        next(
          new AppError(
            429,
            'RATE_LIMITED',
            'Too many requests. Please slow down and try again later.',
            undefined,
            {
              'Retry-After': String(retryAfter),
            },
          ),
        );
      },
    });
  };

  return {
    /** Per-IP budget across all credential endpoints (register, login, refresh, password change). */
    authIp: make({
      name: 'auth_ip',
      windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
      limit: config.AUTH_RATE_LIMIT_MAX,
    }),
    /** Per-account failed-login budget: slows credential stuffing that rotates IPs. */
    loginAccount: make({
      name: 'login_account',
      windowMs: config.AUTH_RATE_LIMIT_WINDOW_MS,
      limit: config.LOGIN_ACCOUNT_RATE_LIMIT_MAX,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => {
        const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
        return typeof email === 'string' ? `acct:${email.trim().toLowerCase().slice(0, 254)}` : clientIp(req);
      },
    }),
    /** General authenticated API budget, keyed by user (falls back to IP). */
    api: make({
      name: 'api',
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.RATE_LIMIT_MAX,
      keyGenerator: (req) => (req.auth ? `user:${req.auth.userId}` : clientIp(req)),
    }),
    /** Tighter budget for text search, the most expensive list query. */
    search: make({
      name: 'search',
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: config.SEARCH_RATE_LIMIT_MAX,
      keyGenerator: (req) => (req.auth ? `user:${req.auth.userId}` : clientIp(req)),
      skip: (req) => typeof req.query.search !== 'string',
    }),
  };
}

export type RateLimiters = ReturnType<typeof createRateLimiters>;
