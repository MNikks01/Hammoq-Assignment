/**
 * Seed demo and load-test data.
 *
 *   npm run seed                       # demo account with realistic tasks
 *   npm run seed -- --loadtest 200     # + 200 isolated load-test accounts
 *
 * Only touches the demo account and accounts matching loadtest-*@example.test;
 * it never modifies other users. Refuses to run in production unless
 * ALLOW_PRODUCTION_SEED=true.
 */
import { TASK_PRIORITIES, type TaskPriority, type TaskStatus } from '@taskmanager/contracts';
import type { Types } from 'mongoose';
import mongoose from 'mongoose';
import { loadConfig } from '../config/env';
import { connectMongo } from '../database/mongo';
import { hashPassword } from '../modules/auth/password';
import { Session } from '../modules/auth/session.model';
import { PRIORITY_RANK, Task } from '../modules/tasks/task.model';
import { User } from '../modules/users/user.model';

export const DEMO_EMAIL = 'demo@taskmanager.dev';
export const DEMO_PASSWORD = 'DemoPassword2026';
export const LOADTEST_PASSWORD = 'LoadTestPassword1';
const loadtestEmail = (i: number) => `loadtest-${String(i).padStart(5, '0')}@example.test`;

const DAY = 86_400_000;

interface SeedTask {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueInDays: number | null;
  tags: string[];
  updatedDaysAgo: number;
}

const DEMO_TASKS: SeedTask[] = [
  {
    title: 'Finalize Q4 product roadmap',
    description: 'Incorporate feedback from the leadership review and circulate the final version.',
    status: 'in_progress',
    priority: 'high',
    dueInDays: 2,
    tags: ['work', 'planning'],
    updatedDaysAgo: 0,
  },
  {
    title: 'Prepare slides for Monday all-hands',
    description: 'Cover launch metrics, hiring update and the customer story from Acme.',
    status: 'todo',
    priority: 'high',
    dueInDays: 4,
    tags: ['work', 'presentation'],
    updatedDaysAgo: 1,
  },
  {
    title: 'Review pull request for billing service',
    description: 'Focus on idempotency of the webhook handler and retry behaviour.',
    status: 'todo',
    priority: 'medium',
    dueInDays: 1,
    tags: ['work', 'code-review'],
    updatedDaysAgo: 0,
  },
  {
    title: 'Submit expense report for conference travel',
    status: 'todo',
    priority: 'medium',
    dueInDays: -3,
    tags: ['admin', 'finance'],
    updatedDaysAgo: 6,
  },
  {
    title: 'Renew car insurance',
    description: 'Compare at least two quotes before renewing.',
    status: 'todo',
    priority: 'high',
    dueInDays: -1,
    tags: ['personal', 'finance'],
    updatedDaysAgo: 4,
  },
  {
    title: 'Book dentist appointment',
    status: 'todo',
    priority: 'low',
    dueInDays: 10,
    tags: ['personal', 'health'],
    updatedDaysAgo: 3,
  },
  {
    title: 'Write onboarding guide for new engineers',
    description: 'Local setup, architecture overview, deployment checklist, on-call basics.',
    status: 'in_progress',
    priority: 'medium',
    dueInDays: 9,
    tags: ['work', 'docs'],
    updatedDaysAgo: 2,
  },
  {
    title: 'Fix flaky checkout end-to-end test',
    description: 'Fails roughly 1 in 20 runs on CI; suspect a race with the payment iframe.',
    status: 'in_progress',
    priority: 'high',
    dueInDays: 0,
    tags: ['work', 'bug'],
    updatedDaysAgo: 0,
  },
  {
    title: 'Plan team offsite agenda',
    status: 'todo',
    priority: 'medium',
    dueInDays: 21,
    tags: ['work', 'team'],
    updatedDaysAgo: 5,
  },
  {
    title: 'Migrate reporting jobs to the new scheduler',
    description: 'Six cron jobs remaining. Keep the old scheduler running until parity is verified.',
    status: 'todo',
    priority: 'medium',
    dueInDays: 14,
    tags: ['work', 'infrastructure'],
    updatedDaysAgo: 7,
  },
  {
    title: 'Call landlord about the heating',
    status: 'completed',
    priority: 'medium',
    dueInDays: -6,
    tags: ['personal', 'home'],
    updatedDaysAgo: 5,
  },
  {
    title: 'Update dependencies and run security audit',
    status: 'completed',
    priority: 'high',
    dueInDays: -2,
    tags: ['work', 'security'],
    updatedDaysAgo: 2,
  },
  {
    title: 'Draft blog post on our caching strategy',
    description: 'Explain generation-based invalidation with diagrams.',
    status: 'todo',
    priority: 'low',
    dueInDays: null,
    tags: ['work', 'writing'],
    updatedDaysAgo: 9,
  },
  {
    title: 'Grocery run: weekly essentials',
    status: 'completed',
    priority: 'low',
    dueInDays: -1,
    tags: ['personal', 'home'],
    updatedDaysAgo: 1,
  },
  {
    title: 'Interview: senior backend candidate',
    description: 'System design round. Review the take-home submission beforehand.',
    status: 'todo',
    priority: 'high',
    dueInDays: 3,
    tags: ['work', 'hiring'],
    updatedDaysAgo: 1,
  },
  {
    title: 'Set up monitoring alerts for API latency',
    description: 'p95 > 300ms for 10 minutes, 5xx rate > 1%, Mongo pool saturation.',
    status: 'completed',
    priority: 'high',
    dueInDays: -8,
    tags: ['work', 'infrastructure'],
    updatedDaysAgo: 8,
  },
  {
    title: 'Read "Designing Data-Intensive Applications" ch. 5',
    status: 'in_progress',
    priority: 'low',
    dueInDays: null,
    tags: ['learning'],
    updatedDaysAgo: 3,
  },
  {
    title: 'Pay electricity bill',
    status: 'completed',
    priority: 'medium',
    dueInDays: -4,
    tags: ['personal', 'finance'],
    updatedDaysAgo: 4,
  },
  {
    title: 'Customer call: Globex renewal',
    description: 'They asked about SSO and audit logs. Bring the security one-pager.',
    status: 'todo',
    priority: 'high',
    dueInDays: 6,
    tags: ['work', 'customers'],
    updatedDaysAgo: 2,
  },
  {
    title: 'Clean up stale feature flags',
    status: 'todo',
    priority: 'low',
    dueInDays: 30,
    tags: ['work', 'tech-debt'],
    updatedDaysAgo: 12,
  },
  {
    title: 'Organize photo backups',
    status: 'todo',
    priority: 'low',
    dueInDays: null,
    tags: ['personal'],
    updatedDaysAgo: 15,
  },
  {
    title: 'Quarterly performance self-review',
    status: 'completed',
    priority: 'medium',
    dueInDays: -10,
    tags: ['work', 'admin'],
    updatedDaysAgo: 10,
  },
  {
    title: 'Load test the task API before launch',
    description: 'Ramp to the target rate; record p95/p99 and the first saturated resource.',
    status: 'in_progress',
    priority: 'high',
    dueInDays: 5,
    tags: ['work', 'performance'],
    updatedDaysAgo: 0,
  },
  {
    title: 'Return library books',
    status: 'todo',
    priority: 'low',
    dueInDays: -2,
    tags: ['personal'],
    updatedDaysAgo: 6,
  },
];

