import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const WEAK_SECRET_MARKERS = ['change-me', 'changeme', 'secret', 'example', 'placeholder'];

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().url()).min(1)),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(1000).default(50),
    MONGODB_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(100).default(0),
    MONGODB_AUTO_INDEX: z.preprocess(emptyToUndefined, bool.optional()),
    DB_QUERY_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),

    REDIS_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),

    ACCESS_TOKEN_SECRET: z.string().min(32, 'ACCESS_TOKEN_SECRET must be at least 32 characters'),
    COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters'),
    ACCESS_TOKEN_TTL: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL: z.coerce
      .number()
      .int()
      .min(3600)
      .max(60 * 60 * 24 * 30)
      .default(60 * 60 * 24 * 7),
    SESSION_ABSOLUTE_TTL: z.coerce
      .number()
      .int()
      .min(3600)
      .max(60 * 60 * 24 * 90)
      .default(60 * 60 * 24 * 30),
    COOKIE_SECURE: z.preprocess(emptyToUndefined, bool.optional()),

    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),

    RATE_LIMIT_ENABLED: z.preprocess(emptyToUndefined, bool.default(true)),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .default(15 * 60_000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
    LOGIN_ACCOUNT_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    SEARCH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),

    MAX_IN_FLIGHT: z.coerce.number().int().min(1).default(2_000),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(120_000).default(10_000),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20_000),

    DASHBOARD_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(60),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    METRICS_TOKEN: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['ACCESS_TOKEN_SECRET', 'COOKIE_SECRET'] as const) {
      const v = env[key].toLowerCase();
      if (WEAK_SECRET_MARKERS.some((m) => v.includes(m))) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} looks like a placeholder` });
      }
    }
    if (env.ACCESS_TOKEN_SECRET === env.COOKIE_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['COOKIE_SECRET'], message: 'Secrets must be distinct' });
    }
    if (env.COOKIE_SECURE === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'Cookies must be Secure in production',
      });
    }
    if (env.WEB_ORIGIN.some((o) => !o.startsWith('https://'))) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'WEB_ORIGIN must use https in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface Config extends Omit<Env, 'COOKIE_SECURE' | 'MONGODB_AUTO_INDEX'> {
  isProduction: boolean;
  isTest: boolean;
  COOKIE_SECURE: boolean;
  MONGODB_AUTO_INDEX: boolean;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.map(String).join('.') || 'env'}: ${i.message}`,
    );
    // Never echo values: they may be secrets.
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  return {
    ...env,
    isProduction,
    isTest: env.NODE_ENV === 'test',
    COOKIE_SECURE: env.COOKIE_SECURE ?? isProduction,
    // Production index builds are an explicit deployment step (npm run db:indexes).
    MONGODB_AUTO_INDEX: env.MONGODB_AUTO_INDEX ?? !isProduction,
  };
}
