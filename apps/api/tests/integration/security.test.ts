import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { Task } from '../../src/modules/tasks/task.model';
import { buildApp, Client, createTask, PASSWORD, signUp, testConfig, type Client as C } from './helpers';

const app = buildApp();

describe('cross-user isolation (IDOR)', () => {
  let alice: C;
  let bob: C;
  let aliceTaskId: string;

  beforeAll(async () => {
    ({ client: alice } = await signUp(app, 'Alice'));
    ({ client: bob } = await signUp(app, 'Bob'));
    aliceTaskId = (await createTask(alice, { title: 'Alice private task', description: 'secret' })).id;
  });

  it('hides other users tasks on read (404, not 403, so ids are not confirmed)', async () => {
    const res = await bob.get(`/api/v1/tasks/${aliceTaskId}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('prevents updating, changing status of, or deleting another users task', async () => {
    await bob.patch(`/api/v1/tasks/${aliceTaskId}`, { version: 0, title: 'pwned' }).expect(404);
    await bob.patch(`/api/v1/tasks/${aliceTaskId}/status`, { status: 'completed' }).expect(404);
    await bob.delete(`/api/v1/tasks/${aliceTaskId}`).expect(404);
    const stored = await Task.findById(aliceTaskId).lean();
    expect(stored).toMatchObject({ title: 'Alice private task', status: 'todo', version: 0 });
  });

  it('never lists, searches or counts another users tasks', async () => {
    const list = await bob.get('/api/v1/tasks').expect(200);
    expect(list.body.meta.total).toBe(0);
    const search = await bob.get('/api/v1/tasks?search=private').expect(200);
    expect(search.body.data).toHaveLength(0);
    const dash = await bob.get('/api/v1/dashboard/summary').expect(200);
    expect(dash.body.data.counts.total).toBe(0);
  });
});

describe('mass assignment', () => {
  it('rejects ownership and internal fields on create and update', async () => {
    const { client } = await signUp(app);
    const { user: victim } = await signUp(app);
    const create = await client.post('/api/v1/tasks', { title: 'x', userId: victim.id });
    expect(create.status).toBe(400);
    const t = await createTask(client, { title: 'mine' });
    for (const extra of [{ userId: victim.id }, { completedAt: new Date().toISOString() }, { _id: 'x' }]) {
      await client.patch(`/api/v1/tasks/${t.id}`, { version: 0, title: 'y', ...extra }).expect(400);
    }
    expect(await Task.countDocuments({ userId: victim.id })).toBe(0);
  });
});

describe('NoSQL injection', () => {
  let client: C;
  beforeAll(async () => {
    ({ client } = await signUp(app));
    await createTask(client, { title: 'only task' });
  });

  it('rejects operator objects in bodies', async () => {
    await client.post('/api/v1/tasks', { title: { $gt: '' } }).expect(400);
    const login = await new Client(app).init();
    await login.post('/api/v1/auth/login', { email: { $ne: null }, password: { $ne: null } }).expect(400);
  });

  it('rejects operator-shaped and polluted query strings', async () => {
    for (const qs of [
      'status[$ne]=todo',
      'search[$regex]=.*',
      '$where=1',
      'status=todo&status=completed',
      'sortBy=userId',
    ]) {
      const res = await client.get(`/api/v1/tasks?${qs}`);
      expect(res.status, qs).toBe(400);
    }
  });

  it('treats $-prefixed strings in updates as data, not expressions', async () => {
    const t = await createTask(client, { title: 'x' });
    const res = await client.patch(`/api/v1/tasks/${t.id}`, {
      version: 0,
      title: '$userId',
      description: '$$ROOT',
    });
    expect(res.body.data).toMatchObject({ title: '$userId', description: '$$ROOT' });
  });
});

describe('authentication is required everywhere it should be', () => {
  const id = '0123456789abcdef01234567';
  const routes: Array<[string, string]> = [
    ['get', '/api/v1/tasks'],
    ['get', `/api/v1/tasks/${id}`],
    ['get', '/api/v1/dashboard/summary'],
    ['get', '/api/v1/auth/me'],
  ];
  it.each(routes)('%s %s -> 401', async (method, url) => {
    const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!(url);
    expect(res.status).toBe(401);
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it('rejects unauthenticated writes (CSRF first, then auth)', async () => {
    const c = await new Client(app).init();
    await c.post('/api/v1/tasks', { title: 'x' }).expect(401);
    await c.patch(`/api/v1/tasks/${id}`, { version: 0, title: 'x' }).expect(401);
    await c.delete(`/api/v1/tasks/${id}`).expect(401);
  });
});

describe('CSRF protection', () => {
  it('rejects state-changing requests without a matching, signed token', async () => {
    const { client } = await signUp(app);
    await client.agent.post('/api/v1/tasks').send({ title: 'x' }).expect(403);
    await client.agent.post('/api/v1/tasks').set('x-csrf-token', 'nope').send({ title: 'x' }).expect(403);

    // Attacker-chosen (unsigned) value planted in both cookie and header.
    const forged = await request(app)
      .post('/api/v1/auth/login')
      .set('Cookie', 'tm_csrf=attacker.value')
      .set('x-csrf-token', 'attacker.value')
      .send({ email: 'a@b.co', password: PASSWORD });
    expect(forged.status).toBe(403);
    expect(forged.body.error.code).toBe('CSRF_INVALID');

    await client.post('/api/v1/tasks', { title: 'x' }).expect(201);
  });

  it('issues a readable, SameSite=Strict CSRF cookie', async () => {
    const res = await request(app).get('/api/v1/auth/csrf').expect(200);
    const c = (res.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('tm_csrf='))!;
    expect(c).toMatch(/SameSite=Strict/);
    expect(c).not.toMatch(/HttpOnly/);
  });
});

describe('rate limiting', () => {
  it('limits credential endpoints per IP and answers 429 with Retry-After', async () => {
    const limited = buildApp({ RATE_LIMIT_ENABLED: 'true', AUTH_RATE_LIMIT_MAX: '3' });
    const c = await new Client(limited).init();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push(
        (await c.post('/api/v1/auth/login', { email: `x${i}@example.test`, password: 'whatever12' })).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
    const res = await c.post('/api/v1/auth/login', { email: 'x@example.test', password: 'whatever12' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('limits failed logins per account independently of IP budget', async () => {
    const limited = buildApp({
      RATE_LIMIT_ENABLED: 'true',
      AUTH_RATE_LIMIT_MAX: '100',
      LOGIN_ACCOUNT_RATE_LIMIT_MAX: '2',
    });
    const { email } = await signUp(limited);
    const c = await new Client(limited).init();
    await c.post('/api/v1/auth/login', { email, password: 'wrongpassword1' }).expect(401);
    await c.post('/api/v1/auth/login', { email, password: 'wrongpassword1' }).expect(401);
    // Even the correct password is refused once the account budget is spent.
    await c.post('/api/v1/auth/login', { email, password: PASSWORD }).expect(429);
    // Other accounts are unaffected.
    await c
      .post('/api/v1/auth/login', { email: 'someone-else@example.test', password: 'x1234567890' })
      .expect(401);
  });

  it('limits general API traffic per user', async () => {
    const limited = buildApp({ RATE_LIMIT_ENABLED: 'true', RATE_LIMIT_MAX: '3' });
    const { client } = await signUp(limited);
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await client.get('/api/v1/tasks')).status);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});

describe('HTTP hardening', () => {
  it('sets security headers and hides framework details', async () => {
    const res = await request(app).get('/api/v1/auth/csrf');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('only allows configured origins for credentialed CORS', async () => {
    const ok = await request(app)
      .options('/api/v1/tasks')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(ok.headers['access-control-allow-credentials']).toBe('true');
    const evil = await request(app)
      .options('/api/v1/tasks')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never leaks stack traces or internals in errors', async () => {
    const res = await request(app).get('/api/v1/nope').expect(404);
    expect(res.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Route not found',
      requestId: expect.any(String),
    });
  });

  it('echoes a safe incoming request id and replaces unsafe ones', async () => {
    const good = await request(app).get('/health/live').set('X-Request-Id', 'trace-abc-12345');
    expect(good.headers['x-request-id']).toBe('trace-abc-12345');
    const bad = await request(app).get('/health/live').set('X-Request-Id', '<script>');
    expect(bad.headers['x-request-id']).not.toBe('<script>');
  });
});

describe('health', () => {
  it('reports liveness and readiness, and fails readiness while draining', async () => {
    await request(app).get('/health/live').expect(200);
    const ready = await request(app).get('/health/ready').expect(200);
    expect(ready.body.checks.mongo).toBe('up');
    const draining = createApp({ config: testConfig(), state: { shuttingDown: true } });
    await request(draining).get('/health/ready').expect(503);
    await request(draining).get('/health/live').expect(200);
  });
});