const VERBS = [
  'Review',
  'Draft',
  'Update',
  'Fix',
  'Plan',
  'Prepare',
  'Schedule',
  'Investigate',
  'Document',
  'Refactor',
];
const OBJECTS = [
  'release notes',
  'API docs',
  'sprint backlog',
  'billing report',
  'login flow',
  'database backup',
  'design mockups',
  'incident postmortem',
  'vendor contract',
  'test plan',
  'budget forecast',
  'search ranking',
];
const TAGS = ['work', 'personal', 'urgent', 'research', 'ops', 'frontend', 'backend', 'finance', 'meeting'];
const STATUSES: TaskStatus[] = ['todo', 'todo', 'in_progress', 'completed'];

/** Deterministic PRNG so load-test datasets are reproducible run to run. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Skewed task counts: most users have tens of tasks, a few have thousands. */
function taskCountFor(rand: () => number): number {
  const r = rand();
  if (r < 0.6) return 5 + Math.floor(rand() * 45);
  if (r < 0.9) return 50 + Math.floor(rand() * 250);
  if (r < 0.98) return 300 + Math.floor(rand() * 700);
  return 1000 + Math.floor(rand() * 2000);
}

/** Same convention as the web client: due at the last millisecond of that local day. */
function endOfDayIn(days: number, now: number): Date {
  const d = new Date(now + days * DAY);
  d.setHours(23, 59, 59, 999);
  return d;
}

