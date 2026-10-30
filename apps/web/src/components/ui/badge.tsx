import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset [&_svg]:size-3',
  {
    variants: {
      tone: {
        slate: 'bg-slate-50 text-slate-700 ring-slate-200',
        indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
        blue: 'bg-sky-50 text-sky-700 ring-sky-200',
        green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
        amber: 'bg-amber-50 text-amber-800 ring-amber-200',
        red: 'bg-red-50 text-red-700 ring-red-200',
      },
    },
    defaultVariants: { tone: 'slate' },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
