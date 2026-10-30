import type { DashboardSummary } from '@taskmanager/contracts';
import type { Redis } from 'ioredis';
import { logger } from '../observability/logger';
import { cacheOps, redisLatency } from '../observability/metrics';
import { isRedisReady } from './redis';

/**
 * Per-user dashboard summary cache with generation-based invalidation.
 *
 *   tm:dashgen:<userId>        -> integer generation, INCR on every task mutation
 *   tm:dash:<userId>:g<gen>    -> JSON summary, TTL + jitter
 *
 * A reader that computed a summary from pre-mutation data can only ever write it
 * under the old generation, which no later reader will look up. This avoids the
 * classic "delete then stale re-populate" race without locks.
 *
 * Isolation: keys are built only from the authenticated user id (a validated
 * ObjectId hex string from the verified access token), never from request input.
 */
export interface DashboardCache {
  get(userId: string, compute: () => Promise<DashboardSummary>): Promise<DashboardSummary>;
  invalidate(userId: string): Promise<void>;
}

const USER_ID = /^[a-f0-9]{24}$/;

export const genKey = (userId: string) => `tm:dashgen:${userId}`;
export const valueKey = (userId: string, gen: string) => `tm:dash:${userId}:g${gen}`;

export function withJitter(ttlSeconds: number, random = Math.random): number {
  // +/- 10% spreads expiry so entries created together do not all expire together.
  const spread = Math.max(1, Math.round(ttlSeconds * 0.1));
  return Math.max(1, ttlSeconds + Math.round((random() * 2 - 1) * spread));
}

async function timed<T>(op: string, fn: () => Promise<T>): Promise<T> {
  const end = redisLatency.startTimer({ op });
  try {
    return await fn();
  } finally {
    end();
  }
}

export function createDashboardCache(redis: Redis | undefined, ttlSeconds: number): DashboardCache {
  // Single-flight per instance: concurrent misses for the same key share one computation.
  const inFlight = new Map<string, Promise<DashboardSummary>>();

  const singleFlight = (key: string, compute: () => Promise<DashboardSummary>) => {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const p = compute().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };

  return {
    async get(userId, compute) {
      if (!USER_ID.test(userId)) throw new Error('Invalid cache identity');
      if (ttlSeconds === 0 || !isRedisReady(redis)) {
        cacheOps.inc({ cache: 'dashboard', result: 'bypass' });
        return singleFlight(`local:${userId}`, compute);
      }

      let gen: string;
      try {
        gen = (await timed('get', () => redis.get(genKey(userId)))) ?? '0';
        const cached = await timed('get', () => redis.get(valueKey(userId, gen)));
        if (cached) {
          cacheOps.inc({ cache: 'dashboard', result: 'hit' });
          return JSON.parse(cached) as DashboardSummary;
        }
      } catch (err) {
        cacheOps.inc({ cache: 'dashboard', result: 'error' });
        logger.debug({ err: { message: (err as Error).message } }, 'dashboard cache read failed');
        return singleFlight(`local:${userId}`, compute);
      }

      cacheOps.inc({ cache: 'dashboard', result: 'miss' });
      const key = valueKey(userId, gen);
      return singleFlight(key, async () => {
        const summary = await compute();
        timed('set', () => redis.set(key, JSON.stringify(summary), 'EX', withJitter(ttlSeconds))).catch(() =>
          cacheOps.inc({ cache: 'dashboard', result: 'error' }),
        );
        return summary;
      });
    },

    async invalidate(userId) {
      if (ttlSeconds === 0 || !isRedisReady(redis)) return;
      try {
        await timed('incr', () =>
          redis
            .multi()
            .incr(genKey(userId))
            .expire(genKey(userId), 60 * 60 * 24)
            .exec(),
        );
        cacheOps.inc({ cache: 'dashboard', result: 'invalidate' });
      } catch (err) {
        // Bounded staleness: worst case the entry lives until its TTL expires.
        cacheOps.inc({ cache: 'dashboard', result: 'error' });
        logger.warn({ err: { message: (err as Error).message } }, 'dashboard cache invalidation failed');
      }
    },
  };
}
