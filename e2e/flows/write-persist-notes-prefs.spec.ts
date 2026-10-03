import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { countRequests, dbCount, dbQuery, pathMatcher, sqlStr, type ApiSession, type PathPattern } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq, type ScopedAccount } from '../unhappy/auth-invites/_helpers';
import { circleTimezone, createAppointment, dateInTz, uniqueSuffix } from '../notesFirstClassShared';
import { openCalendarEvent } from '../unhappy/writes/_helpers';

// ===========================================================================
// WRITE PERSISTENCE: event notes (edit, delete), vital delete, profile email
// digest, notification-preference switches, circle date of birth.
//
// Why this file exists. Each of these writes reaches the database through the
// backend's USER-scoped client (users / event_notes / health_vitals /
// care_circles), and none had a test that proved the write LANDED: they ended
// on a toast or an optimistic row. Every test here performs the write through
// the real UI against the real backend and then proves it persisted two ways:
//   1. the DATABASE row (dbQuery / dbCount, polled), and
//   2. a fresh page load (full navigation / reload) showing the saved state.
// Each also checks something that must NOT have moved (the sibling note, the
// sibling reading, the other preference keys, the day after a disable), so a
// write that clobbers more than it should fails too.
//
// Everything runs as a run-scoped account (purged by globalTeardown) that owns
// a fresh circle where one is needed, so nothing leaks into the worker's
// cloned circles and no restore step is required.
//
// WHAT THE WEB CANNOT DO (documented, asserted where it is observable):
//   - Circle settings (EditCirclePage) edits recipient name + date of birth
//     ONLY. Conditions are deliberately not editable there: they have one
//     input, Edit Medical Info (emergency_info.medical_conditions), so
//     `PATCH /circles/:id { recipient_conditions }` has no web caller.
//   - A date of birth cannot be CLEARED: updateCircleSchema has
//     `recipient_dob` as optional, not nullable. The page blocks the clear
//     (Save disabled + "isn't supported yet" error); the DOB test proves the
//     block holds (no request, stored date untouched) instead of a clear.
//
// FALSIFY. PW_FALSIFY=write-persist-notes-prefs answers every write below with
// a fake 2xx via page.route, so the UI behaves as if it saved but nothing
// reaches the backend; PW_FALSIFY=write-persist-notes-prefs:<step> does it for
// one step only (note-edit, note-delete, vital-delete, digest-on, digest-day,
// digest-off, digest-on-again, notif-<key> / notif-<key>-back or just `notif`,
// dob-set, dob-change); the first dash-separated word (`digest`, `notif`)
// selects a whole group. The DB
// assertion that follows the write must go red.
// ===========================================================================

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const SPEC = 'write-persist-notes-prefs';
const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').map((s) => s.trim()).filter(Boolean));

function falsified(step: string): boolean {
  return FALSIFY.has(SPEC) || FALSIFY.has(`${SPEC}:${step}`) || FALSIFY.has(`${SPEC}:${step.split('-')[0]}`);
}

interface FakeReply {
  status: number;
  body?: unknown;
}

/**
 * Perform `action` (a UI gesture) and wait for the write it sends to be
 * answered 2xx. Under PW_FALSIFY the request is fulfilled with `fake` instead
 * and never reaches the backend, which is exactly the "UI believes it saved"
 * failure these tests exist to catch.
 */
async function write(
  page: Page,
  step: string,
  method: 'PATCH' | 'DELETE',
  pattern: PathPattern,
  fake: FakeReply,
  action: () => Promise<void>
): Promise<void> {
  const match = pathMatcher(pattern);
  const filter = (url: URL) => match(url.pathname);
  const handler = async (route: Route) => {
    if (route.request().method() !== method) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: fake.status,
      contentType: 'application/json',
      body: fake.body === undefined ? '' : JSON.stringify(fake.body),
    });
  };
  const fakeIt = falsified(step);
  if (fakeIt) {
    console.log(`[falsify] ${SPEC}:${step} -> fake ${fake.status} for ${method} ${String(pattern)}`);
    await page.route(filter, handler);
  }
  try {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === method && match(new URL(r.url()).pathname), {
        timeout: 20_000,
      }),
      action(),
    ]);
    expect(res.ok(), `${method} ${String(pattern)} answered ${res.status()}`).toBe(true);
  } finally {
    if (fakeIt) await page.unroute(filter, handler).catch(() => undefined);
  }
}

