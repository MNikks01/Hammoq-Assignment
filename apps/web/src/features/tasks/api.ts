import {
  TASK_PRIORITIES,
  TASK_SORT_FIELDS,
  TASK_STATUSES,
  type ApiPage,
  type ApiSuccess,
  type CreateTaskInput,
  type TaskDto,
  type TaskPriority,
  type TaskSortField,
  type TaskStatus,
  type UpdateTaskInput,
} from '@taskmanager/contracts';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface TaskFilters {
  page: number;
  limit: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  search?: string;
  overdue?: boolean;
  sortBy: TaskSortField;
  sortOrder: 'asc' | 'desc';
}

export const DEFAULT_FILTERS: TaskFilters = { page: 1, limit: 10, sortBy: 'updatedAt', sortOrder: 'desc' };

const oneOf = <T extends string>(values: readonly T[], v: string | null): T | undefined =>
  v && (values as readonly string[]).includes(v) ? (v as T) : undefined;

/** URL is the source of truth for filters, so views are shareable and survive refresh. */
export function filtersFromParams(p: URLSearchParams): TaskFilters {
  const page = Number(p.get('page'));
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    limit: DEFAULT_FILTERS.limit,
    status: oneOf(TASK_STATUSES, p.get('status')),
    priority: oneOf(TASK_PRIORITIES, p.get('priority')),
    search: p.get('search')?.trim().slice(0, 100) || undefined,
    overdue: p.get('overdue') === 'true' || undefined,
    sortBy: oneOf(TASK_SORT_FIELDS, p.get('sortBy')) ?? DEFAULT_FILTERS.sortBy,
    sortOrder:
      p.get('sortOrder') === 'asc'
        ? 'asc'
        : p.get('sortOrder') === 'desc'
          ? 'desc'
          : DEFAULT_FILTERS.sortOrder,
  };
}

export function filtersToParams(f: Partial<TaskFilters>): URLSearchParams {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.priority) p.set('priority', f.priority);
  if (f.search) p.set('search', f.search);
  if (f.overdue) p.set('overdue', 'true');
  if (f.sortBy && f.sortBy !== DEFAULT_FILTERS.sortBy) p.set('sortBy', f.sortBy);
  if (f.sortOrder && f.sortOrder !== DEFAULT_FILTERS.sortOrder) p.set('sortOrder', f.sortOrder);
  if (f.page && f.page > 1) p.set('page', String(f.page));
  return p;
}

function toApiQuery(f: TaskFilters): string {
  const p = filtersToParams(f);
  p.set('limit', String(f.limit));
  p.set('sortBy', f.sortBy);
  p.set('sortOrder', f.sortOrder);
  return p.toString();
}

export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (f: TaskFilters) => [...taskKeys.lists(), f] as const,
};
export const DASHBOARD_KEY = ['dashboard', 'summary'] as const;

export function useTasks(filters: TaskFilters) {
  return useQuery({
    queryKey: taskKeys.list(filters),
    // The signal cancels superseded requests when filters change quickly.
    queryFn: ({ signal }) => api.get<ApiPage<TaskDto>>(`/tasks?${toApiQuery(filters)}`, signal),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateTaskData() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: taskKeys.all }),
      qc.invalidateQueries({ queryKey: DASHBOARD_KEY }),
    ]);
}

export function useCreateTask() {
  const invalidate = useInvalidateTaskData();
  return useMutation({
    mutationFn: (input: CreateTaskInput) =>
      api.post<ApiSuccess<TaskDto>>('/tasks', input).then((r) => r.data),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidateTaskData();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTaskInput }) =>
      api.patch<ApiSuccess<TaskDto>>(`/tasks/${id}`, input).then((r) => r.data),
    onSettled: invalidate,
  });
}

type ListSnapshot = Array<[QueryKey, ApiPage<TaskDto> | undefined]>;

/**
 * Optimistic status change: the checkbox flips instantly; on failure every cached
 * list is restored from the snapshot, then refetched either way.
 */
export function useSetTaskStatus() {
  const qc = useQueryClient();
  const invalidate = useInvalidateTaskData();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      api.patch<ApiSuccess<TaskDto>>(`/tasks/${id}/status`, { status }).then((r) => r.data),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: taskKeys.lists() });
      const snapshot: ListSnapshot = qc.getQueriesData<ApiPage<TaskDto>>({ queryKey: taskKeys.lists() });
      qc.setQueriesData<ApiPage<TaskDto>>({ queryKey: taskKeys.lists() }, (page) =>
        page
          ? {
              ...page,
              data: page.data.map((t) =>
                t.id === id
                  ? { ...t, status, completedAt: status === 'completed' ? new Date().toISOString() : null }
                  : t,
              ),
            }
          : page,
      );
      return { snapshot };
    },
    onError: (_err, _vars, ctx) => ctx?.snapshot.forEach(([key, data]) => qc.setQueryData(key, data)),
    onSettled: invalidate,
  });
}

export function useDeleteTask() {
  const invalidate = useInvalidateTaskData();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: invalidate,
  });
}
