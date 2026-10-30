import { z } from 'zod';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const email = z
  .string({ error: 'Email is required' })
  .trim()
  .min(1, 'Email is required')
  .max(254)
  .email('Enter a valid email address')
  .transform((v) => v.toLowerCase());

const password = z
  .string({ error: 'Password is required' })
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`)
  .refine((v) => /[a-zA-Z]/.test(v) && /\d/.test(v), 'Password must contain a letter and a number');

const name = z.string({ error: 'Name is required' }).trim().min(1, 'Name is required').max(80);

export const registerSchema = z.object({ name, email, password }).strict();

// Login does not re-apply password complexity rules: rules may change over time and
// reporting "too short" on login would leak policy details for no benefit.
export const loginSchema = z
  .object({
    email,
    password: z.string().min(1, 'Password is required').max(PASSWORD_MAX),
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(PASSWORD_MAX),
    newPassword: password,
  })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must differ from the current password',
    path: ['newPassword'],
  });

export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export interface UserDto {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}
