import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectRedis, createRedis, isRedisReady } from '../../src/cache/redis';
import { buildApp, createTask, signUp } from './helpers';

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe('dashboard summary', () => {
  it('reflects persisted data: counts, overdue, completion rate, recent and upcoming', async () => {
    const app = buildApp();
    const { client } = await signUp(app);
    await createTask(client, { title: 'overdue', dueDate: iso(-DAY) });
    await createTask(client, { title: 'upcoming', status: 'in_progress', dueDate: iso(2 * DAY) });
    await createTask(client, { title: 'far future', dueDate: iso(30 * DAY) });
    await createTask(client, { title: 'done late', status: 'completed', dueDate: iso(-3 * DAY) });

    const { body } = await client.get('/api/v1/dashboard/summary').expect(200);
    expect(body.data.counts).toEqual({ total: 4, todo: 2, inProgress: 1, completed: 1, overdue: 1 });
    expect(body.data.completionRate).toBe(25);
    expect(body.data.upcoming.map((t: { title: string }) => t.title)).toEqual(['upcoming']);
    expect(body.data.recent).toHaveLength(4);
    expect(body.data.recent[0].title).toBe('done late');
  });

  it('returns zeros for a new user', async () => {
    const { client } = await signUp(buildApp());
    const { body } = await client.get('/api/v1/dashboard/summary').expect(200);
    expect(body.data.counts.total).toBe(0);
    expect(body.data.completionRate).toBe(0);
  });
});

describe('dashboard cache (real Redis)', () => {
  const redis = createRedis(process.env.REDIS_URL_TEST ?? 'redis://127.0.0.1:6379');
  beforeAll(async () => {
    await connectRedis(redis);
  });
  afterAll(async () => {
    await redis.quit().catch(() => undefined);
  });

  it('serves cached summaries and invalidates them on every task mutation', async (ctx) => {
    if (!isRedisReady(redis)) ctx.skip();
    const app = buildApp({ DASHBOARD_CACHE_TTL_SECONDS: '60' }, redis);
    const { client } = await signUp(app);

    const first = await client.get('/api/v1/dashboard/summary').expect(200);
    const second = await client.get('/api/v1/dashboard/summary').expect(200);
    // Cache hit: identical generation timestamp.
    expect(second.body.data.generatedAt).toBe(first.body.data.generatedAt);

    const t = await createTask(client, { title: 'new' });
    const afterCreate = await client.get('/api/v1/dashboard/summary').expect(200);
    expect(afterCreate.body.data.counts.total).toBe(1);

    await client.patch(`/api/v1/tasks/${t.id}/status`, { status: 'completed' }).expect(200);
    const afterStatus = await client.get('/api/v1/dashboard/summary').expect(200);
    expect(afterStatus.body.data.counts.completed).toBe(1);

    await client.delete(`/api/v1/tasks/${t.id}`).expect(204);
    const afterDelete = await client.get('/api/v1/dashboard/summary').expect(200);
    expect(afterDelete.body.data.counts.total).toBe(0);
  });

  it('isolates cache entries per user', async (ctx) => {
    if (!isRedisReady(redis)) ctx.skip();
    const app = buildApp({ DASHBOARD_CACHE_TTL_SECONDS: '60' }, redis);
    const a = await signUp(app);
    const b = await signUp(app);
    await createTask(a.client, { title: 'a1' });
    await a.client.get('/api/v1/dashboard/summary').expect(200);
    const bs = await b.client.get('/api/v1/dashboard/summary').expect(200);
    expect(bs.body.data.counts.total).toBe(0);
  });
});
