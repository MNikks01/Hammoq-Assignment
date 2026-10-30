import mongoose from 'mongoose';
import type { Config } from '../config/env';
import { logger } from '../observability/logger';
import {
  mongoCommandDuration,
  mongoPoolCheckedOut,
  mongoPoolCheckoutFailures,
} from '../observability/metrics';

// Fail fast instead of queueing operations in memory while disconnected:
// an outage must surface as errors, not as unbounded buffers and hung requests.
mongoose.set('bufferCommands', false);
// Unknown filter paths are dropped. Client input never reaches filters directly:
// task.query.ts builds every filter from Zod-validated primitives.
mongoose.set('strictQuery', true);

export async function connectMongo(config: Config, uri = config.MONGODB_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, {
    maxPoolSize: config.MONGODB_MAX_POOL_SIZE,
    minPoolSize: config.MONGODB_MIN_POOL_SIZE,
    // How long to wait for a pooled connection before failing the operation.
    waitQueueTimeoutMS: 2_000,
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    socketTimeoutMS: 30_000,
    heartbeatFrequencyMS: 10_000,
    retryWrites: true,
    retryReads: true,
    autoIndex: config.MONGODB_AUTO_INDEX,
    autoCreate: config.MONGODB_AUTO_INDEX,
    monitorCommands: true,
    appName: 'task-api',
  });
  instrument(conn.connection.getClient());
  conn.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  conn.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  return conn;
}

type MongoClient = ReturnType<typeof mongoose.connection.getClient>;

const instrumented = new WeakSet<MongoClient>();

function instrument(client: MongoClient): void {
  if (instrumented.has(client)) return;
  instrumented.add(client);
  client.on('connectionCheckedOut', () => mongoPoolCheckedOut.inc());
  client.on('connectionCheckedIn', () => mongoPoolCheckedOut.dec());
  client.on('connectionCheckOutFailed', (e) => mongoPoolCheckoutFailures.inc({ reason: String(e.reason) }));
  client.on('commandSucceeded', (e) =>
    mongoCommandDuration.observe({ command: e.commandName, outcome: 'ok' }, e.duration / 1000),
  );
  client.on('commandFailed', (e) =>
    mongoCommandDuration.observe({ command: e.commandName, outcome: 'error' }, e.duration / 1000),
  );
}

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === mongoose.ConnectionStates.connected;
}

export async function pingMongo(timeoutMs = 1_000): Promise<boolean> {
  if (!isMongoConnected() || !mongoose.connection.db) return false;
  try {
    await Promise.race([
      mongoose.connection.db.admin().command({ ping: 1 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), timeoutMs).unref()),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}
