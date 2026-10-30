import {
  TAG_PATTERN,
  TASK_LIMITS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type CreateTaskInput,
  type TaskDto,
} from '@taskmanager/contracts';
import { z } from 'zod';
import { dateInputToDueIso, dueIsoToDateInput } from '@/lib/dates';

export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/** Form-shaped schema (all strings, as inputs produce them); converted to the API contract on submit. */
export const taskFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Title is required')
    .max(TASK_LIMITS.titleMax, `At most ${TASK_LIMITS.titleMax} characters`),
  description: z.string().max(TASK_LIMITS.descriptionMax, `At most ${TASK_LIMITS.descriptionMax} characters`),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(TASK_PRIORITIES),
  dueDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Enter a valid date'),
  tags: z
    .string()
    .refine((v) => parseTags(v).length <= TASK_LIMITS.tagsMax, `At most ${TASK_LIMITS.tagsMax} tags`)
    .refine(
      (v) => parseTags(v).every((t) => TAG_PATTERN.test(t) && t.length <= TASK_LIMITS.tagMax),
      'Use lowercase letters, numbers and dashes, separated by commas',
    ),
});

export type TaskFormValues = z.infer<typeof taskFormSchema>;

export function toFormValues(task?: TaskDto | null): TaskFormValues {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.status ?? 'todo',
    priority: task?.priority ?? 'medium',
    dueDate: dueIsoToDateInput(task?.dueDate ?? null),
    tags: task?.tags.join(', ') ?? '',
  };
}

export function toPayload(
  v: TaskFormValues,
): Required<Omit<CreateTaskInput, 'dueDate'>> & { dueDate: string | null } {
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    status: v.status,
    priority: v.priority,
    dueDate: dateInputToDueIso(v.dueDate),
    tags: parseTags(v.tags),
  };
}
