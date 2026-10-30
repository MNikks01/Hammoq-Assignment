import { TASK_PRIORITIES, TASK_STATUSES, type TaskSortField } from '@taskmanager/contracts';
import { AlarmClock, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form-controls';
import { cn } from '@/lib/utils';
import type { TaskFilters as Filters } from './api';
import { PRIORITY_LABEL, STATUS_LABEL } from './task-badges';

const SORTS: Array<{ value: `${TaskSortField}:${'asc' | 'desc'}`; label: string }> = [
  { value: 'updatedAt:desc', label: 'Last updated' },
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'dueDate:asc', label: 'Due date' },
  { value: 'priority:desc', label: 'Priority (high first)' },
  { value: 'title:asc', label: 'Title (A–Z)' },
];

interface Props {
  filters: Filters;
  searchInput: string;
  onSearchInput: (v: string) => void;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
}

export function TaskFilters({ filters, searchInput, onSearchInput, onChange, onClear }: Props) {
  const active = Boolean(filters.status || filters.priority || filters.search || filters.overdue);
  const sortValue = `${filters.sortBy}:${filters.sortOrder}`;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center" role="search" aria-label="Filter tasks">
      <div className="relative flex-1">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
          aria-hidden
        />
        <label htmlFor="task-search" className="sr-only">
          Search tasks
        </label>
        <Input
          id="task-search"
          type="search"
          placeholder="Search titles and descriptions…"
          className="pl-9"
          value={searchInput}
          maxLength={100}
          onChange={(e) => onSearchInput(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
        <label className="sr-only" htmlFor="filter-status">
          Status
        </label>
        <Select
          id="filter-status"
          className="sm:w-36"
          value={filters.status ?? ''}
          onChange={(e) => onChange({ status: (e.target.value || undefined) as Filters['status'] })}
        >
          <option value="">All statuses</option>
          {TASK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </Select>

        <label className="sr-only" htmlFor="filter-priority">
          Priority
        </label>
        <Select
          id="filter-priority"
          className="sm:w-36"
          value={filters.priority ?? ''}
          onChange={(e) => onChange({ priority: (e.target.value || undefined) as Filters['priority'] })}
        >
          <option value="">All priorities</option>
          {TASK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </Select>

        <label className="sr-only" htmlFor="sort">
          Sort by
        </label>
        <Select
          id="sort"
          className="sm:w-48"
          value={sortValue}
          onChange={(e) => {
            const [sortBy, sortOrder] = e.target.value.split(':') as [TaskSortField, 'asc' | 'desc'];
            onChange({ sortBy, sortOrder });
          }}
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>

        <Button
          type="button"
          variant="outline"
          aria-pressed={Boolean(filters.overdue)}
          onClick={() => onChange({ overdue: filters.overdue ? undefined : true })}
          className={cn(filters.overdue && 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100')}
        >
          <AlarmClock aria-hidden />
          Overdue
        </Button>

        {active && (
          <Button type="button" variant="ghost" onClick={onClear} className="col-span-2 sm:col-span-1">
            <X aria-hidden />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