async function signedIn(
  prefix: string,
  request: Parameters<typeof ownerApi>[0],
  context: Parameters<typeof cookieLogin>[0],
  baseURL: string | undefined
): Promise<{ acct: ScopedAccount; api: ApiSession }> {
  const acct = await createScopedAccount(prefix);
  const api = await ownerApi(request, acct);
  await cookieLogin(context, acct, baseURL);
  return { acct, api };
}

const NOTE_PATH = /^\/api\/circles\/[^/]+\/events\/[^/]+\/notes\/[^/]+$/;
const VITAL_PATH = /^\/api\/circles\/[^/]+\/vitals\/[^/]+$/;
const DIGEST_PATH = '/api/users/me/email-digest';
const NOTIF_PATH = '/api/users/me/notification-preferences';
const CIRCLE_PATH = /^\/api\/circles\/[^/]+$/;

// ---------------------------------------------------------------------------
// Event notes: edit and delete from the calendar event detail dialog
// ---------------------------------------------------------------------------

interface NoteRow {
  body: string;
  edited: boolean;
}

const noteRow = (noteId: string): NoteRow | undefined =>
  dbQuery<NoteRow>(
    `select body, updated_at > created_at as edited from event_notes where id = ${sqlStr(noteId)}::uuid`
  )[0];

async function seedEventWithNotes(
  api: ApiSession,
  prefix: string,
  bodies: string[]
): Promise<{ circleId: string; eventId: string; title: string; date: string; noteIds: string[] }> {
  const circleId = await createCircle(api, uniq(prefix));
  const date = dateInTz(await circleTimezone(api, circleId), 0);
  const title = `E2E ${prefix} ${uniqueSuffix()}`;
  const eventId = await createAppointment(api, circleId, title, date);
  const noteIds: string[] = [];
  for (const body of bodies) {
    const res = await api.post(`/api/circles/${circleId}/events/${eventId}/notes`, { body });
    expect(res.status(), `seed note: ${await res.text()}`).toBe(201);
    noteIds.push(((await res.json()) as { data: { note: { id: string } } }).data.note.id);
  }
  return { circleId, eventId, title, date, noteIds };
}

async function apiNoteBodies(api: ApiSession, circleId: string, eventId: string): Promise<string[]> {
  const res = await api.get(`/api/circles/${circleId}/events/${eventId}/notes`);
  expect(res.ok(), `GET notes: ${res.status()}`).toBe(true);
  return ((await res.json()) as { data: { notes: Array<{ body: string }> } }).data.notes.map((n) => n.body);
}

