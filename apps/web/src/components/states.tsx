import { AlertTriangle, Loader2, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError, errorMessage } from '@/lib/api';
import { Button } from './ui/button';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 rounded-full bg-indigo-50 p-3 text-indigo-600">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
  retrying,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const transient = error instanceof ApiError ? error.isRetryable : true;
  return (
    <div role="alert" className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 rounded-full bg-red-50 p-3 text-red-600">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-slate-900">Couldn&apos;t load this</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">{errorMessage(error)}</p>
      {error instanceof ApiError && error.requestId && (
        <p className="mt-2 font-mono text-xs text-slate-400">Reference: {error.requestId}</p>
      )}
      {onRetry && transient && (
        <Button variant="outline" className="mt-5" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function FullPageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-indigo-600" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}
