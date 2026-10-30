import { describe, expect, it } from 'vitest';
import {
  changePasswordSchema,
  createTaskSchema,
  listTasksQuerySchema,
  registerSchema,
  updateTaskSchema,
} from './index';

describe('registerSchema', () => {
  it('normalizes email case and whitespace', () => {
    const r = registerSchema.parse({ name: ' Ada ', email: '  Ada@Example.COM ', password: 'correcthorse1' });
    expect(r.email).toBe('ada@example.com');
    expect(r.name).toBe('Ada');
  });

  it('rejects weak passwords and unknown fields', () => {
    expect(registerSchema.safeParse({ name: 'a', email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(registerSchema.safeParse({ name: 'a', email: 'a@b.co', password: 'onlyletters' }).success).toBe(
      false,
    );
    expect(
      registerSchema.safeParse({ name: 'a', email: 'a@b.co', password: 'correcthorse1', role: 'admin' })
        .success,
    ).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  it('requires the new password to differ', () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: 'correcthorse1', newPassword: 'correcthorse1' })
        .success,
    ).toBe(false);
  });
});

describe('createTaskSchema', () => {
  it('applies defaults', () => {
    const t = createTaskSchema.parse({ title: 'Write report' });
    expect(t).toMatchObject({ status: 'todo', priority: 'medium', description: '', tags: [], dueDate: null });
  });

  it('dedupes and lowercases tags', () => {
    expect(createTaskSchema.parse({ title: 'x', tags: ['Work', 'work', 'q4'] }).tags).toEqual(['work', 'q4']);
  });

  it('rejects mass-assignment of ownership and internal fields', () => {
    for (const extra of [{ userId: 'a'.repeat(24) }, { version: 3 }, { _id: 'x' }, { completedAt: 'x' }]) {
      expect(createTaskSchema.safeParse({ title: 'x', ...extra }).success).toBe(false);
    }
  });

  it('rejects operator objects in place of strings', () => {
    expect(createTaskSchema.safeParse({ title: { $gt: '' } }).success).toBe(false);
  });

  it('rejects invalid tags and oversized titles', () => {
    expect(createTaskSchema.safeParse({ title: 'x', tags: ['<script>'] }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'x'.repeat(201) }).success).toBe(false);
  });

  it('accepts ISO due dates with offsets and rejects garbage', () => {
    expect(createTaskSchema.safeParse({ title: 'x', dueDate: '2026-11-01T23:59:59.999+05:30' }).success).toBe(
      true,
    );
    expect(createTaskSchema.safeParse({ title: 'x', dueDate: 'tomorrow' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'x', dueDate: '1970-01-01T00:00:00Z' }).success).toBe(false);
  });
});

describe('updateTaskSchema', () => {
  it('requires version and at least one field', () => {
    expect(updateTaskSchema.safeParse({ title: 'x' }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 0 }).success).toBe(false);
    expect(updateTaskSchema.safeParse({ version: 0, title: 'x' }).success).toBe(true);
  });
});

describe('listTasksQuerySchema', () => {
  it('coerces and defaults pagination', () => {
    expect(listTasksQuerySchema.parse({})).toMatchObject({
      page: 1,
      limit: 20,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
    expect(listTasksQuerySchema.parse({ page: '3', limit: '50' })).toMatchObject({ page: 3, limit: 50 });
  });

  it('rejects unbounded limits, unknown sort fields and unknown params', () => {
    expect(listTasksQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ sortBy: 'userId' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ where: '1' }).success).toBe(false);
    expect(listTasksQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('rejects array-valued params (HTTP parameter pollution)', () => {
    expect(listTasksQuerySchema.safeParse({ status: ['todo', 'completed'] }).success).toBe(false);
  });
});