test('event note EDIT: the new body is in event_notes.body, in a fresh API read and in the reopened dialog after a reload', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  test.slow();
  const { api } = await signedIn('note-edit', request, context, baseURL);
  const sfx = uniqueSuffix();
  const original = `E2E original note ${sfx}`;
  const keeper = `E2E untouched note ${sfx}`;
  const edited = `E2E edited note ${sfx}`;
  const { circleId, eventId, title, date, noteIds } = await seedEventWithNotes(api, 'note-edit', [original, keeper]);
  const [noteId, keeperId] = noteIds;
  expect(noteRow(noteId)).toEqual({ body: original, edited: false });

  const dialog = await openCalendarEvent(page, circleId, date, title);
  const item = dialog.locator('li', { hasText: original });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.getByRole('button', { name: 'Edit', exact: true }).click();
  const box = dialog.locator(`#note-edit-${noteId}`);
  await expect(box).toHaveValue(original);
  await box.fill(edited);

  await write(page, 'note-edit', 'PATCH', NOTE_PATH, { status: 200, body: { success: true, data: { note: {} } } }, () =>
    dialog.getByRole('button', { name: 'Save', exact: true }).click()
  );

  // 1. The database row.
  await expect.poll(() => noteRow(noteId)?.body, { timeout: 10_000, message: 'event_notes.body after the UI save' }).toBe(edited);
  expect(noteRow(noteId)?.edited, 'updated_at moved past created_at').toBe(true);
  expect(noteRow(keeperId), 'the sibling note is untouched').toEqual({ body: keeper, edited: false });
  expect(dbCount(`select 1 from event_notes where event_id = ${sqlStr(eventId)}::uuid`)).toBe(2);
  // 2. A fresh API read, then a full page load.
  expect((await apiNoteBodies(api, circleId, eventId)).sort()).toEqual([edited, keeper].sort());
  const reopened = await openCalendarEvent(page, circleId, date, title);
  await expect(reopened.getByText(edited, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(reopened.getByText(keeper, { exact: true })).toBeVisible();
  await expect(reopened.getByText(original, { exact: true })).toHaveCount(0);
});

test('event note DELETE: the row is gone from event_notes and from the reopened dialog after a reload; the sibling note survives', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  test.slow();
  const { api } = await signedIn('note-del', request, context, baseURL);
  const sfx = uniqueSuffix();
  const doomed = `E2E delete-me note ${sfx}`;
  const keeper = `E2E keep-me note ${sfx}`;
  const { circleId, eventId, title, date, noteIds } = await seedEventWithNotes(api, 'note-del', [doomed, keeper]);
  const [doomedId, keeperId] = noteIds;
  // Non-vacuous: both rows exist before the gesture.
  expect(noteRow(doomedId)?.body).toBe(doomed);
  expect(noteRow(keeperId)?.body).toBe(keeper);

  const dialog = await openCalendarEvent(page, circleId, date, title);
  const item = dialog.locator('li', { hasText: doomed });
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.getByRole('button', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete note' });
  await expect(confirm).toBeVisible({ timeout: 10_000 });

  await write(page, 'note-delete', 'DELETE', NOTE_PATH, { status: 200, body: { success: true } }, () =>
    confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  );

  // 1. The database.
  await expect
    .poll(() => dbCount(`select 1 from event_notes where id = ${sqlStr(doomedId)}::uuid`), {
      timeout: 10_000,
      message: 'event_notes row for the deleted note',
    })
    .toBe(0);
  expect(noteRow(keeperId)?.body, 'the sibling note is still stored').toBe(keeper);
  // 2. A fresh API read, then a full page load.
  expect(await apiNoteBodies(api, circleId, eventId)).toEqual([keeper]);
  const reopened = await openCalendarEvent(page, circleId, date, title);
  await expect(reopened.getByText(keeper, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(reopened.getByText(doomed, { exact: true })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Vital delete: Vitals page row menu
// ---------------------------------------------------------------------------

test('vital DELETE: the health_vitals row is gone and the reload no longer lists it; the other reading survives', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  test.slow();
  const { api } = await signedIn('vit-del', request, context, baseURL);
  const circleId = await createCircle(api, uniq('vit-del'));
  const doomedBpm = 241 + Math.floor(Math.random() * 20);
  const keepBpm = doomedBpm + 15;
  const sfx = uniqueSuffix();
  const seed = async (bpm: number, note: string, hoursAgo: number): Promise<string> => {
    const res = await api.post(`/api/circles/${circleId}/vitals`, {
      vital_type: 'heart_rate',
      value1: bpm,
      unit: 'bpm',
      recorded_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
      notes: note,
    });
    expect(res.status(), `seed vital: ${await res.text()}`).toBe(201);
    return ((await res.json()) as { data: { vital: { id: string } } }).data.vital.id;
  };
  const doomedId = await seed(doomedBpm, `E2E vital doomed ${sfx}`, 3);
  const keepId = await seed(keepBpm, `E2E vital keeper ${sfx}`, 6);
  const stored = (id: string) => dbCount(`select 1 from health_vitals where id = ${sqlStr(id)}::uuid`);
  expect(stored(doomedId)).toBe(1);
  expect(stored(keepId)).toBe(1);

  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  const group = page.getByRole('region', { name: 'Heart rate' });
  await expect(group.getByRole('listitem')).toHaveCount(2, { timeout: 20_000 });
  await group.getByRole('button', { name: new RegExp(`Actions for reading .*${doomedBpm} bpm`) }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Delete', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible();

  await write(page, 'vital-delete', 'DELETE', VITAL_PATH, { status: 204 }, () =>
    confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  );

  // 1. The database.
  await expect
    .poll(() => stored(doomedId), { timeout: 10_000, message: 'health_vitals row for the deleted reading' })
    .toBe(0);
  expect(stored(keepId), 'the other reading is still stored').toBe(1);
  // 2. A full page load lists only the survivor.
  await page.reload({ waitUntil: 'domcontentloaded' });
  const after = page.getByRole('region', { name: 'Heart rate' });
  await expect(after.getByText(new RegExp(`${keepBpm} bpm`))).toBeVisible({ timeout: 20_000 });
  await expect(after.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText(new RegExp(`${doomedBpm} bpm`))).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Profile: weekly email digest
// ---------------------------------------------------------------------------

test('profile email digest: enable, change the delivery day, disable and re-enable are each stored in users and survive a reload', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  test.slow();
  const { acct } = await signedIn('digest', request, context, baseURL);
  const digest = () =>
    dbQuery<{ enabled: boolean; day: number }>(
      `select email_digest_enabled as enabled, email_digest_day as day from users where id = ${sqlStr(acct.userId)}::uuid`
    )[0];
  expect(digest(), 'a fresh account has the digest off').toEqual({ enabled: false, day: 0 });

  const toggle = () => page.getByRole('switch', { name: 'Send me a weekly digest' });
  const daySelect = () => page.locator('#profile-digest-day');
  const open = async () => {
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(toggle()).toBeVisible({ timeout: 20_000 });
  };

  await open();
  await expect(toggle()).toHaveAttribute('aria-checked', 'false');
  await expect(daySelect()).toHaveCount(0);

  // --- enable ---
  await write(page, 'digest-on', 'PATCH', DIGEST_PATH, { status: 200, body: { success: true, data: { user: {} } } }, () =>
    toggle().click()
  );
  await expect.poll(digest, { timeout: 10_000, message: 'users.email_digest_enabled after enabling' }).toEqual({ enabled: true, day: 0 });
  await open();
  await expect(toggle()).toHaveAttribute('aria-checked', 'true');
  await expect(daySelect()).toHaveValue('0');

  // --- change the day (Wednesday) ---
  await write(page, 'digest-day', 'PATCH', DIGEST_PATH, { status: 200, body: { success: true, data: { user: {} } } }, () =>
    daySelect()
      .selectOption('3')
      .then(() => undefined)
  );
  await expect.poll(digest, { timeout: 10_000, message: 'users.email_digest_day after choosing Wednesday' }).toEqual({ enabled: true, day: 3 });
  await open();
  await expect(toggle()).toHaveAttribute('aria-checked', 'true');
  await expect(daySelect()).toHaveValue('3');

  // --- disable: the chosen day is kept, the selector goes away ---
  await write(page, 'digest-off', 'PATCH', DIGEST_PATH, { status: 200, body: { success: true, data: { user: {} } } }, () =>
    toggle().click()
  );
  await expect.poll(digest, { timeout: 10_000, message: 'users.email_digest_enabled after disabling' }).toEqual({ enabled: false, day: 3 });
  await open();
  await expect(toggle()).toHaveAttribute('aria-checked', 'false');
  await expect(daySelect()).toHaveCount(0);

  // --- re-enable: the stored day comes back ---
  await write(page, 'digest-on-again', 'PATCH', DIGEST_PATH, { status: 200, body: { success: true, data: { user: {} } } }, () =>
    toggle().click()
  );
  await expect.poll(digest, { timeout: 10_000, message: 'users.email_digest_enabled after re-enabling' }).toEqual({ enabled: true, day: 3 });
  await open();
  await expect(toggle()).toHaveAttribute('aria-checked', 'true');
  await expect(daySelect()).toHaveValue('3');
});

// ---------------------------------------------------------------------------
// Profile: notification-preference switches
// ---------------------------------------------------------------------------

type Prefs = Record<string, unknown>;

// New accounts start with every one of these keys true (users.notification_preferences default).
const SWITCHES = [
  { key: 'medication_confirmations', name: 'Medication confirmations' },
  { key: 'missed_medications', name: 'Missed medications' },
  { key: 'task_assignments', name: 'Task assignments' },
  { key: 'appointment_reminders', name: 'Appointment reminders' },
  { key: 'tips_and_suggestions', name: 'Tips & suggestions' },
] as const;

for (const { key, name } of SWITCHES) {
  test(`notification switch "${name}": off then on again is stored in users.notification_preferences.${key} and survives a reload`, async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    test.slow();
    const { acct } = await signedIn('notif', request, context, baseURL);
    const prefs = () =>
      dbQuery<{ prefs: Prefs }>(`select notification_preferences as prefs from users where id = ${sqlStr(acct.userId)}::uuid`)[0].prefs;
    const start = prefs();
    expect(start[key], `${key} starts on`).toBe(true);

    const sw = () => page.getByRole('switch', { name, exact: true });
    const open = async () => {
      await page.goto('/profile', { waitUntil: 'domcontentloaded' });
      await expect(sw()).toBeVisible({ timeout: 20_000 });
    };
    const flip = async (to: boolean) => {
      await write(page, to ? `notif-${key}-back` : `notif-${key}`, 'PATCH', NOTIF_PATH, { status: 200, body: { success: true, data: { user: {} } } }, () =>
        sw().click()
      );
      // Only this key moved; every other preference is byte-identical.
      await expect
        .poll(() => prefs(), { timeout: 10_000, message: `users.notification_preferences after switching ${key} ${to ? 'on' : 'off'}` })
        .toEqual({ ...start, [key]: to });
      await open();
      await expect(sw()).toHaveAttribute('aria-checked', String(to));
    };

    await open();
    await expect(sw()).toHaveAttribute('aria-checked', 'true');
    await flip(false);
    await flip(true);
    expect(prefs(), 'restored to the starting preferences').toEqual(start);
  });
}

// ---------------------------------------------------------------------------
// Circle settings: date of birth
// ---------------------------------------------------------------------------

test('circle settings date of birth: set and change are stored in care_circles.recipient_dob and survive a reload; a clear is blocked and changes nothing', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  test.slow();
  const { api } = await signedIn('dob', request, context, baseURL);
  const circleId = await createCircle(api, uniq('dob'));
  const dobRow = () =>
    dbQuery<{ dob: string | null; name: string }>(
      `select recipient_dob::text as dob, recipient_name as name from care_circles where id = ${sqlStr(circleId)}::uuid`
    )[0];
  const startName = dobRow().name;
  expect(dobRow().dob, 'a new circle has no date of birth').toBeNull();

  const field = () => page.locator('#recipient_dob');
  const open = async () => {
    await page.goto(`/circles/${circleId}/settings`, { waitUntil: 'domcontentloaded' });
    await expect(field()).toBeVisible({ timeout: 20_000 });
  };
  const save = () => page.getByRole('button', { name: 'Save changes' });

  // --- set ---
  await open();
  await expect(field()).toHaveValue('');
  await field().fill('1948-03-17');
  await write(page, 'dob-set', 'PATCH', CIRCLE_PATH, { status: 200, body: { success: true, data: { circle: {} } } }, () =>
    save().click()
  );
  await expect.poll(() => dobRow().dob, { timeout: 10_000, message: 'care_circles.recipient_dob after setting it' }).toBe('1948-03-17');
  expect(dobRow().name, 'the name is untouched').toBe(startName);
  await open();
  await expect(field()).toHaveValue('1948-03-17');

  // --- change ---
  await field().fill('1949-11-02');
  await write(page, 'dob-change', 'PATCH', CIRCLE_PATH, { status: 200, body: { success: true, data: { circle: {} } } }, () =>
    save().click()
  );
  await expect.poll(() => dobRow().dob, { timeout: 10_000, message: 'care_circles.recipient_dob after changing it' }).toBe('1949-11-02');
  await open();
  await expect(field()).toHaveValue('1949-11-02');

  // --- clear: unsupported by the contract (recipient_dob is optional, not nullable) ---
  const patches = countRequests(page, 'PATCH', CIRCLE_PATH);
  await field().fill('');
  await expect(page.getByText("Clearing the date of birth isn't supported yet", { exact: false })).toBeVisible();
  await expect(save()).toBeDisabled();
  await page.locator('#recipient_name').press('Enter');
  await patches.expectCount(0);
  patches.dispose();
  expect(dobRow().dob, 'the stored date of birth survives the blocked clear').toBe('1949-11-02');
  await open();
  await expect(field()).toHaveValue('1949-11-02');
});
