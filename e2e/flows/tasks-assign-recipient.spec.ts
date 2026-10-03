import { test, expect, uniqueLabel } from '../fixtures';
import type { Page } from '@playwright/test';
import { dbQuery, sqlStr } from '../unhappy';
import { sqlExec } from '../db';

// A CARE RECIPIENT is an assignable task owner. An independent recipient with
// their own phone gets meal-time task reminders: the backend accepts them as
// `assigned_to` and sends the reminder only to the assignee. The web "Assigned
// to" picker used to filter the recipient out, so these flows could not be
// done from the web at all.
//
// Real backend, real browser, no test hooks. The worker's circle is a clone of
// the demo template, which carries a care recipient WITH an account; the spec
// reads who that is from the database instead of hard-coding a name. The
// assertions read the saved row back from the database (the persisted
// assignee) and the Tasks list (the displayed assignee). Rows created here are
// deleted at the end; the whole circle is purged at teardown regardless.

interface Recipient {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

function recipientOf(circleId: string): Recipient {
  const rows = dbQuery<Recipient>(`
    select m.user_id, u.first_name, u.last_name, u.email
      from circle_memberships m join users u on u.id = m.user_id
     where m.circle_id = ${sqlStr(circleId)}::uuid and m.is_care_recipient = true
     limit 1`);
  if (!rows[0]) throw new Error(`circle ${circleId} has no care recipient with an account`);
  return rows[0];
}

/** How the picker labels the recipient's option (AddEventModal assigneeOptions). */
function optionLabel(r: Recipient): string {
  return `${r.first_name || r.email.split('@')[0]} · Care recipient`;
}

/** How a task row names its assignee (TaskRow memberDisplayName). */
function rowName(r: Recipient): string {
  return [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email;
}

function savedAssignee(circleId: string, title: string): string | null {
  const rows = dbQuery<{ assigned_to: string | null }>(`
    select assigned_to from calendar_events
     where circle_id = ${sqlStr(circleId)}::uuid and title = ${sqlStr(title)}`);
  expect(rows).toHaveLength(1);
  return rows[0].assigned_to;
}

function deleteTask(circleId: string, title: string): void {
  sqlExec(`
    delete from calendar_events
     where circle_id = ${sqlStr(circleId)}::uuid and title = ${sqlStr(title)};`);
}

function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

async function openTasks(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible({ timeout: 15_000 });
}

async function createTask(page: Page, title: string, assigneeLabel?: string): Promise<void> {
  await page.getByRole('button', { name: 'Add task' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#title').fill(title);
  await dialog.locator('#scheduled_date').fill(todayISO());
  const picker = dialog.getByLabel('Assigned to');
  // The default is still "Anyone" (unassigned).
  await expect(picker).toHaveValue('');
  if (assigneeLabel) await picker.selectOption({ label: assigneeLabel });
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
}

function taskRow(page: Page, title: string) {
  return page.getByRole('listitem').filter({
    has: page.getByRole('button', { name: `Mark "${title}" complete` }),
  });
}

test('create a task assigned to the care recipient', async ({ page, circleId }) => {
  const recipient = recipientOf(circleId);
  const title = uniqueLabel('Recipient task');
  try {
    await openTasks(page, circleId);
    await createTask(page, title, optionLabel(recipient));

    // Persisted with the recipient's user id.
    await expect.poll(() => savedAssignee(circleId, title)).toBe(recipient.user_id);

    // Displayed with the recipient's name — not "Unassigned".
    const row = taskRow(page, title);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText(rowName(recipient), { exact: true })).toBeVisible();
    await expect(row.getByText('Unassigned')).toHaveCount(0);

    // Reopening the task keeps the recipient selected (edit hydration).
    await page.getByRole('button', { name: `Edit "${title}"` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Assigned to')).toHaveValue(recipient.user_id);
  } finally {
    deleteTask(circleId, title);
  }
});

test('edit a task and reassign it to the care recipient', async ({ page, circleId }) => {
  const recipient = recipientOf(circleId);
  const title = uniqueLabel('Reassign task');
  try {
    await openTasks(page, circleId);
    await createTask(page, title);
    await expect.poll(() => savedAssignee(circleId, title)).toBeNull();

    const row = taskRow(page, title);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText('Unassigned')).toBeVisible();

    await page.getByRole('button', { name: `Edit "${title}"` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Assigned to').selectOption({ label: optionLabel(recipient) });
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect.poll(() => savedAssignee(circleId, title)).toBe(recipient.user_id);
    await expect(row.getByText(rowName(recipient), { exact: true })).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    deleteTask(circleId, title);
  }
});
