import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@taskmanager/contracts';
import { AlertCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { errorMessage } from '@/lib/api';
import { useAuth } from './AuthProvider';

const DEMO = { email: 'demo@taskmanager.dev', password: 'DemoPassword2026' };
const showDemoHint = import.meta.env.DEV || import.meta.env.VITE_SHOW_DEMO_HINT === 'true';

export function FormAlert({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (err) {
      setError('root', { message: errorMessage(err) });
    }
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-500">Sign in to continue to your tasks.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        <FormAlert message={errors.root?.message} />
        <Field id="email" label="Email" error={errors.email?.message}>
          {(aria) => <Input type="email" autoComplete="email" autoFocus {...aria} {...register('email')} />}
        </Field>
        <Field id="password" label="Password" error={errors.password?.message}>
          {(aria) => (
            <Input type="password" autoComplete="current-password" {...aria} {...register('password')} />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>

      {showDemoHint && (
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-600">
          Demo account (after <code className="font-mono">npm run seed</code>):{' '}
          <button
            type="button"
            className="font-medium text-indigo-600 hover:underline"
            onClick={() => {
              setValue('email', DEMO.email);
              setValue('password', DEMO.password);
            }}
          >
            fill demo credentials
          </button>
        </div>
      )}

      <p className="mt-8 text-center text-sm text-slate-500">
        New here?{' '}
        <Link to="/register" className="font-medium text-indigo-600 hover:underline">
          Create an account
        </Link>
      </p>
    </div>
  );
}
