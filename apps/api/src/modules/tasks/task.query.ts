import type { ListTasksQuery, TaskSortField } from '@taskmanager/contracts';
import type { Types } from 'mongoose';

/**
 * Translate a validated list query into a MongoDB filter and sort.
 *
 * Only primitives that passed the Zod allowlist reach this function, and every
 * operator here is chosen by the server; nothing from the client is spread into
 * the filter, so operator injection ({ "$ne": ... }) is impossible by construction.
 */
export function buildTaskFilter(
  userId: Types.ObjectId,
  q: ListTasksQuery,
  now: Date = new Date(),
): Record<string, unknown> {
  const filter: Record<string, unknown> = { userId };

  if (q.status) filter.status = q.status;
  if (q.priority) filter.priority = q.priority;
  if (q.tag) filter.tags = q.tag;

  const due: { $gte?: Date; $lte?: Date; $lt?: Date } = {};
  if (q.dueAfter) due.$gte = new Date(q.dueAfter);
  if (q.dueBefore) due.$lte = new Date(q.dueBefore);
  if (q.overdue) {
    due.$lt = now;
    // Completed tasks are never overdue.
    filter.status = q.status === 'completed' ? { $in: [] } : (q.status ?? { $ne: 'completed' });
  }
  if (Object.keys(due).length > 0) filter.dueDate = due;

  if (q.search) filter.$text = { $search: q.search };

  return filter;
}

const SORT_FIELD: Record<TaskSortField, string> = {
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  dueDate: 'dueDate',
  priority: 'priorityRank',
  title: 'title',
};

/** Stable sort: the unique _id tie-breaker makes offset pages deterministic. */
export function buildTaskSort(q: Pick<ListTasksQuery, 'sortBy' | 'sortOrder'>): Record<string, 1 | -1> {
  const dir = q.sortOrder === 'asc' ? 1 : -1;
  return { [SORT_FIELD[q.sortBy]]: dir, _id: dir };
}
