import { pino, type Logger } from 'pino';

/** Paths that must never reach log storage. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
];

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'task-api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: { level: (label) => ({ level: label }) },
  });
}

export let logger: Logger = createLogger(
  process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
);

export function setLogger(next: Logger): void {
  logger = next;
}
