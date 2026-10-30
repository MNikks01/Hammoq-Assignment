import type { DashboardSummary } from '@taskmanager/contracts';
import { Types } from 'mongoose';
import type { DashboardCache } from '../../cache/dashboard-cache';
import { Task } from '../tasks/task.model';
import { TASK_PROJECTION, toTaskDto, type TaskProjection } from '../tasks/task.mapper';

const UPCOMING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const LIST_SIZE = 5;

/**
 * Four bounded, index-backed queries run concurrently; no task documents are
 * loaded to count. Status counts can be answered from the user_status_updated
 * index alone (covered), overdue/upcoming use user_due, recent uses user_updated.
 */
export function createDashboardService(deps: { cache: DashboardCache; queryTimeoutMs: number }) {
  const { queryTimeoutMs } = deps;

  async function compute(userId: string): Promise<DashboardSummary> {
    const uid = new Types.ObjectId(userId);
    const now = new Date();
    const horizon = new Date(now.getTime() + UPCOMING_WINDOW_MS);

    const [byStatus, overdue, recent, upcoming] = await Promise.all([
      Task.aggregate<{ _id: string; n: number }>([
        { $match: { userId: uid } },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ]).option({ maxTimeMS: queryTimeoutMs }),
      Task.countDocuments({ userId: uid, status: { $ne: 'completed' }, dueDate: { $lt: now } }).maxTimeMS(
        queryTimeoutMs,
      ),
      Task.find({ userId: uid }, TASK_PROJECTION)
        .sort({ updatedAt: -1, _id: -1 })
        .limit(LIST_SIZE)
        .maxTimeMS(queryTimeoutMs)
        .lean<TaskProjection[]>(),
      Task.find(
        { userId: uid, status: { $ne: 'completed' }, dueDate: { $gte: now, $lte: horizon } },
        TASK_PROJECTION,
      )
        .sort({ dueDate: 1, _id: 1 })
        .limit(LIST_SIZE)
        .maxTimeMS(queryTimeoutMs)
        .lean<TaskProjection[]>(),
    ]);

    const count = (s: string) => byStatus.find((r) => r._id === s)?.n ?? 0;
    const todo = count('todo');
    const inProgress = count('in_progress');
    const completed = count('completed');
    const total = todo + inProgress + completed;

    return {
      counts: { total, todo, inProgress, completed, overdue },
      completionRate: total === 0 ? 0 : Math.round((completed / total) * 1000) / 10,
      recent: recent.map(toTaskDto),
      upcoming: upcoming.map(toTaskDto),
      generatedAt: now.toISOString(),
    };
  }

  return {
    compute,
    summary: (userId: string) => deps.cache.get(userId, () => compute(userId)),
  };
}

export type DashboardService = ReturnType<typeof createDashboardService>;
