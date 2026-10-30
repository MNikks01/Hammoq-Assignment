import { createServer } from 'node:http';
import { createApp } from './app';
import { connectRedis, createRedis } from './cache/redis';
import { loadConfig } from './config/env';
import { connectMongo, disconnectMongo } from './database/mongo';
import { createLogger, logger as defaultLogger, setLogger } from './observability/logger';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    defaultLogger.fatal((err as Error).message);
    process.exit(1);
  }
  const logger = createLogger(config.LOG_LEVEL);
  setLogger(logger);

  const redis = config.REDIS_URL ? createRedis(config.REDIS_URL) : undefined;
  if (redis) await connectRedis(redis);
  else logger.warn('REDIS_URL not set: rate limits are per-instance and the dashboard cache is disabled');

  const state = { shuttingDown: false };
  const app = createApp({ config, redis, state });
  const server = createServer(app);
  // Keep-alive must outlive the load balancer's idle timeout (60s on AWS ALB) to
  // avoid races where the LB reuses a socket the server just closed.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 30_000;

  server.listen(config.PORT, config.HOST, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API listening');
  });

  // Connect to MongoDB in the background with backoff. Until connected, liveness
  // passes, readiness fails, and data requests fail fast with 503 (bufferCommands=false).
  void (async () => {
    for (let attempt = 1; !state.shuttingDown; attempt++) {
      try {
        await connectMongo(config);
        logger.info('MongoDB connected');
        return;
      } catch (err) {
        const delay = Math.min(1_000 * 2 ** (attempt - 1), 15_000) + Math.floor(Math.random() * 250);
        logger.error(
          { err: { message: (err as Error).message }, attempt, delay },
          'MongoDB connection failed',
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  })();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    state.shuttingDown = true; // readiness now fails; LB stops sending new requests
    logger.info({ signal }, 'shutting down: draining in-flight requests');
    const force = setTimeout(() => {
      logger.error('shutdown timed out; forcing exit');
      process.exit(1);
    }, config.SHUTDOWN_TIMEOUT_MS);
    force.unref();

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    await Promise.allSettled([disconnectMongo(), redis?.quit()]);
    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    void shutdown('uncaughtException');
  });
}

void main();
