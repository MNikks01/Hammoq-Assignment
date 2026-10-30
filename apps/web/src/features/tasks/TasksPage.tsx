import type { TaskDto, TaskStatus } from '@taskmanager/contracts';
import { ChevronLeft, ChevronRight, ListChecks, Plus, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState, ErrorState } from '@/components/states';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { errorMessage } from '@/lib/api';
import {
  filtersFromParams,
  filtersToParams,
  useDeleteTask,
  useSetTaskStatus,
  useTasks,
  type TaskFilters as Filters,
} from './api';
import { STATUS_LABEL } from './task-badges';
import { TaskFilters } from './TaskFilters';
import { TaskFormDialog } from './TaskFormDialog';
import { TaskList, TaskListSkeleton } from './TaskList';

export function TasksPage() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);

  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300);

  const update = (patch: Partial<Filters>) => {
    // Any filter change resets to page 1 unless the page itself is what changed.
    setParams(filtersToParams({ ...filters, page: 1, ...patch }), { replace: !('page' in patch) });
  };

  useEffect(() => {
    if ((debouncedSearch || undefined) !== filters.search) update({ search: debouncedSearch || undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to the debounced value
  }, [debouncedSearch]);

  const { data, isPending, isError, error, refetch, isFetching, isPlaceholderData } = useTasks(filters);
  const setStatus = useSetTaskStatus();
  const remove = useDeleteTask();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TaskDto | null>(null);
  const [deleting, setDeleting] = useState<TaskDto | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (task: TaskDto) => {
    setEditing(task);
    setFormOpen(true);
  };

  const onStatus = (task: TaskDto, status: TaskStatus) =>
    setStatus.mutate(
      { id: task.id, status },
      {
        onSuccess: () => toast.success(`Marked "${task.title}" as ${STATUS_LABEL[status].toLowerCase()}`),
        onError: (err) => toast.error(errorMessage(err)),
      },
    );

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(deleting.id, {
      onSuccess: () => {
        toast.success('Task deleted');
        setDeleting(null);
        // Step back if the last item on this page was removed.
        if (data && data.data.length === 1 && filters.page > 1) update({ page: filters.page - 1 });
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const filtered = Boolean(filters.status || filters.priority || filters.search || filters.overdue);
  const meta = data?.meta;
  const from = meta && meta.total > 0 ? (meta.page - 1) * meta.limit + 1 : 0;
  const to = meta ? Math.min(meta.page * meta.limit, meta.total) : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Tasks</h1>
          <p className="mt-1 text-sm text-slate-500">Everything on your plate, in one place.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus aria-hidden /> New task
        </Button>
      </div>

      <TaskFilters
        filters={filters}
        searchInput={searchInput}
        onSearchInput={setSearchInput}
        onChange={update}
        onClear={() => {
          setSearchInput('');
          setParams(filtersToParams({ sortBy: filters.sortBy, sortOrder: filters.sortOrder }));
        }}
      />

      <Card className={isFetching && isPlaceholderData ? 'opacity-70 transition-opacity' : undefined}>
        {isPending ? (
          <TaskListSkeleton />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} retrying={isFetching} />
        ) : data.data.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={SearchX}
              title="No matching tasks"
              description="Try a different search term or clear the filters."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchInput('');
                    setParams(new URLSearchParams());
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={ListChecks}
              title="No tasks yet"
              description="Create your first task to start tracking your work."
              action={
                <Button onClick={openCreate}>
                  <Plus aria-hidden /> New task
                </Button>
              }
            />
          )
        ) : (
          <TaskList tasks={data.data} onEdit={openEdit} onDelete={setDeleting} onStatus={onStatus} />
        )}
      </Card>

      {meta && meta.total > 0 && (
        <nav
          className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600"
          aria-label="Pagination"
        >
          <p aria-live="polite">
            Showing <span className="font-medium text-slate-900">{from}</span>–
            <span className="font-medium text-slate-900">{to}</span> of{' '}
            <span className="font-medium text-slate-900">{meta.total}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => update({ page: meta.page - 1 })}
            >
              <ChevronLeft aria-hidden /> Previous
            </Button>
            <span>
              Page {meta.page} of {Math.max(1, meta.totalPages)}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => update({ page: meta.page + 1 })}
            >
              Next <ChevronRight aria-hidden />
            </Button>
          </div>
        </nav>
      )}

      <TaskFormDialog open={formOpen} onOpenChange={setFormOpen} task={editing} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this task?"
        description={
          <>
            <span className="font-medium text-slate-900">&ldquo;{deleting?.title}&rdquo;</span> will be
            permanently deleted. This cannot be undone.
          </>
        }
        confirmLabel="Delete task"
        onConfirm={confirmDelete}
        pending={remove.isPending}
      />
    </div>
  );
}
