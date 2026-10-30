/**
 * Controlled index deployment (production runs with autoIndex disabled).
 *
 *   npm run db:indexes                     # show the diff, create missing indexes
 *   npm run db:indexes -- --dry-run        # show the diff only
 *   npm run db:indexes -- --drop-extraneous  # also drop indexes not in the schema
 *
 * Run as a release step before rolling out code that depends on a new index.
 * On large collections MongoDB builds indexes online, but builds still consume
 * I/O; schedule them off-peak and watch replication lag.
 */
import mongoose from 'mongoose';
import { loadConfig } from '../config/env';
import { connectMongo } from '../database/mongo';
import { Session } from '../modules/auth/session.model';
import { Task } from '../modules/tasks/task.model';
import { User } from '../modules/users/user.model';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dropExtraneous = process.argv.includes('--drop-extraneous');
  const config = loadConfig();
  await connectMongo({ ...config, MONGODB_AUTO_INDEX: false });

  for (const model of [User, Task, Session]) {
    await model.createCollection().catch(() => undefined);
    const diff = await model.diffIndexes();
    console.log(
      `${model.collection.collectionName}: create=${JSON.stringify(diff.toCreate)} drop=${JSON.stringify(diff.toDrop)}`,
    );
    if (dryRun) continue;
    if (dropExtraneous) await model.syncIndexes();
    else await model.createIndexes();
  }
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
