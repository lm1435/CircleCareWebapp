import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { dbQuery } from '../unhappy';
import {
  addDaysISO,
  closeDialog,
  dateInTz,
  escapeRegExp,
  gotoWeekContaining,
  materializeRecurringInstances,
  openChip,
  uniqueSuffix,
} from '../notesFirstClassShared';
import { apiCreateEvent } from '../unhappy/writes/_helpers';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';

// A SERIES EDIT OF TIME / ASSIGNEE REACHES THE UPCOMING OCCURRENCES THAT ALREADY
// EXIST AS ROWS (backend bcbd781, 1.4.0).
//
// THE BUG. The hourly materializer mints physical children for today/+1/+2 of
// every recurring task and appointment. A PATCH of the series root moved only
// the root, so those already-materialized upcoming days kept the OLD time and
// the OLD assignee — on the Calendar and in process_task_reminders (the old
// assignee was reminded at the old time). Only the unmaterialized days (+3 on)
// followed the edit.
//
// THE CONTRACT (end to end, through the real web editor):
//   - upcoming (>= recipient today), open, unedited children take the new
//     time / assignee — read from the DB AND from the Calendar detail;
//   - a COMPLETED day (today) and a PAST day keep their old time / assignee.
//
// Scoped owner + member + own circle; the recipient's zone (= the owner's
// users.timezone, no recipient member) is pinned to the browser's so the
// editor's clock fields are the stored values. Run-unique titles; PHI-safe.
//
// FALSIFY: run against a backend at bcbd781^ (scratch `git archive`): the +1/+2
// rows keep 09:00 and the owner, so the "upcoming" assertions go red while the
// past/completed ones stay green.

test.use({ storageState: { cookies: [], origins: [] } });

const hhmm = (t: string | null) => (t ?? '').slice(0, 5);

interface Row {
  id: string;
  parent_event_id: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  assigned_to: string | null;
  completed_at: string | null;
}

function rowsOf(rootId: string): Row[] {
  return dbQuery<Row>(
    `select id::text as id, parent_event_id::text as parent_event_id, scheduled_date::text as scheduled_date,
            scheduled_time::text as scheduled_time, assigned_to::text as assigned_to, completed_at::text as completed_at
       from calendar_events
      where (id = ${sqlStr(rootId)}::uuid or parent_event_id = ${sqlStr(rootId)}::uuid)
        and removed_at is null and deleted_at is null
      order by scheduled_date, id`
  );
}

/** The live occurrence row for `date` (a child; the root only on its own start day without a child). */
function dayRow(rootId: string, date: string): Row | undefined {
  const rows = rowsOf(rootId).filter((r) => r.scheduled_date === date);
  return rows.find((r) => r.parent_event_id === rootId) ?? rows.find((r) => r.id === rootId);
}

interface Scene {
  owner: ScopedAccount;
  member: ScopedAccount;
  memberName: string;
  ownerName: string;
  circleId: string;
  today: string;
  at: (n: number) => string;
  api: Awaited<ReturnType<typeof ownerApi>>;
}

async function arrange(page: Page, request: Parameters<typeof ownerApi>[0], tag: string): Promise<Scene> {
  const viewerTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const suffix = uniq('x').replace(/[^a-z0-9]/gi, '');
  const owner = await createScopedAccount(`${tag}-o`);
  const member = await createScopedAccount(`${tag}-m`);
  const ownerName = `Olive Owner${suffix}`;
  const memberName = `Milo Member${suffix}`;
  sqlExec(
    `update public.users set first_name = 'Olive', last_name = ${sqlStr(`Owner${suffix}`)}, timezone = ${sqlStr(viewerTz)}
      where id = ${sqlStr(owner.userId)}::uuid;
     update public.users set first_name = 'Milo', last_name = ${sqlStr(`Member${suffix}`)}, timezone = ${sqlStr(viewerTz)}
      where id = ${sqlStr(member.userId)}::uuid;`
  );
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq(tag));
  const memberApi = await ownerApi(request, member);
  const invite = await createInvite(api, circleId); // @example.com, never mailed
  const acc = await memberApi.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  const today = dateInTz(viewerTz, 0);
  return { owner, member, memberName, ownerName, circleId, today, at: (n) => addDaysISO(today, n), api };
}

