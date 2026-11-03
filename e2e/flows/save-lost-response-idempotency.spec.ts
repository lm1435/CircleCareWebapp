import type { Locator, Page, Request, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { dbQuery } from '../unhappy';
import { uniqueSuffix } from '../notesFirstClassShared';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// A SAVE WHOSE RESPONSE IS LOST IS RETRIED WITH THE SAME IDEMPOTENCY-KEY
// (web 9e4cfce, 1.4.0; backend middleware/idempotency.ts).
//
// THE BUG. A create/edit that the server WROTE but whose answer never reached
// the browser (network drop, laptop lid, the 15 s timeout firing late) was
// reported as "Failed to create/update", and Save again created a SECOND item.
//
// THE CONTRACT: createEvent/updateEvent send one Idempotency-Key per save and,
// on an ambiguous failure, retry with that same key; the backend replays the
// first answer. So: the server is hit twice with ONE key, exactly one row
// exists, the form closes as a success, no failure toast.
//
// The lost answer is real: the first request is forwarded to the backend
// (`route.fetch()`, the row is written) and its response is then dropped
// (`route.abort('failed')`).
//
// FALSIFY: against the web app with 9e4cfce's src/api/calendarEvents.ts
// reverted (scratch copy), the first lost answer is final: one request, a
// failure toast, the form stays open — red.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

const isEventsCreate = (r: Request) =>
  r.method() === 'POST' && /\/api\/circles\/[^/]+\/events$/.test(new URL(r.url()).pathname);
const isEventsPatch = (r: Request) =>
  r.method() === 'PATCH' && /\/api\/circles\/[^/]+\/events\/[^/]+$/.test(new URL(r.url()).pathname);

/** Forward the FIRST matching request to the backend, then drop its answer. Records every match. */
async function loseFirstAnswer(page: Page, matches: (r: Request) => boolean) {
  const seen: Request[] = [];
  let lost = false;
  await page.route('**/api/circles/**', async (route: Route) => {
    const req = route.request();
    if (!matches(req)) return route.fallback();
    seen.push(req);
    if (lost) return route.fallback();
    lost = true;
    await route.fetch(); // the server writes...
    await route.abort('failed'); // ...and the browser never hears back
  });
  return seen;
}

function rowsTitled(circleId: string, title: string): { id: string }[] {
  return dbQuery<{ id: string }>(
    `select id::text as id from calendar_events where circle_id = ${sqlStr(circleId)}::uuid and title = ${sqlStr(title)}
        and deleted_at is null`
  );
}

async function arrange(page: Page, request: Parameters<typeof ownerApi>[0], baseURL: string | undefined, tag: string) {
  const owner = await createScopedAccount(tag);
  const api = await ownerApi(request, owner);
  const circleId = await createCircle(api, uniq(tag));
  await cookieLogin(page.context(), owner, baseURL);
  return { owner, api, circleId };
}

async function openTasks(page: Page, circleId: string): Promise<void> {
  await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 20_000 });
}

async function noFailureToast(page: Page): Promise<void> {
  await expect(page.getByRole('alert').filter({ hasText: /failed|couldn't|could not/i })).toHaveCount(0);
}

function keysOf(seen: Request[]): string[] {
  return seen.map((r) => r.headers()['idempotency-key'] ?? '<none>');
}

test('a new task whose create answer is lost is retried with the same key: one task, no failure', async ({
  page,
  request,
  baseURL,
}) => {
  const k = await arrange(page, request, baseURL, 'idemcreate');
  const title = `ZZ_E2E_IDEM_CREATE_${uniqueSuffix()}`;
  try {
    await openTasks(page, k.circleId);
    await page.getByRole('button', { name: 'Add task' }).first().click();
    const dialog: Locator = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog).toBeVisible();
    await dialog.locator('#title').fill(title);
    const seen = await loseFirstAnswer(page, isEventsCreate);
    await dialog.getByRole('button', { name: 'Add task' }).click();

    await expect(dialog, 'the save ends as a success').toBeHidden({ timeout: 30_000 });
    await expect.poll(() => seen.length, { timeout: 10_000 }).toBe(2);
    const keys = keysOf(seen);
    expect(keys[0], 'the save carries an Idempotency-Key').toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1], 'the retry reuses it').toBe(keys[0]);
    expect(rowsTitled(k.circleId, title), 'exactly one task was written').toHaveLength(1);
    await noFailureToast(page);
    await expect(page.getByRole('listitem').filter({ hasText: title })).toHaveCount(1, { timeout: 15_000 });
  } finally {
    sqlExec(`delete from calendar_events where circle_id = ${sqlStr(k.circleId)}::uuid and title = ${sqlStr(title)};`);
  }
});

test('an edit whose answer is lost is retried with the same key: saved once, no failure', async ({
  page,
  request,
  baseURL,
}) => {
  const k = await arrange(page, request, baseURL, 'idemedit');
  const title = `ZZ_E2E_IDEM_EDIT_${uniqueSuffix()}`;
  const renamed = `${title}_B`;
  const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const res = await k.api.post(`/api/circles/${k.circleId}/events`, {
    event_type: 'task',
    title,
    scheduled_date: today,
  });
  expect(res.status(), await res.text()).toBe(201);
  try {
    await openTasks(page, k.circleId);
    await page.getByRole('button', { name: `Edit "${title}"` }).first().click();
    const editor = page.getByRole('dialog', { name: 'Edit task' });
    await expect(editor.locator('#title')).toHaveValue(title, { timeout: 15_000 });
    await editor.locator('#title').fill(renamed);
    const seen = await loseFirstAnswer(page, isEventsPatch);
    await editor.getByRole('button', { name: 'Save changes' }).click();

    await expect(editor, 'the save ends as a success').toBeHidden({ timeout: 30_000 });
    await expect.poll(() => seen.length, { timeout: 10_000 }).toBe(2);
    const keys = keysOf(seen);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1], 'the retry reuses the key').toBe(keys[0]);
    expect(rowsTitled(k.circleId, renamed)).toHaveLength(1);
    expect(rowsTitled(k.circleId, title)).toHaveLength(0);
    await noFailureToast(page);
  } finally {
    sqlExec(
      `delete from calendar_events where circle_id = ${sqlStr(k.circleId)}::uuid and title in (${sqlStr(title)}, ${sqlStr(renamed)});`
    );
  }
});
