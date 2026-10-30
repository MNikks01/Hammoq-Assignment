import mongoose from 'mongoose';
import { afterAll, beforeAll } from 'vitest';
import { connectMongo } from '../../src/database/mongo';
import { Session } from '../../src/modules/auth/session.model';
import { Task } from '../../src/modules/tasks/task.model';
import { User } from '../../src/modules/users/user.model';
import { testConfig } from './helpers';

/**
 * Every test file gets a fresh, uniquely named database on a real MongoDB server
 * (MONGODB_URI_TEST, default local), with the production index definitions built.
 */
beforeAll(async () => {
  const base = new URL(process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017');
  base.pathname = `/taskmanager_test_${process.env.VITEST_POOL_ID ?? '0'}_${Math.random().toString(36).slice(2, 8)}`;
  await connectMongo(testConfig(), base.toString());
  await Promise.all([User.createIndexes(), Task.createIndexes(), Session.createIndexes()]);
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
