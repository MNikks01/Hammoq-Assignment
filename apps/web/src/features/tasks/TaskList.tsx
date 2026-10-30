import type { TaskDto, TaskStatus } from '@taskmanager/contracts';
import { CheckCircle2, Circle, CircleDot, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { DueLabel, PriorityBadge, StatusBadge } from './task-badges';

interface RowActions {
  onEdit: (task: TaskDto) => void;
  onDelete: (task: TaskDto) => void;
  onStatus: (task: TaskDto, status: TaskStatus) => void;
}

function TaskRow({ task, onEdit, onDelete, onStatus }: { task: TaskDto } & RowActions) {
  const done = task.status === 'completed';
  return (
    <li className="group flex items-start gap-3 px-4 py-4 sm:px-5" data-testid="task-row">
      <button
        type="button"
        onClick={() => onStatus(task, done ? 'todo' : 'completed')}
        aria-label={done ? `Mark "${task.title}" as not completed` : `Mark "${task.title}" as completed`}
        aria-pressed={done}
        className={cn(
          'mt-0.5 shrink-0 rounded-full transition-colors',
          done ? 'text-emerald-600 hover:text-emerald-700' : 'text-slate-300 hover:text-indigo-500',
        )}
      >
        {done ? <CheckCircle2 className="size-5" aria-hidden /> : <Circle className="size-5" aria-hidden />}
      </button>

      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onEdit(task)}
          className={cn(
            'block max-w-full truncate text-left text-sm font-medium hover:text-indigo-700',
            done ? 'text-slate-400 line-through' : 'text-slate-900',
          )}
        >
          {task.title}
        </button>
        {task.description && <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">{task.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          <DueLabel dueDate={task.dueDate} status={task.status} />
          {task.tags.map((t) => (
            <span key={t} className="text-xs text-slate-500">
              #{t}
            </span>
          ))}
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for "${task.title}"`} className="shrink-0">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit(task)}>
            <Pencil /> Edit
          </DropdownMenuItem>
          {task.status !== 'in_progress' && (
            <DropdownMenuItem onSelect={() => onStatus(task, 'in_progress')}>
              <CircleDot /> Mark in progress
            </DropdownMenuItem>
          )}
          {task.status !== 'todo' && (
            <DropdownMenuItem onSelect={() => onStatus(task, 'todo')}>
              <Circle /> Mark to do
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => onDelete(task)}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function TaskList({ tasks, ...actions }: { tasks: TaskDto[] } & RowActions) {
  return (
    <ul className="divide-y divide-slate-100" aria-label="Tasks">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} {...actions} />
      ))}
    </ul>
  );
}

export function TaskListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-slate-100" aria-busy="true" aria-label="Loading tasks">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-start gap-3 px-5 py-4">
          <Skeleton className="size-5 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}
