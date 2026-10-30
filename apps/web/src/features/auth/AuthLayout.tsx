import { CheckCircle2 } from 'lucide-react';
import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { FullPageLoader } from '@/components/states';

const POINTS = [
  'Plan work by status, priority and due date',
  'See what is overdue and what is coming up',
  'Your tasks stay private to your account',
];

export function AuthLayout() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <span className="inline-flex items-center gap-2 text-lg font-semibold">
          <span className="flex size-7 items-center justify-center rounded-lg bg-indigo-600">
            <CheckCircle2 className="size-4" aria-hidden />
          </span>
          Taskflow
        </span>
        <div>
          <p className="text-3xl font-semibold leading-tight">Stay on top of everything that matters.</p>
          <ul className="mt-8 space-y-3 text-slate-300">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <CheckCircle2 className="size-5 shrink-0 text-indigo-400" aria-hidden />
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-slate-400">Built as a full-stack TypeScript engineering assessment.</p>
      </div>
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <Suspense fallback={<FullPageLoader />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