function toDoc(userId: Types.ObjectId, t: SeedTask, now: number) {
  const updatedAt = new Date(now - t.updatedDaysAgo * DAY - Math.floor(Math.random() * 3_600_000));
  const createdAt = new Date(updatedAt.getTime() - 3 * DAY);
  return {
    userId,
    title: t.title,
    description: t.description ?? '',
    status: t.status,
    priority: t.priority,
    priorityRank: PRIORITY_RANK[t.priority],
    dueDate: t.dueInDays === null ? null : endOfDayIn(t.dueInDays, now),
    tags: t.tags,
    completedAt: t.status === 'completed' ? updatedAt : null,
    version: 0,
    createdAt,
    updatedAt,
  };
}

async function seedDemo(now: number) {
  const existing = await User.findOne({ email: DEMO_EMAIL }, { _id: 1 }).lean();
  if (existing) {
    await Promise.all([
      Task.deleteMany({ userId: existing._id }),
      Session.deleteMany({ userId: existing._id }),
    ]);
    await User.deleteOne({ _id: existing._id });
  }
  const user = await User.create({
    name: 'Demo User',
    email: DEMO_EMAIL,
    passwordHash: await hashPassword(DEMO_PASSWORD),
  });
  await Task.insertMany(
    DEMO_TASKS.map((t) => toDoc(user._id, t, now)),
    { timestamps: false } as never,
  );
  console.log(`demo account: ${DEMO_EMAIL} / ${DEMO_PASSWORD} (${DEMO_TASKS.length} tasks)`);
}

async function seedLoadTest(count: number, now: number) {
  const old = await User.find({ email: /^loadtest-\d+@example\.test$/ }, { _id: 1 }).lean();
  if (old.length) {
    const ids = old.map((u) => u._id);
    await Task.deleteMany({ userId: { $in: ids } });
    await Session.deleteMany({ userId: { $in: ids } });
    await User.deleteMany({ _id: { $in: ids } });
  }
  // One hash shared by all synthetic accounts keeps seeding fast; never do this for real users.
  const passwordHash = await hashPassword(LOADTEST_PASSWORD);
  const rand = mulberry32(42);
  const users = await User.insertMany(
    Array.from({ length: count }, (_, i) => ({
      name: `Load Test ${i}`,
      email: loadtestEmail(i),
      passwordHash,
    })),
  );

  let total = 0;
  let batch: ReturnType<typeof toDoc>[] = [];
  for (const u of users) {
    const n = taskCountFor(rand);
    for (let i = 0; i < n; i++) {
      const priority = TASK_PRIORITIES[Math.floor(rand() * 3)]!;
      const status = STATUSES[Math.floor(rand() * STATUSES.length)]!;
      batch.push(
        toDoc(
          u._id,
          {
            title: `${VERBS[Math.floor(rand() * VERBS.length)]} ${OBJECTS[Math.floor(rand() * OBJECTS.length)]} #${i}`,
            description:
              rand() < 0.5
                ? 'Generated load-test task with a short description for realistic payload sizes.'
                : '',
            status,
            priority,
            dueInDays: rand() < 0.2 ? null : Math.floor(rand() * 60) - 20,
            tags: [TAGS[Math.floor(rand() * TAGS.length)]!],
            updatedDaysAgo: Math.floor(rand() * 90),
          },
          now,
        ),
      );
      if (batch.length >= 2000) {
        await Task.insertMany(batch, { ordered: false });
        total += batch.length;
        batch = [];
      }
    }
  }
  if (batch.length) {
    await Task.insertMany(batch, { ordered: false });
    total += batch.length;
  }
  console.log(
    `load-test accounts: ${count} (${loadtestEmail(0)} .. ${loadtestEmail(count - 1)}), ${total} tasks`,
  );
  console.log(`load-test password: ${LOADTEST_PASSWORD}`);
}

async function main() {
  const config = loadConfig();
  if (config.isProduction && process.env.ALLOW_PRODUCTION_SEED !== 'true') {
    throw new Error('Refusing to seed a production database (set ALLOW_PRODUCTION_SEED=true to override).');
  }
  const flag = process.argv.indexOf('--loadtest');
  const loadtestCount = flag >= 0 ? Number(process.argv[flag + 1] ?? 100) : 0;

  await connectMongo({ ...config, MONGODB_AUTO_INDEX: true });
  await Promise.all([User.createIndexes(), Task.createIndexes(), Session.createIndexes()]);
  const now = Date.now();
  await seedDemo(now);
  if (loadtestCount > 0) await seedLoadTest(loadtestCount, now);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
