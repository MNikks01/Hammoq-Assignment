import {
  createTaskSchema,
  listTasksQuerySchema,
  taskIdParamsSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
  type PaginationMeta,
  type TaskDto,
  type TaskStatus,
} from '@taskmanager/contracts';
import { Types } from 'mongoose';
import type { DashboardCache } from '../../cache/dashboard-cache';
import { logger } from '../../observability/logger';
import { Errors } from '../../utils/errors';
import { PRIORITY_RANK, Task } from './task.model';
import { TASK_PROJECTION, toTaskDto, type TaskProjection } from './task.mapper';
import { buildTaskFilter, buildTaskSort } from './task.query';

/**
 * Values placed in an update *pipeline* are aggregation expressions, so a string
 * such as "$secretField" would be evaluated as a field path. Wrapping every
 * client-supplied value in $literal makes it inert data.
 */
const lit = (v: unknown) => ({ $literal: v });

/** completedAt is derived server-side: set once on completion, cleared on reopen. */
const completedAtFor = (status: TaskStatus) =>
  status === 'completed' ? { $ifNull: ['$completedAt', '$$NOW'] } : lit(null);

export interface TaskServiceDeps {
  dashboardCache: DashboardCache;
  queryTimeoutMs: number;
}

export function createTaskService({ dashboardCache, queryTimeoutMs }: TaskServiceDeps) {
  const oid = (id: string) => new Types.ObjectId(id);
  const parseId = (raw: unknown) => oid(taskIdParamsSchema.parse(raw).id);

  const invalidate = (userId: string) =>
    dashboardCache
      .invalidate(userId)
      .catch((err: Error) => logger.warn({ err }, 'cache invalidation failed'));

  /** Distinguish "not yours / does not exist" (404) from "stale version" (409). */
  async function missOrConflict(userId: string, id: Types.ObjectId): Promise<never> {
    const exists = await Task.exists({ _id: id, userId: oid(userId) }).maxTimeMS(queryTimeoutMs);
    throw exists ? Errors.versionConflict() : Errors.notFound('Task');
  }

  return {
    async list(userId: string, rawQuery: unknown): Promise<{ items: TaskDto[]; meta: PaginationMeta }> {
      const q = listTasksQuerySchema.parse(rawQuery);
      const filter = buildTaskFilter(oid(userId), q);
      const sort = buildTaskSort(q);
      const find = Task.find(filter, TASK_PROJECTION)
        .sort(sort)
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .maxTimeMS(queryTimeoutMs)
        .lean<TaskProjection[]>();
      if (q.sortBy === 'title') find.collation({ locale: 'en', strength: 2 });

      // Page and count are independent; run them concurrently.
      const [items, total] = await Promise.all([
        find.exec(),
        Task.countDocuments(filter).maxTimeMS(queryTimeoutMs),
      ]);
      return {
        items: items.map(toTaskDto),
        meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
      };
    },

    async get(userId: string, rawParams: unknown): Promise<TaskDto> {
      const id = parseId(rawParams);
      // Ownership is part of the query itself: another user's id simply does not match.
      const task = await Task.findOne({ _id: id, userId: oid(userId) }, TASK_PROJECTION)
        .maxTimeMS(queryTimeoutMs)
        .lean<TaskProjection>();
      if (!task) throw Errors.notFound('Task');
      return toTaskDto(task);
    },

    async create(userId: string, rawBody: unknown): Promise<TaskDto> {
      const input = createTaskSchema.parse(rawBody);
      // Explicit field mapping: ownership comes from the verified token, never the body.
      const doc = await Task.create({
        userId: oid(userId),
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        priorityRank: PRIORITY_RANK[input.priority],
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        tags: input.tags,
        completedAt: input.status === 'completed' ? new Date() : null,
      });
      await invalidate(userId);
      return toTaskDto(doc.toObject());
    },

    async update(userId: string, rawParams: unknown, rawBody: unknown): Promise<TaskDto> {
      const id = parseId(rawParams);
      const input = updateTaskSchema.parse(rawBody);

      const set: Record<string, unknown> = {};
      if (input.title !== undefined) set.title = lit(input.title);
      if (input.description !== undefined) set.description = lit(input.description);
      if (input.priority !== undefined) {
        set.priority = lit(input.priority);
        set.priorityRank = lit(PRIORITY_RANK[input.priority]);
      }
      if (input.dueDate !== undefined) set.dueDate = lit(input.dueDate ? new Date(input.dueDate) : null);
      if (input.tags !== undefined) set.tags = lit(input.tags);
      if (input.status !== undefined) {
        set.status = lit(input.status);
        set.completedAt = completedAtFor(input.status);
      }
      set.version = { $add: ['$version', 1] };
      set.updatedAt = '$$NOW';

      // Compare-and-set on version: a concurrent edit makes the filter miss.
      const task = await Task.findOneAndUpdate(
        { _id: id, userId: oid(userId), version: input.version },
        [{ $set: set }],
        {
          new: true,
          projection: TASK_PROJECTION,
          timestamps: false,
          maxTimeMS: queryTimeoutMs,
        },
      ).lean<TaskProjection>();
      if (!task) return missOrConflict(userId, id);
      await invalidate(userId);
      return toTaskDto(task);
    },

    /** Idempotent: setting the same status twice yields the same state. */
    async updateStatus(userId: string, rawParams: unknown, rawBody: unknown): Promise<TaskDto> {
      const id = parseId(rawParams);
      const { status } = updateTaskStatusSchema.parse(rawBody);
      const task = await Task.findOneAndUpdate(
        { _id: id, userId: oid(userId) },
        [
          {
            $set: {
              status: lit(status),
              completedAt: completedAtFor(status),
              version: { $add: ['$version', 1] },
              updatedAt: '$$NOW',
            },
          },
        ],
        { new: true, projection: TASK_PROJECTION, timestamps: false, maxTimeMS: queryTimeoutMs },
      ).lean<TaskProjection>();
      if (!task) throw Errors.notFound('Task');
      await invalidate(userId);
      return toTaskDto(task);
    },

    async remove(userId: string, rawParams: unknown): Promise<void> {
      const id = parseId(rawParams);
      const { deletedCount } = await Task.deleteOne({ _id: id, userId: oid(userId) });
      if (deletedCount === 0) throw Errors.notFound('Task');
      await invalidate(userId);
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
