import { z } from 'zod';

export const TASK_STATUSES = ['todo', 'in_progress', 'completed'] as const;
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export const TASK_SORT_FIELDS = ['createdAt', 'updatedAt', 'dueDate', 'priority', 'title'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type TaskSortField = (typeof TASK_SORT_FIELDS)[number];

export const TASK_LIMITS = {
  titleMax: 200,
  descriptionMax: 5000,
  tagMax: 24,
  tagsMax: 10,
  searchMax: 100,
  pageMax: 1000,
  limitMax: 100,
  limitDefault: 20,
} as const;

/** Tags are lowercase slugs so they are safe to render anywhere and cheap to index. */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

const title = z.string().trim().min(1, 'Title is required').max(TASK_LIMITS.titleMax);
const description = z.string().trim().max(TASK_LIMITS.descriptionMax);
const tag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(TASK_LIMITS.tagMax)
  .regex(TAG_PATTERN, 'Tags may contain lowercase letters, digits and dashes');
const tags = z
  .array(tag)
  .max(TASK_LIMITS.tagsMax, `At most ${TASK_LIMITS.tagsMax} tags`)
  .transform((t) => [...new Set(t)]);

/**
 * Due dates are absolute instants (ISO-8601 with offset, persisted as UTC).
 * The client converts the user's chosen calendar day to the end of that day in
 * the user's local time zone, so "due today" stays due until local midnight.
 */
const dueDate = z
  .string()
  .datetime({ offset: true, message: 'Due date must be an ISO-8601 timestamp' })
  .refine((v) => {
    const y = new Date(v).getUTCFullYear();
    return y >= 2000 && y <= 2100;
  }, 'Due date is out of range');

export const createTaskSchema = z
  .object({
    title,
    description: description.optional().default(''),
    status: z.enum(TASK_STATUSES).optional().default('todo'),
    priority: z.enum(TASK_PRIORITIES).optional().default('medium'),
    dueDate: dueDate.nullable().optional().default(null),
    tags: tags.optional().default([]),
  })
  .strict();

/** General update: every field optional, `version` required for optimistic concurrency. */
export const updateTaskSchema = z
  .object({
    version: z.number().int().min(0),
    title: title.optional(),
    description: description.optional(),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    dueDate: dueDate.nullable().optional(),
    tags: tags.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), {
    message: 'Provide at least one field to update',
  });

/** Status changes are idempotent "set" operations, so no version is required. */
export const updateTaskStatusSchema = z.object({ status: z.enum(TASK_STATUSES) }).strict();

export const taskIdParamsSchema = z.object({ id: objectId }).strict();

/** Only `overdue=true` is meaningful; "not overdue" would be ambiguous for undated tasks. */
const trueFlag = z.literal('true').transform(() => true as const);

export const listTasksQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(TASK_LIMITS.pageMax).default(1),
    limit: z.coerce.number().int().min(1).max(TASK_LIMITS.limitMax).default(TASK_LIMITS.limitDefault),
    status: z.enum(TASK_STATUSES).optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    tag: tag.optional(),
    search: z.string().trim().min(1).max(TASK_LIMITS.searchMax).optional(),
    dueAfter: z.string().datetime({ offset: true }).optional(),
    dueBefore: z.string().datetime({ offset: true }).optional(),
    overdue: trueFlag.optional(),
    sortBy: z.enum(TASK_SORT_FIELDS).default('updatedAt'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict()
  .refine((q) => !(q.dueAfter && q.dueBefore) || new Date(q.dueAfter) <= new Date(q.dueBefore), {
    message: 'dueAfter must be before dueBefore',
    path: ['dueAfter'],
  });

export type CreateTaskInput = z.input<typeof createTaskSchema>;
export type CreateTask = z.output<typeof createTaskSchema>;
export type UpdateTaskInput = z.input<typeof updateTaskSchema>;
export type UpdateTask = z.output<typeof updateTaskSchema>;
export type ListTasksQueryInput = z.input<typeof listTasksQuerySchema>;
export type ListTasksQuery = z.output<typeof listTasksQuerySchema>;

export interface TaskDto {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  tags: string[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DashboardSummary {
  counts: {
    total: number;
    todo: number;
    inProgress: number;
    completed: number;
    overdue: number;
  };
  completionRate: number;
  recent: TaskDto[];
  upcoming: TaskDto[];
  generatedAt: string;
}
