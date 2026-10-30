import { zodResolver } from '@hookform/resolvers/zod';
import {
  changePasswordSchema,
  PASSWORD_MIN,
  type ChangePasswordInput,
  type UserDto,
} from '@taskmanager/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form-controls';
import { useAuth } from '@/features/auth/AuthProvider';
import { FormAlert } from '@/features/auth/LoginPage';
import { api, ApiError, errorMessage } from '@/lib/api';
import { longDate } from '@/lib/dates';

function ChangePasswordCard() {
  const { setUser } = useAuth();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = await api.post<{ data: { user: UserDto } }>('/auth/change-password', values);
      setUser(res.data.user);
      reset();
      toast.success('Password changed. Other devices have been signed out.');
    } catch (err) {
      if (err instanceof ApiError && err.details.length) {
        for (const d of err.details) setError(d.path as keyof ChangePasswordInput, { message: d.message });
      } else setError('root', { message: errorMessage(err) });
    }
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Changing your password signs you out everywhere else.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="max-w-sm space-y-4">
          <FormAlert message={errors.root?.message} />
          <Field id="current-password" label="Current password" error={errors.currentPassword?.message}>
            {(aria) => (
              <Input
                type="password"
                autoComplete="current-password"
                {...aria}
                {...register('currentPassword')}
              />
            )}
          </Field>
          <Field
            id="new-password"
            label="New password"
            error={errors.newPassword?.message}
            hint={`At least ${PASSWORD_MIN} characters, including a letter and a number.`}
          >
            {(aria) => (
              <Input type="password" autoComplete="new-password" {...aria} {...register('newPassword')} />
            )}
          </Field>
          <Button type="submit" loading={isSubmitting}>
            Update password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function DangerZoneCard() {
  const { endSession } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const onConfirm = async () => {
    setPending(true);
    setError(undefined);
    try {
      await api.delete('/users/me', { password });
      endSession();
      toast.success('Your account and all tasks were deleted.');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="border-red-200">
      <CardHeader>
        <div>
          <CardTitle>Delete account</CardTitle>
          <CardDescription>Permanently delete your account and every task in it.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Delete account
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) {
              setPassword('');
              setError(undefined);
            }
          }}
          title="Delete your account?"
          description="This permanently removes your account, sessions and all tasks. It cannot be undone."
          confirmLabel="Delete everything"
          onConfirm={onConfirm}
          pending={pending}
        >
          <div className="mt-4">
            <Field id="delete-password" label="Confirm with your password" error={error}>
              {(aria) => (
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  {...aria}
                />
              )}
            </Field>
          </div>
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your account and security.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Name</dt>
              <dd className="mt-1 font-medium text-slate-900">{user?.name}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Email</dt>
              <dd className="mt-1 break-all font-medium text-slate-900">{user?.email}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Member since</dt>
              <dd className="mt-1 font-medium text-slate-900">{user ? longDate(user.createdAt) : ''}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      <ChangePasswordCard />
      <DangerZoneCard />
    </div>
  );
}
