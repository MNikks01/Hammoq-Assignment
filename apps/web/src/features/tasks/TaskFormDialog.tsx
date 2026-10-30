import { zodResolver } from '@hookform/resolvers/zod';
import { TASK_LIMITS, TASK_PRIORITIES, TASK_STATUSES, type TaskDto } from '@taskmanager/contracts';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { FormAlert } from '@/features/auth/LoginPage';
import { ApiError, errorMessage } from '@/lib/api';
import { useCreateTask, useUpdateTask } from './api';
import { PRIORITY_LABEL, STATUS_LABEL } from './task-badges';
import { taskFormSchema, toFormValues, toPayload, type TaskFormValues } from './task-form-schema';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing task. */
  task?: TaskDto | null;
}

export function TaskFormDialog({ open, onOpenChange, task }: Props) {
  const editing = Boolean(task);
  const create = useCreateTask();
  const update = useUpdateTask();

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TaskFormValues>({ resolver: zodResolver(taskFormSchema), defaultValues: toFormValues(task) });

  useEffect(() => {
    if (open) reset(toFormValues(task));
  }, [open, task, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const payload = toPayload(values);
    try {
      if (task) {
        await update.mutateAsync({ id: task.id, input: { version: task.version, ...payload } });
        toast.success('Task updated');
      } else {
        await create.mutateAsync(payload);
        toast.success('Task created');
      }
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        toast.error('This task was changed in another tab or device. The latest version has been loaded.');
        onOpenChange(false);
        return;
      }
      if (err instanceof ApiError && err.details.length) {
        for (const d of err.details) {
          if (d.path in values) setError(d.path as keyof TaskFormValues, { message: d.message });
        }
      }
      setError('root', { message: errorMessage(err) });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit task' : 'New task'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Update the details below.' : 'Capture what needs to be done and when.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <FormAlert message={errors.root?.message} />
          <Field id="task-title" label="Title" error={errors.title?.message}>
            {(aria) => <Input maxLength={TASK_LIMITS.titleMax} autoFocus {...aria} {...register('title')} />}
          </Field>
          <Field id="task-description" label="Description" error={errors.description?.message}>
            {(aria) => (
              <Textarea
                rows={3}
                maxLength={TASK_LIMITS.descriptionMax}
                {...aria}
                {...register('description')}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="task-status" label="Status" error={errors.status?.message}>
              {(aria) => (
                <Select {...aria} {...register('status')}>
                  {TASK_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="task-priority" label="Priority" error={errors.priority?.message}>
              {(aria) => (
                <Select {...aria} {...register('priority')}>
                  {TASK_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="task-due"
              label="Due date"
              error={errors.dueDate?.message}
              hint="Due at the end of that day, your time."
            >
              {(aria) => <Input type="date" {...aria} {...register('dueDate')} />}
            </Field>
            <Field
              id="task-tags"
              label="Tags"
              error={errors.tags?.message}
              hint="Comma-separated, e.g. work, q4"
            >
              {(aria) => <Input placeholder="work, planning" {...aria} {...register('tags')} />}
            </Field>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? 'Save changes' : 'Create task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
