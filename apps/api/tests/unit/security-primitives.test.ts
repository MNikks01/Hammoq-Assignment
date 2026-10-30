import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env';
import { createCsrf } from '../../src/middleware/csrf';
import { FailoverRedisStore } from '../../src/middleware/rate-limit';
import { createTokenService } from '../../src/modules/auth/tokens';
import { REDACT_PATHS } from '../../src/observability/logger';

const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://x',
  ACCESS_TOKEN_SECRET: 'unit-access-secret-0123456789abcdef-012345',
  COOKIE_SECRET: 'unit-cookie-secret-0123456789abcdef-6789ab',
});

describe('CSRF tokens', () => {
  const csrf = createCsrf(config);
  it('accepts only tokens signed with the server secret', () => {
    const other = createCsrf({ ...config, COOKIE_SECRET: 'z'.repeat(40) });
    const fakeReq = { cookies: {} } as never;
    const res = { cookie: () => undefined } as never;
    const token = csrf.issue(fakeReq, res);
    expect(csrf.isValid(token)).toBe(true);
    expect(other.isValid(token)).toBe(false);
    expect(csrf.isValid('abc')).toBe(false);
    expect(csrf.isValid(`${token}.extra`)).toBe(false);
  });
});

describe('access tokens', () => {
  const tokens = createTokenService(config);
  const sub = '0123456789abcdef01234567';

  it('round-trips claims', async () => {
    const t = await tokens.signAccess({ sub, sid: 's1' });
    expect(await tokens.verifyAccess(t)).toEqual({ sub, sid: 's1' });
  });

  it('rejects tokens signed with another key or with alg=none', async () => {
    const other = createTokenService({ ...config, ACCESS_TOKEN_SECRET: 'q'.repeat(40) });
    const t = await other.signAccess({ sub, sid: 's1' });
    await expect(tokens.verifyAccess(t)).rejects.toThrow();
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(`{"sub":"${sub}","sid":"x"}`).toString('base64url')}.`;
    await expect(tokens.verifyAccess(none)).rejects.toThrow();
  });
});

describe('FailoverRedisStore', () => {
  it('uses the local store when Redis is not ready', async () => {
    const store = new FailoverRedisStore({ status: 'end' } as unknown as Redis, 'test');
    store.init({ windowMs: 1000 } as never);
    expect((await store.increment('k')).totalHits).toBe(1);
    expect((await store.increment('k')).totalHits).toBe(2);
    await store.resetKey('k');
    expect((await store.increment('k')).totalHits).toBe(1);
  });
});

describe('log redaction', () => {
  it('covers credentials and session material', () => {
    for (const p of [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
    ]) {
      expect(REDACT_PATHS).toContain(p);
    }
  });
});
