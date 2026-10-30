import { describe, expect, it } from 'vitest';
import { dateInputToDueIso, dueInfo, dueIsoToDateInput } from './dates';

describe('due dates', () => {
  it('stores the end of the chosen local day and round-trips to the same calendar day', () => {
    const iso = dateInputToDueIso('2026-11-05')!;
    const d = new Date(iso);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      2026, 10, 5, 23, 59,
    ]);
    expect(dueIsoToDateInput(iso)).toBe('2026-11-05');
  });

  it('treats an empty input as no due date', () => {
    expect(dateInputToDueIso('')).toBeNull();
    expect(dueIsoToDateInput(null)).toBe('');
  });

  it('classifies due states relative to now', () => {
    const now = new Date(2026, 9, 29, 12, 0);
    const endOf = (offsetDays: number) => new Date(2026, 9, 29 + offsetDays, 23, 59, 59, 999).toISOString();
    expect(dueInfo(endOf(0), 'todo', now)).toEqual({ label: 'Due today', state: 'today' });
    expect(dueInfo(endOf(1), 'todo', now)).toEqual({ label: 'Due tomorrow', state: 'soon' });
    expect(dueInfo(endOf(-2), 'todo', now)).toEqual({ label: 'Overdue by 2 days', state: 'overdue' });
    expect(dueInfo(endOf(-1), 'todo', now)).toEqual({ label: 'Overdue by 1 day', state: 'overdue' });
    expect(dueInfo(endOf(-2), 'completed', now).state).toBe('done');
    expect(dueInfo(null, 'todo', now).state).toBe('none');
  });
});
