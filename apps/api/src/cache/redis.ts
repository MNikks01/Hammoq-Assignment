import { Redis } from 'ioredis';
import { logger } from '../observability/logger';

/**
 * Redis is an optional accelerator here (distributed rate limits + dashboard cache).
 * MongoDB remains the source of truth, so every Redis call has a tight timeout and
 * callers degrade gracefully when Redis is unavailable.
 */
export function createRedis(url: string): Redis {
  const redis = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 2_000,
    commandTimeout: 150,
    maxRetriesPerRequest: 1,
    // Do not queue commands while disconnected: callers check `isRedisReady` and fall back.
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
  let lastErrorLog = 0;
  redis.on('error', (err) => {
    const now = Date.now();
    if (now - lastErrorLog > 10_000) {
      lastErrorLog = now;
      logger.warn({ err: { message: err.message } }, 'Redis error');
    }
  });
  redis.on('ready', () => logger.info('Redis ready'));
  return redis;
}

export function isRedisReady(redis: Redis | undefined): redis is Redis {
  return redis?.status === 'ready';
}

export async function connectRedis(redis: Redis): Promise<void> {
  try {
    await redis.connect();
  } catch (err) {
    // Start without Redis; ioredis keeps retrying in the background.
    logger.warn(
      { err: { message: (err as Error).message } },
      'Redis unavailable at startup; continuing degraded',
    );
  }
}
