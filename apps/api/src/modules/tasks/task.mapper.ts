import type { TaskDto, TaskPriority, TaskStatus } from '@taskmanager/contracts';
import type { Types } from 'mongoose';

/** Fields read from MongoDB for API responses. userId/priorityRank are never returned. */
export const TASK_PROJECTION = {
  title: 1,
  description: 1,
  status: 1,
  priority: 1,
  dueDate: 1,
  tags: 1,
  completedAt: 1,
  createdAt: 1,
  updatedAt: 1,
  version: 1,
} as const;

export interface TaskProjection {
  _id: Types.ObjectId;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: Date | null;
  tags?: string[] | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export function toTaskDto(t: TaskProjection): TaskDto {
  return {
    id: String(t._id),
    title: t.title,
    description: t.description ?? '',
    status: t.status as TaskStatus,
    priority: t.priority as TaskPriority,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    tags: t.tags ?? [],
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    version: t.version,
  };
}
