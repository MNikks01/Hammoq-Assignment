import { listTasksQuerySchema } from '@taskmanager/contracts';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { buildTaskFilter, buildTaskSort } from '../../src/modules/tasks/task.query';

const uid = new Types.ObjectId();
const now = new Date('2026-10-29T12:00:00Z');
const q = (raw: Record<string, string>) => listTasksQuerySchema.parse(raw);

describe('buildTaskFilter', () => {
  it('always scopes by user', () => {
    expect(buildTaskFilter(uid, q({}), now)).toEqual({ userId: uid });
  });

  it('maps simple equality filters', () => {
    expect(buildTaskFilter(uid, q({ status: 'todo', priority: 'high', tag: 'work' }), now)).toEqual({
      userId: uid,
      status: 'todo',
      priority: 'high',
      tags: 'work',
    });
  });

  it('builds due-date ranges', () => {
    const f = buildTaskFilter(
      uid,
      q({ dueAfter: '2026-10-01T00:00:00Z', dueBefore: '2026-11-01T00:00:00Z' }),
      now,
    );
    expect(f.dueDate).toEqual({
      $gte: new Date('2026-10-01T00:00:00Z'),
      $lte: new Date('2026-11-01T00:00:00Z'),
    });
  });

  it('overdue excludes completed tasks and respects explicit status', () => {
    expect(buildTaskFilter(uid, q({ overdue: 'true' }), now)).toEqual({
      userId: uid,
      status: { $ne: 'completed' },
      dueDate: { $lt: now },
    });
    expect(buildTaskFilter(uid, q({ overdue: 'true', status: 'in_progress' }), now).status).toBe(
      'in_progress',
    );
    expect(buildTaskFilter(uid, q({ overdue: 'true', status: 'completed' }), now).status).toEqual({
      $in: [],
    });
  });

  it('uses $text for search', () => {
    expect(buildTaskFilter(uid, q({ search: 'report' }), now).$text).toEqual({ $search: 'report' });
  });
});

describe('buildTaskSort', () => {
  it('adds a unique _id tie-breaker in the same direction', () => {
    expect(buildTaskSort({ sortBy: 'updatedAt', sortOrder: 'desc' })).toEqual({ updatedAt: -1, _id: -1 });
    expect(buildTaskSort({ sortBy: 'dueDate', sortOrder: 'asc' })).toEqual({ dueDate: 1, _id: 1 });
  });

  it('sorts priority by numeric rank', () => {
    expect(buildTaskSort({ sortBy: 'priority', sortOrder: 'desc' })).toEqual({ priorityRank: -1, _id: -1 });
  });
});
