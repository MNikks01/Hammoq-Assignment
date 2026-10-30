import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp, createTask, signUp, type Client } from './helpers';

const app = buildApp();
const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe('task CRUD', () => {
  let client: Client;
  beforeAll(async () => {
    ({ client } = await signUp(app));
  });

  it('creates with defaults, returns 201 + Location, and reads it back', async () => {
    const res = await client.post('/api/v1/tasks', { title: '  Write report  ', tags: ['Work', 'work'] });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/api/v1/tasks/${res.body.data.id}`);
    expect(res.body.data).toMatchObject({
      title: 'Write report',
      status: 'todo',
      priority: 'medium',
      tags: ['work'],
      dueDate: null,
      completedAt: null,
      version: 0,
    });
    expect(res.body.data).not.toHaveProperty('userId');
    const got = await client.get(`/api/v1/tasks/${res.body.data.id}`).expect(200);
    expect(got.body.data.title).toBe('Write report');
  });

  it('updates fields with optimistic concurrency and reports stale versions as 409', async () => {
    const t = await createTask(client, { title: 'Original' });
    const ok = await client.patch(`/api/v1/tasks/${t.id}`, {
      version: 0,
      title: 'Renamed',
      priority: 'high',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ title: 'Renamed', priority: 'high', version: 1 });

    const stale = await client.patch(`/api/v1/tasks/${t.id}`, { version: 0, title: 'Lost update' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect((await client.get(`/api/v1/tasks/${t.id}`)).body.data.title).toBe('Renamed');
  });

  it('derives completedAt from status transitions', async () => {
    const t = await createTask(client, { title: 'Complete me' });
    const done = await client.patch(`/api/v1/tasks/${t.id}/status`, { status: 'completed' }).expect(200);
    expect(done.body.data.completedAt).toEqual(expect.any(String));

    // Idempotent: completing again keeps the original completion time.
    const again = await client.patch(`/api/v1/tasks/${t.id}/status`, { status: 'completed' }).expect(200);
    expect(again.body.data.completedAt).toBe(done.body.data.completedAt);

    const reopened = await client
      .patch(`/api/v1/tasks/${t.id}/status`, { status: 'in_progress' })
      .expect(200);
    expect(reopened.body.data.completedAt).toBeNull();
  });

  it('can clear a due date and stores client strings literally', async () => {
    const t = await createTask(client, { title: 'x', dueDate: iso(DAY) });
    const res = await client.patch(`/api/v1/tasks/${t.id}`, { version: 0, dueDate: null, title: '$version' });
    expect(res.body.data).toMatchObject({ dueDate: null, title: '$version', version: 1 });
  });

  it('deletes with 204, then 404', async () => {
    const t = await createTask(client, { title: 'Delete me' });
    await client.delete(`/api/v1/tasks/${t.id}`).expect(204);
    await client.delete(`/api/v1/tasks/${t.id}`).expect(404);
    await client.get(`/api/v1/tasks/${t.id}`).expect(404);
  });
});

describe('listing: pagination, filters, search and sort', () => {
  let client: Client;
  beforeAll(async () => {
    ({ client } = await signUp(app));
    const seed = [
      {
        title: 'Quarterly report draft',
        priority: 'high',
        status: 'in_progress',
        dueDate: iso(-2 * DAY),
        tags: ['work'],
      },
      {
        title: 'Book dentist appointment',
        priority: 'low',
        status: 'todo',
        dueDate: iso(3 * DAY),
        tags: ['health'],
      },
      {
        title: 'apple pie recipe',
        priority: 'medium',
        status: 'completed',
        dueDate: iso(-5 * DAY),
        tags: ['home'],
      },
      { title: 'Review budget report', priority: 'medium', status: 'todo', tags: ['work', 'finance'] },
      { title: 'Zebra crossing photos', priority: 'low', status: 'todo', dueDate: iso(10 * DAY) },
    ];
    for (const s of seed) await createTask(client, s);
  });

  it('paginates with metadata and a bounded page size', async () => {
    const p1 = await client.get('/api/v1/tasks?limit=2&page=1').expect(200);
    expect(p1.body.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
    const p3 = await client.get('/api/v1/tasks?limit=2&page=3').expect(200);
    expect(p3.body.data).toHaveLength(1);
    const ids = new Set([...p1.body.data, ...p3.body.data].map((t: { id: string }) => t.id));
    expect(ids.size).toBe(3);
    await client.get('/api/v1/tasks?limit=101').expect(400);
    await client.get('/api/v1/tasks?page=0').expect(400);
  });

  it('filters by status, priority, tag and due range', async () => {
    const byStatus = await client.get('/api/v1/tasks?status=todo').expect(200);
    expect(byStatus.body.meta.total).toBe(3);
    const byPriority = await client.get('/api/v1/tasks?priority=medium').expect(200);
    expect(byPriority.body.meta.total).toBe(2);
    const byTag = await client.get('/api/v1/tasks?tag=work').expect(200);
    expect(byTag.body.meta.total).toBe(2);
    const window = await client
      .get(
        `/api/v1/tasks?dueAfter=${encodeURIComponent(iso(0))}&dueBefore=${encodeURIComponent(iso(7 * DAY))}`,
      )
      .expect(200);
    expect(window.body.data.map((t: { title: string }) => t.title)).toEqual(['Book dentist appointment']);
  });

  it('lists overdue tasks, excluding completed ones', async () => {
    const res = await client.get('/api/v1/tasks?overdue=true').expect(200);
    expect(res.body.data.map((t: { title: string }) => t.title)).toEqual(['Quarterly report draft']);
  });

  it('searches titles and descriptions with the text index', async () => {
    const res = await client.get('/api/v1/tasks?search=report').expect(200);
    expect(res.body.data.map((t: { title: string }) => t.title).sort()).toEqual([
      'Quarterly report draft',
      'Review budget report',
    ]);
    const combined = await client.get('/api/v1/tasks?search=report&status=todo').expect(200);
    expect(combined.body.meta.total).toBe(1);
  });

  it('sorts by priority rank and by title case-insensitively', async () => {
    const pr = await client.get('/api/v1/tasks?sortBy=priority&sortOrder=desc').expect(200);
    expect(pr.body.data[0].priority).toBe('high');
    expect(pr.body.data.at(-1).priority).toBe('low');

    const title = await client.get('/api/v1/tasks?sortBy=title&sortOrder=asc').expect(200);
    expect(title.body.data[0].title).toBe('apple pie recipe');
    expect(title.body.data.at(-1).title).toBe('Zebra crossing photos');
  });

  it('sorts by due date ascending', async () => {
    const res = await client.get('/api/v1/tasks?sortBy=dueDate&sortOrder=asc&status=todo').expect(200);
    const dated = res.body.data.filter((t: { dueDate: string | null }) => t.dueDate);
    const times = dated.map((t: { dueDate: string }) => Date.parse(t.dueDate));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('request validation', () => {
  let client: Client;
  beforeAll(async () => {
    ({ client } = await signUp(app));
  });

  it('rejects malformed ids, unknown fields and empty updates', async () => {
    await client.get('/api/v1/tasks/not-an-id').expect(400);
    await client.post('/api/v1/tasks', { title: 'x', color: 'red' }).expect(400);
    const t = await createTask(client, { title: 'x' });
    await client.patch(`/api/v1/tasks/${t.id}`, { version: 0 }).expect(400);
    await client.patch(`/api/v1/tasks/${t.id}/status`, { status: 'archived' }).expect(400);
  });

  it('returns 404 for well-formed ids that do not exist', async () => {
    await client.get('/api/v1/tasks/0123456789abcdef01234567').expect(404);
  });

  it('enforces body size and content type', async () => {
    const big = await client.post('/api/v1/tasks', { title: 'x', description: 'a'.repeat(20_000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');

    const form = await client.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', client.csrf)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('title=x');
    expect(form.status).toBe(415);

    const malformed = await client.agent
      .post('/api/v1/tasks')
      .set('x-csrf-token', client.csrf)
      .set('Content-Type', 'application/json')
      .send('{"title":');
    expect(malformed.status).toBe(400);
  });
});
