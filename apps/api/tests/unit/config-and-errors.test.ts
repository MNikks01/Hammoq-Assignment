import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../src/config/env';
import { toAppError } from '../../src/middleware/error-handler';
import { AppError } from '../../src/utils/errors';

const base = {
  MONGODB_URI: 'mongodb://x',
  ACCESS_TOKEN_SECRET: 'Zq8vN2kLp4Wx7Rt1Yb6Hc3Jm9Fd5Gs0Ae2Ui8Ko4',
  COOKIE_SECRET: 'Tw3Er6Yu9Io2Pa5Sd8Fg1Hj4Kl7Zx0Cv3Bn6Mq9Wd',
};

describe('loadConfig', () => {
  it('applies safe development defaults', () => {
    const c = loadConfig({ ...base });
    expect(c.NODE_ENV).toBe('development');
    expect(c.COOKIE_SECURE).toBe(false);
    expect(c.MONGODB_AUTO_INDEX).toBe(true);
    expect(c.WEB_ORIGIN).toEqual(['http://localhost:5173']);
  });

  it('fails fast on missing or short secrets without echoing values', () => {
    expect(() => loadConfig({ MONGODB_URI: 'mongodb://x' })).toThrow(/ACCESS_TOKEN_SECRET/);
    try {
      loadConfig({ ...base, COOKIE_SECRET: 'tooshort-but-secret-value' });
    } catch (e) {
      expect((e as Error).message).not.toContain('tooshort-but-secret-value');
    }
  });

  it('rejects insecure production configuration', () => {
    const prod = { ...base, NODE_ENV: 'production', WEB_ORIGIN: 'https://tasks.example.com' };
    expect(loadConfig(prod).COOKIE_SECURE).toBe(true);
    expect(loadConfig(prod).MONGODB_AUTO_INDEX).toBe(false);
    expect(() => loadConfig({ ...prod, WEB_ORIGIN: 'http://tasks.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...prod, COOKIE_SECURE: 'false' })).toThrow(/Secure/);
    expect(() =>
      loadConfig({ ...prod, ACCESS_TOKEN_SECRET: 'change-me-change-me-change-me-change-me' }),
    ).toThrow(/placeholder/);
    expect(() => loadConfig({ ...prod, COOKIE_SECRET: base.ACCESS_TOKEN_SECRET })).toThrow(/distinct/);
  });
});

describe('toAppError', () => {
  it('maps validation, parser and database errors to safe client errors', () => {
    const zod = z.object({ a: z.string() }).safeParse({});
    expect(toAppError(zod.error)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    expect(toAppError({ type: 'entity.too.large' })).toMatchObject({ status: 413 });
    expect(toAppError({ type: 'entity.parse.failed' })).toMatchObject({ status: 400 });
    expect(toAppError({ code: 11000, message: 'E11000 duplicate key error collection' })).toMatchObject({
      status: 409,
      message: 'Resource already exists',
    });
    expect(toAppError({ name: 'MongoServerSelectionError' })).toMatchObject({ status: 503 });
    expect(
      toAppError({
        name: 'MongooseError',
        message:
          'Cannot call `users.findOne()` before initial connection is complete if `bufferCommands = false`.',
      }),
    ).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    expect(toAppError({ code: 50 })).toMatchObject({ status: 503, code: 'TIMEOUT' });
  });

  it('hides unknown errors behind a generic 500', () => {
    const e = toAppError(new Error('connection string mongodb://admin:hunter2@db'));
    expect(e).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
    expect(e.message).not.toContain('hunter2');
  });

  it('passes AppErrors through unchanged', () => {
    const e = new AppError(409, 'VERSION_CONFLICT', 'x');
    expect(toAppError(e)).toBe(e);
  });
});
