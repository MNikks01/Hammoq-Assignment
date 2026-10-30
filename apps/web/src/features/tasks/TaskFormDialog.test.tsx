import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { TaskFormDialog } from './TaskFormDialog';

const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<typeof ApiModule>()),
  api: {
    post: (...a: unknown[]) => post(...a),
    patch: (...a: unknown[]) => patch(...a),
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

function renderDialog(props: Partial<Parameters<typeof TaskFormDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <TaskFormDialog open onOpenChange={onOpenChange} {...props} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe('TaskFormDialog', () => {
  beforeEach(() => {
    post.mockReset();
    patch.mockReset();
  });

  it('is an accessible dialog with focus on the title field', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'New task' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveFocus();
  });

  it('shows validation errors and does not submit invalid input', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.type(screen.getByLabelText('Tags'), 'Bad Tag!');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(screen.getByText(/lowercase letters, numbers and dashes/)).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-invalid', 'true');
    expect(post).not.toHaveBeenCalled();
  });

  it('submits a normalized payload and closes', async () => {
    post.mockResolvedValue({ data: { id: '1' } });
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    await user.type(screen.getByLabelText('Title'), '  Ship release  ');
    await user.selectOptions(screen.getByLabelText('Priority'), 'high');
    await user.type(screen.getByLabelText('Tags'), 'Work, work, q4');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(post).toHaveBeenCalledWith('/tasks', {
      title: 'Ship release',
      description: '',
      status: 'todo',
      priority: 'high',
      dueDate: null,
      tags: ['work', 'q4'],
    });
  });

  it('sends the version when editing', async () => {
    patch.mockResolvedValue({ data: { id: 't1' } });
    const user = userEvent.setup();
    renderDialog({
      task: {
        id: 't1',
        title: 'Old',
        description: '',
        status: 'todo',
        priority: 'low',
        dueDate: null,
        tags: [],
        completedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 4,
      },
    });
    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'New');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(patch).toHaveBeenCalled());
    expect(patch.mock.calls[0]![0]).toBe('/tasks/t1');
    expect(patch.mock.calls[0]![1]).toMatchObject({ version: 4, title: 'New' });
  });
});
