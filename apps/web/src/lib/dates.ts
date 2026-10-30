import type { TaskStatus } from '@taskmanager/contracts';
import { differenceInCalendarDays, format, formatDistanceToNowStrict } from 'date-fns';

/**
 * A due date is picked as a calendar day in the user's time zone and stored as an
 * absolute instant: the last millisecond of that local day. "Due Friday" therefore
 * stays not-overdue until the user's own midnight, regardless of server time zone.
 */
export function dateInputToDueIso(value: string): string | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
}

export function dueIsoToDateInput(iso: string | null): string {
  return iso ? format(new Date(iso), 'yyyy-MM-dd') : '';
}

export type DueState = 'none' | 'overdue' | 'today' | 'soon' | 'later' | 'done';

export function dueInfo(
  iso: string | null,
  status: TaskStatus,
  now: Date = new Date(),
): { label: string; state: DueState } {
  if (!iso) return { label: 'No due date', state: 'none' };
  const due = new Date(iso);
  const days = differenceInCalendarDays(due, now);
  if (status === 'completed') return { label: `Due ${format(due, 'MMM d')}`, state: 'done' };
  if (due.getTime() < now.getTime()) {
    const late = Math.max(1, -days);
    return { label: `Overdue by ${late} day${late === 1 ? '' : 's'}`, state: 'overdue' };
  }
  if (days === 0) return { label: 'Due today', state: 'today' };
  if (days === 1) return { label: 'Due tomorrow', state: 'soon' };
  if (days < 7) return { label: `Due ${format(due, 'EEEE')}`, state: 'soon' };
  return {
    label: `Due ${format(due, due.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy')}`,
    state: 'later',
  };
}

export function timeAgo(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

export function longDate(iso: string): string {
  return format(new Date(iso), 'MMMM d, yyyy');
}