/** Seed a daily series from T-2 at 09:00 assigned to the owner; T-1 and today completed; today..+2 materialized. */
async function seedSeries(k: Scene, eventType: 'task' | 'appointment', title: string): Promise<string> {
  const root = await apiCreateEvent(k.api, k.circleId, {
    event_type: eventType,
    title,
    scheduled_date: k.at(-2),
    scheduled_time: '09:00',
    duration_minutes: 30,
    recurrence_rule: 'daily',
    assigned_to: k.owner.userId,
    notifications_enabled: false,
  });
  if (eventType === 'task') {
    for (const n of [-1, 0]) {
      const done = await k.api.post(`/api/circles/${k.circleId}/events/${root.id}/complete`, {
        scheduled_date: k.at(n),
      });
      expect(done.status(), `complete ${k.at(n)}: ${await done.text()}`).toBe(200);
    }
  }
  materializeRecurringInstances();
  // Precondition (the bug's shape): the upcoming days already exist as rows,
  // still on the series' old values.
  for (const n of [1, 2]) {
    const r = dayRow(root.id, k.at(n));
    expect(r?.parent_event_id, `fixture: +${n} is a materialized child`).toBe(root.id);
    expect(hhmm(r!.scheduled_time), `fixture: +${n} at 09:00`).toBe('09:00');
    expect(r!.assigned_to, `fixture: +${n} assigned to the owner`).toBe(k.owner.userId);
  }
  return root.id;
}

function titleRe(title: string): RegExp {
  return new RegExp(`${escapeRegExp(title)}(?![\\w-])`);
}

async function openEditor(page: Page, k: Scene, date: string, title: string, dialogName: string): Promise<Locator> {
  await gotoWeekContaining(page, k.circleId, k.today, date);
  const detail = await openChip(page, date, titleRe(title));
  await detail.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: dialogName });
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await expect(editor.locator('#title')).toHaveValue(title, { timeout: 15_000 });
  // The simple appointment folds its start behind a Starts tile (owner 2026-11-10); unfold it once hydrated.
  const startTile = editor.getByTestId('appt-start-tile');
  await expect(editor.locator('#scheduled_time').or(startTile)).toBeVisible({ timeout: 15_000 });
  if (await startTile.isVisible() && (await startTile.getAttribute('aria-expanded')) !== 'true') {
    await startTile.click();
  }
  await expect(editor.locator('#scheduled_time')).toHaveValue('09:00', { timeout: 15_000 });
  return editor;
}

async function save(page: Page, editor: Locator, rootId: string): Promise<void> {
  const patch = page.waitForResponse(
    (res) => res.request().method() === 'PATCH' && new URL(res.url()).pathname.endsWith(`/events/${rootId}`)
  );
  await editor.getByRole('button', { name: 'Save changes' }).click();
  expect((await patch).status(), 'the series PATCH targets the root and is accepted').toBe(200);
  await expect(editor).toBeHidden({ timeout: 20_000 });
}

/** The Calendar detail of `date` reads `time` and (when given) the assignee. */
async function expectDetail(
  page: Page,
  k: Scene,
  date: string,
  title: string,
  time: RegExp,
  notTime: RegExp,
  assignee?: { is: string; isNot: string }
): Promise<void> {
  await gotoWeekContaining(page, k.circleId, k.today, date);
  const detail = await openChip(page, date, titleRe(title));
  await expect(detail, `${date} detail shows the time`).toContainText(time, { timeout: 15_000 });
  await expect(detail).not.toContainText(notTime);
  if (assignee) {
    await expect(detail, `${date} detail names the assignee`).toContainText(assignee.is);
    await expect(detail).not.toContainText(assignee.isNot);
  }
  await closeDialog(page);
}

