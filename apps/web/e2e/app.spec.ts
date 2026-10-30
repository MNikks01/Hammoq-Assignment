import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = 'e2ePassword2026';
const unique = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.test`;

async function register(page: Page, name: string, email: string) {
  await page.goto('/register');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function signOut(page: Page) {
  await page
    .getByRole('button', { name: /Account menu/ })
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function createTask(
  page: Page,
  title: string,
  opts: { priority?: string; tags?: string; description?: string } = {},
) {
  await page.getByRole('button', { name: 'New task' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  await dialog.getByLabel('Title').fill(title);
  if (opts.description) await dialog.getByLabel('Description').fill(opts.description);
  if (opts.priority) await dialog.getByLabel('Priority').selectOption(opts.priority);
  if (opts.tags) await dialog.getByLabel('Tags').fill(opts.tags);
  await dialog.getByRole('button', { name: 'Create task' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
}

test('complete task lifecycle for a new user', async ({ page }) => {
  const email = unique('alice');

  // 1. Register -> lands on an empty dashboard.
  await register(page, 'Alice Example', email);
  await expect(page.getByRole('heading', { name: 'Hi Alice' })).toBeVisible();
  await expect(page.getByText('Nothing here yet')).toBeVisible();

  // 2. Sign out and sign back in.
  await signOut(page);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // 3. Create tasks.
  await page.getByRole('link', { name: 'Tasks' }).first().click();
  await expect(page.getByText('No tasks yet')).toBeVisible();
  await createTask(page, 'Prepare quarterly report', {
    priority: 'high',
    tags: 'work, q4',
    description: 'Numbers for Q4',
  });
  await createTask(page, 'Buy groceries', { priority: 'low', tags: 'home' });

  // 4. Edit a task.
  await page.getByRole('button', { name: 'Prepare quarterly report', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit task' });
  await expect(edit.getByLabel('Title')).toHaveValue('Prepare quarterly report');
  await edit.getByLabel('Title').fill('Prepare Q4 financial report');
  await edit.getByLabel('Status').selectOption('in_progress');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toBeHidden();
  const row = page.getByTestId('task-row').filter({ hasText: 'Prepare Q4 financial report' });
  await expect(row.getByText('In progress')).toBeVisible();

  // 5. Mark as completed via the checkbox.
  await row.getByRole('button', { name: /as completed/ }).click();
  await expect(row.getByText('Completed')).toBeVisible();

  // 6. Filters and search.
  await page.getByLabel('Status').selectOption('completed');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page).toHaveURL(/status=completed/);
  await page.getByLabel('Status').selectOption('');
  await page.getByLabel('Search tasks').fill('groceries');
  await expect(page.getByTestId('task-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Buy groceries', exact: true })).toBeVisible();
  await page.getByLabel('Search tasks').fill('nonexistentword');
  await expect(page.getByText('No matching tasks')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByTestId('task-row')).toHaveCount(2);

  // Dashboard reflects persisted data.
  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  await expect(page.getByText('50%')).toBeVisible();

  // 7. Delete with confirmation.
  await page.getByRole('link', { name: 'Tasks' }).first().click();
  await page.getByRole('button', { name: 'Actions for "Buy groceries"' }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete this task?' });
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Delete task' }).click();
  await expect(page.getByRole('button', { name: 'Buy groceries', exact: true })).toBeHidden();
  await expect(page.getByTestId('task-row')).toHaveCount(1);

  // 8. Refresh keeps the session (HttpOnly cookies + /auth/me).
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(page.getByTestId('task-row')).toHaveCount(1);

  // 9. Sign out removes access, both in the UI and at the API.
  await signOut(page);
  await page.goto('/tasks');
  await expect(page).toHaveURL(/\/login$/);
  const res = await page.request.get('/api/v1/tasks');
  expect(res.status()).toBe(401);
});

test('a second user cannot see or access the first user’s tasks', async ({ browser }) => {
  const alice = await browser.newContext();
  const a = await alice.newPage();
  await register(a, 'Alice Owner', unique('owner'));
  await a.goto('/tasks');
  await createTask(a, 'Alice private plan');
  const list = await a.request.get('/api/v1/tasks');
  const taskId = ((await list.json()) as { data: Array<{ id: string }> }).data[0]!.id;

  const bob = await browser.newContext();
  const b = await bob.newPage();
  await register(b, 'Bob Intruder', unique('intruder'));
  await b.goto('/tasks');
  await expect(b.getByText('No tasks yet')).toBeVisible();
  expect((await b.request.get(`/api/v1/tasks/${taskId}`)).status()).toBe(404);

  await alice.close();
  await bob.close();
});

test('key pages have no serious accessibility violations', async ({ page }) => {
  await page.goto('/login');
  const login = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(login.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

  await register(page, 'Axe Tester', unique('axe'));
  await page.goto('/tasks');
  await createTask(page, 'Accessible task', { priority: 'high', tags: 'a11y' });
  // Toasts animate opacity on entry; scanning mid-fade reports blended colours as low contrast.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 });
  const tasks = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(tasks.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});

test('mobile navigation works @mobile', async ({ page }) => {
  await register(page, 'Mobile User', unique('mobile'));
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible();
});
