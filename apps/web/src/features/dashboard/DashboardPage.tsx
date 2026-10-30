import type { ApiSuccess, DashboardSummary, TaskDto } from '@taskmanager/contracts';
import { useQuery } from '@tanstack/react-query';
import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Circle,
  Layers,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState } from '@/components/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/AuthProvider';
import { DASHBOARD_KEY } from '@/features/tasks/api';
import { DueLabel, PriorityBadge, StatusBadge } from '@/features/tasks/task-badges';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/dates';
import { cn } from '@/lib/utils';

function useDashboard() {
  return useQuery({
    queryKey: DASHBOARD_KEY,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<DashboardSummary>>('/dashboard/summary', signal).then((r) => r.data),
  });
}

function StatCard({
  label,
  value,
  icon: Icon,
  to,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  to: string;
  tone: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200 hover:shadow"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span className={cn('rounded-lg p-2', tone)}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-3 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
    </Link>
  );
}

function MiniTaskList({
  tasks,
  empty,
  meta,
}: {
  tasks: TaskDto[];
  empty: string;
  meta: (t: TaskDto) => React.ReactNode;
}) {
  if (tasks.length === 0) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0">
            <p
              className={cn(
                'truncate text-sm font-medium',
                t.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900',
              )}
            >
              {t.title}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">{meta(t)}</div>
          </div>
          <PriorityBadge priority={t.priority} />
        </li>
      ))}
    </ul>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-24 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const { data, isPending, isError, error, refetch, isFetching } = useDashboard();
  const firstName = user?.name.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Hi {firstName}</h1>
        <p className="mt-1 text-sm text-slate-500">Here&apos;s where things stand today.</p>
      </div>

      {isPending ? (
        <DashboardSkeleton />
      ) : isError ? (
        <Card>
          <ErrorState error={error} onRetry={() => void refetch()} retrying={isFetching} />
        </Card>
      ) : data.counts.total === 0 ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="Nothing here yet"
            description="Once you add tasks, your progress and upcoming deadlines will show up here."
            action={
              <Link to="/tasks" className="text-sm font-medium text-indigo-600 hover:underline">
                Go to tasks →
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard
              label="Total"
              value={data.counts.total}
              icon={Layers}
              to="/tasks"
              tone="bg-slate-100 text-slate-600"
            />
            <StatCard
              label="To do"
              value={data.counts.todo}
              icon={Circle}
              to="/tasks?status=todo"
              tone="bg-slate-100 text-slate-600"
            />
            <StatCard
              label="In progress"
              value={data.counts.inProgress}
              icon={CircleDot}
              to="/tasks?status=in_progress"
              tone="bg-sky-50 text-sky-600"
            />
            <StatCard
              label="Completed"
              value={data.counts.completed}
              icon={CheckCircle2}
              to="/tasks?status=completed"
              tone="bg-emerald-50 text-emerald-600"
            />
            <StatCard
              label="Overdue"
              value={data.counts.overdue}
              icon={AlarmClock}
              to="/tasks?overdue=true"
              tone="bg-red-50 text-red-600"
            />
          </section>

          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-700" id="completion-label">
                  Completion
                </span>
                <span className="font-semibold tabular-nums text-slate-900">{data.completionRate}%</span>
              </div>
              <div
                className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-labelledby="completion-label"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={data.completionRate}
              >
                <div
                  className="h-full rounded-full bg-indigo-600 transition-[width]"
                  style={{ width: `${data.completionRate}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {data.counts.completed} of {data.counts.total} tasks completed
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarClock className="size-4 text-indigo-600" aria-hidden /> Upcoming deadlines
                  </CardTitle>
                  <CardDescription>Due in the next 7 days</CardDescription>
                </div>
                <Link
                  to="/tasks?sortBy=dueDate&sortOrder=asc"
                  className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
                >
                  View all <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </CardHeader>
              <CardContent>
                <MiniTaskList
                  tasks={data.upcoming}
                  empty="No deadlines in the next week."
                  meta={(t) => <DueLabel dueDate={t.dueDate} status={t.status} />}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Recently updated</CardTitle>
                  <CardDescription>Your latest activity</CardDescription>
                </div>
                <Link
                  to="/tasks"
                  className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline"
                >
                  View all <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              </CardHeader>
              <CardContent>
                <MiniTaskList
                  tasks={data.recent}
                  empty="No recent activity."
                  meta={(t) => (
                    <>
                      <StatusBadge status={t.status} />
                      <span className="text-xs text-slate-500">updated {timeAgo(t.updatedAt)}</span>
                    </>
                  )}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