test('a recurring TASK: changing the series time and assignee moves the materialized upcoming days; completed and past days keep theirs', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await page.goto('about:blank');
  const k = await arrange(page, request, 'sersched-task');
  const title = `ZZ_E2E_SERSCHED_TASK_${uniqueSuffix()}`;
  const rootId = await seedSeries(k, 'task', title);
  const before = {
    past: dayRow(rootId, k.at(-1)),
    today: dayRow(rootId, k.today),
  };
  expect(before.past?.completed_at, 'fixture: T-1 completed').toBeTruthy();
  expect(before.today?.completed_at, 'fixture: today completed').toBeTruthy();

  await cookieLogin(context, k.owner, baseURL);
  const editor = await openEditor(page, k, k.at(1), title, 'Edit task');
  await expect(editor.getByRole('radio', { name: 'Me', exact: true })).toBeChecked();
  await editor.locator('#scheduled_time').fill('15:00');
  await editor.getByRole('radio', { name: new RegExp(escapeRegExp(k.memberName.split(' ')[0])) }).click();
  await save(page, editor, rootId);

  // DB: the series and the materialized upcoming days carry 15:00 + the member.
  await expect.poll(() => hhmm(rowsOf(rootId).find((r) => r.id === rootId)!.scheduled_time), { timeout: 15_000 }).toBe('15:00');
  for (const n of [1, 2]) {
    const r = dayRow(rootId, k.at(n));
    expect(r?.parent_event_id, `+${n} is still the materialized child`).toBe(rootId);
    expect({ time: hhmm(r!.scheduled_time), assignee: r!.assigned_to }, `+${n} follows the series edit`).toEqual({
      time: '15:00',
      assignee: k.member.userId,
    });
  }
  // DB: today's COMPLETED occurrence and the PAST one are untouched.
  expect(dayRow(rootId, k.today), 'today (completed) is untouched').toEqual(before.today);
  expect(dayRow(rootId, k.at(-1)), 'yesterday (past, completed) is untouched').toEqual(before.past);

  // UI: the upcoming days read 3:00 PM and the member; today keeps 9:00 AM and the owner. The detail's
  // person chip shows the FIRST name (approved one-card detail, 2026-11-08); Milo vs Olive tell them apart.
  const first = (name: string) => name.split(' ')[0];
  const member = first(k.memberName);
  const owner = first(k.ownerName);
  for (const n of [1, 2]) {
    await expectDetail(page, k, k.at(n), title, /3:00\s?PM/, /9:00\s?AM/, { is: member, isNot: owner });
  }
  await expectDetail(page, k, k.today, title, /9:00\s?AM/, /3:00\s?PM/, { is: owner, isNot: member });
});

test('a recurring APPOINTMENT: moving the series time moves the materialized upcoming days; a past day keeps its time', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  test.setTimeout(150_000);
  await page.goto('about:blank');
  const k = await arrange(page, request, 'sersched-appt');
  const title = `ZZ_E2E_SERSCHED_APPT_${uniqueSuffix()}`;
  const rootId = await seedSeries(k, 'appointment', title);

  await cookieLogin(context, k.owner, baseURL);
  const editor = await openEditor(page, k, k.at(1), title, 'Edit appointment');
  await editor.locator('#scheduled_time').fill('15:00');
  await save(page, editor, rootId);

  await expect.poll(() => hhmm(rowsOf(rootId).find((r) => r.id === rootId)!.scheduled_time), { timeout: 15_000 }).toBe('15:00');
  for (const n of [1, 2]) {
    const r = dayRow(rootId, k.at(n));
    expect(r?.parent_event_id, `+${n} is still the materialized child`).toBe(rootId);
    expect(hhmm(r!.scheduled_time), `+${n} follows the series time`).toBe('15:00');
    expect(r!.assigned_to, `+${n} keeps the (unchanged) assignee`).toBe(k.owner.userId);
  }
  // The past start day (frozen into its own child by the edit) keeps 09:00.
  expect(hhmm(dayRow(rootId, k.at(-2))!.scheduled_time), 'the past start day keeps 09:00').toBe('09:00');

  for (const n of [1, 2]) {
    await expectDetail(page, k, k.at(n), title, /3:00\s?PM/, /9:00\s?AM/);
  }
  await expectDetail(page, k, k.at(-2), title, /9:00\s?AM/, /3:00\s?PM/);
});
