/**
 * Print executionStats for the API's real query shapes against the user with the
 * most tasks, to verify every common query is index-backed (no COLLSCAN, no
 * blocking SORT) and examines a number of keys close to what it returns.
 *
 *   npm run db:explain
 */
import type { Types } from 'mongoose';
import mongoose from 'mongoose';
import { loadConfig } from '../config/env';
import { connectMongo } from '../database/mongo';
import { Task } from '../modules/tasks/task.model';

interface PlanNode {
  stage?: string;
  indexName?: string;
  inputStage?: PlanNode;
  inputStages?: PlanNode[];
  queryPlan?: PlanNode;
}

function stages(node: PlanNode | undefined, out: string[] = []): string[] {
  if (!node) return out;
  const n = node.queryPlan ?? node;
  out.push(n.indexName ? `${n.stage}(${n.indexName})` : String(n.stage));
  stages(n.inputStage, out);
  n.inputStages?.forEach((s) => stages(s, out));
  return out;
}

type Explain = {
  queryPlanner?: { winningPlan?: PlanNode };
  executionStats?: {
    nReturned: number;
    totalKeysExamined: number;
    totalDocsExamined: number;
    executionTimeMillis: number;
  };
  stages?: Array<{ $cursor?: Explain }>;
};

function report(name: string, e: Explain) {
  const inner = e.stages?.[0]?.$cursor ?? e;
  const s = inner.executionStats;
  console.log(
    `${name.padEnd(28)} plan=${stages(inner.queryPlanner?.winningPlan).join(' <- ')}\n${''.padEnd(28)} returned=${s?.nReturned} keys=${s?.totalKeysExamined} docs=${s?.totalDocsExamined} ms=${s?.executionTimeMillis}`,
  );
}

async function main() {
  await connectMongo({ ...loadConfig(), MONGODB_AUTO_INDEX: false });
  const [top] = await Task.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $group: { _id: '$userId', n: { $sum: 1 } } },
    { $sort: { n: -1 } },
    { $limit: 1 },
  ]);
  if (!top) throw new Error('No tasks found. Run `npm run seed -- --loadtest 50` first.');
  const userId = top._id;
  const now = new Date();
  console.log(`user ${userId} with ${top.n} tasks; total tasks ${await Task.estimatedDocumentCount()}\n`);

  const page = {
    title: 1,
    status: 1,
    priority: 1,
    dueDate: 1,
    tags: 1,
    updatedAt: 1,
    createdAt: 1,
    version: 1,
  };
  const cases: Array<[string, () => Promise<unknown>]> = [
    [
      'list default (updatedAt)',
      () => Task.find({ userId }, page).sort({ updatedAt: -1, _id: -1 }).limit(20).explain('executionStats'),
    ],
    [
      'list page 5',
      () =>
        Task.find({ userId }, page)
          .sort({ updatedAt: -1, _id: -1 })
          .skip(80)
          .limit(20)
          .explain('executionStats'),
    ],
    [
      'filter status',
      () =>
        Task.find({ userId, status: 'in_progress' }, page)
          .sort({ updatedAt: -1, _id: -1 })
          .limit(20)
          .explain('executionStats'),
    ],
    [
      'sort dueDate asc',
      () => Task.find({ userId }, page).sort({ dueDate: 1, _id: 1 }).limit(20).explain('executionStats'),
    ],
    [
      'sort createdAt',
      () => Task.find({ userId }, page).sort({ createdAt: -1, _id: -1 }).limit(20).explain('executionStats'),
    ],
    [
      'sort priority',
      () =>
        Task.find({ userId }, page).sort({ priorityRank: -1, _id: -1 }).limit(20).explain('executionStats'),
    ],
    [
      'overdue',
      () =>
        Task.find({ userId, status: { $ne: 'completed' }, dueDate: { $lt: now } }, page)
          .sort({ updatedAt: -1, _id: -1 })
          .limit(20)
          .explain('executionStats'),
    ],
    [
      'text search',
      () =>
        Task.find({ userId, $text: { $search: 'report' } }, page)
          .sort({ updatedAt: -1, _id: -1 })
          .limit(20)
          .explain('executionStats'),
    ],
    // countDocuments() runs as $match + $group, so explain that pipeline.
    [
      'count (list total)',
      () =>
        Task.aggregate([{ $match: { userId } }, { $group: { _id: 1, n: { $sum: 1 } } }]).explain(
          'executionStats',
        ),
    ],
    [
      'dashboard status counts',
      () =>
        Task.aggregate([{ $match: { userId } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).explain(
          'executionStats',
        ),
    ],
    [
      'dashboard overdue count',
      () =>
        Task.aggregate([
          { $match: { userId, status: { $ne: 'completed' }, dueDate: { $lt: now } } },
          { $group: { _id: 1, n: { $sum: 1 } } },
        ]).explain('executionStats'),
    ],
    [
      'dashboard upcoming',
      () =>
        Task.find(
          {
            userId,
            status: { $ne: 'completed' },
            dueDate: { $gte: now, $lte: new Date(now.getTime() + 7 * 86_400_000) },
          },
          page,
        )
          .sort({ dueDate: 1, _id: 1 })
          .limit(5)
          .explain('executionStats'),
    ],
  ];
  for (const [name, run] of cases) report(name, (await run()) as Explain);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
