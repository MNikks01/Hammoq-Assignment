import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN, registerSchema, type RegisterInput } from '@taskmanager/contracts';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from './AuthProvider';
import { FormAlert } from './LoginPage';

export function RegisterPage() {
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await signUp(values);
      toast.success('Account created. Welcome!');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError('email', { message: err.message });
      } else if (err instanceof ApiError && err.details.length) {
        for (const d of err.details) setError(d.path as keyof RegisterInput, { message: d.message });
      } else {
        setError('root', { message: errorMessage(err) });
      }
    }
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Create your account</h1>
      <p className="mt-1 text-sm text-slate-500">Start organizing your work in under a minute.</p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        <FormAlert message={errors.root?.message} />
        <Field id="name" label="Name" error={errors.name?.message}>
          {(aria) => <Input autoComplete="name" autoFocus {...aria} {...register('name')} />}
        </Field>
        <Field id="email" label="Email" error={errors.email?.message}>
          {(aria) => <Input type="email" autoComplete="email" {...aria} {...register('email')} />}
        </Field>
        <Field
          id="password"
          label="Password"
          error={errors.password?.message}
          hint={`At least ${PASSWORD_MIN} characters, including a letter and a number.`}
        >
          {(aria) => (
            <Input type="password" autoComplete="new-password" {...aria} {...register('password')} />
          )}
        </Field>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
