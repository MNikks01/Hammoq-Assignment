import type { TaskPriority, TaskStatus } from '@taskmanager/contracts';
import { ArrowDown, ArrowRight, ArrowUp, CalendarClock, CheckCircle2, Circle, CircleDot } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { dueInfo, type DueState } from '@/lib/dates';
import { cn } from '@/lib/utils';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  completed: 'Completed',
};
export const PRIORITY_LABEL: Record<TaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' };

export function StatusBadge({ status }: { status: TaskStatus }) {
  const map = {
    todo: { tone: 'slate', Icon: Circle },
    in_progress: { tone: 'blue', Icon: CircleDot },
    completed: { tone: 'green', Icon: CheckCircle2 },
  } as const;
  const { tone, Icon } = map[status];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const map = {
    low: { tone: 'slate', Icon: ArrowDown },
    medium: { tone: 'amber', Icon: ArrowRight },
    high: { tone: 'red', Icon: ArrowUp },
  } as const;
  const { tone, Icon } = map[priority];
  return (
    <Badge tone={tone}>
      <Icon aria-hidden />
      <span>
        <span className="sr-only">Priority: </span>
        {PRIORITY_LABEL[priority]}
      </span>
    </Badge>
  );
}

const DUE_STYLE: Record<DueState, string> = {
  none: 'text-slate-400',
  overdue: 'text-red-600 font-medium',
  today: 'text-amber-700 font-medium',
  soon: 'text-slate-700',
  later: 'text-slate-500',
  done: 'text-slate-400',
};

export function DueLabel({
  dueDate,
  status,
  className,
}: {
  dueDate: string | null;
  status: TaskStatus;
  className?: string;
}) {
  const { label, state } = dueInfo(dueDate, status);
  if (state === 'none') return null;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs', DUE_STYLE[state], className)}>
      <CalendarClock className="size-3.5" aria-hidden />
      <time dateTime={dueDate ?? undefined}>{label}</time>
    </span>
  );
}
