import * as AlertPrimitive from '@radix-ui/react-alert-dialog';
import type { ReactNode } from 'react';
import { Button } from './button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  children?: ReactNode;
}

/**
 * Confirmation for destructive actions. AlertDialog semantics: focus starts on
 * Cancel, Escape cancels, and clicking outside does not dismiss.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  children,
}: ConfirmDialogProps) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-900/40 data-[state=open]:animate-fade-in" />
        <AlertPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl data-[state=open]:animate-zoom-in">
          <AlertPrimitive.Title className="text-lg font-semibold text-slate-900">
            {title}
          </AlertPrimitive.Title>
          <AlertPrimitive.Description className="mt-2 text-sm text-slate-600">
            {description}
          </AlertPrimitive.Description>
          {children}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertPrimitive.Cancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertPrimitive.Cancel>
            <Button
              variant="destructive"
              loading={pending}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}
