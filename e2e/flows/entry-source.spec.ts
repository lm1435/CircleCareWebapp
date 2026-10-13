import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlRows } from '../db';
import { apiSession, sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, uniq, type ScopedAccount } from '../unhappy/auth-invites/_helpers';
import { apiCreateEvent, dateInZone, recipientTimezone } from '../unhappy/writes/_helpers';

// "ADDED BY VOICE" (1.2.3, calendar_events.entry_source).
//
// Every saved medication, appointment or task records HOW it was entered:
// 'form' (typed), 'scan' (a photo of a label) or 'voice' (dictated). Voice add
// and the label scan are mobile-only, but the note is for the whole care
// circle, so the web detail view shows the same line mobile does — "Added by
// voice" — for an entry that was dictated on the phone, and nothing for the
// rest (typed, scanned, or saved before this was recorded).
//
// Mobile twin: mobile/.maestro/parity/tasks/entry-source-note.yaml.
//
// WHAT IS REAL HERE. The voice entry is posted through the real API with
// `entry_source: 'voice'` (exactly what the mobile app sends); the "old client"
// entry is posted WITHOUT the key (exactly what a shipped 1.2.2 app sends); the
// typed entry is created through the web form itself. The rows are then read
// back from Postgres and through the real Tasks page.
//
// FALSIFY: PW_FALSIFY=entry-source posts the "voice" task without the key ->
// the "Added by voice" assertion fails.
//
// NOT YET RUN (written 2026-10-13 with the feature: no backend / Vite server
// was up in that session). Run: npx playwright test e2e/flows/entry-source.spec.ts --project=chromium

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

async function loginCtx(
  browser: import('@playwright/test').Browser,
  baseURL: string | undefined,
  acc: ScopedAccount
): Promise<BrowserContext> {
  const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
  const ctx = await browser.newContext({
    baseURL: origin,
    timezoneId: process.env.PW_E2E_TZ || 'America/Denver',
  });
  await cookieLogin(ctx, acc, baseURL);
  return ctx;
}

function storedSource(circleId: string, title: string): Array<string | null> {
  return sqlRows<{ entry_source: string | null }>(
    `select entry_source from calendar_events
      where circle_id = ${sqlStr(circleId)}::uuid and title = ${sqlStr(title)} and parent_event_id is null`
  ).map((r) => r.entry_source);
}

/** Tasks page, Completed filter, open the read-only detail of the task titled `title`. */
async function openCompletedDetail(page: Page, title: string) {
  const row = page.getByRole('listitem').filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: new RegExp(title) }).click();
  const detail = page.getByRole('dialog');
  await expect(detail).toBeVisible();
  await expect(detail.getByText(title).first()).toBeVisible();
  return detail;
}

test('an entry saved by voice says "Added by voice" on its detail; typed, old and web-created entries do not', async ({
  browser,
  request,
  baseURL,
}) => {
  const falsify = (process.env.PW_FALSIFY ?? '').split(',').includes('entry-source');
  const tag = uniq('src').replace(/[^a-z0-9]/g, '');

  const owner = await createScopedAccount('src-owner');
  const api = await apiSession(request, owner);
  const circleId = await createCircle(api, `src ${tag}`);
  const tz = await recipientTimezone(api, circleId);
  const yesterday = dateInZone(tz, -1);

  const titles = {
    voice: `Voice entry ${tag}`,
    old: `Old client entry ${tag}`,
    form: `Typed entry ${tag}`,
    web: `Web form entry ${tag}`,
  };

  const ctx = await loginCtx(browser, baseURL, owner);
  try {
    // What the mobile app sends for a voice-drafted save.
    const voice = await apiCreateEvent(api, circleId, {
      event_type: 'task',
      title: titles.voice,
      scheduled_date: yesterday,
      ...(falsify ? {} : { entry_source: 'voice' }),
    });
    // What a shipped 1.2.2 app sends: no key at all.
    const old = await apiCreateEvent(api, circleId, { event_type: 'task', title: titles.old, scheduled_date: yesterday });
    // What the mobile form sends for a typed entry.
    const form = await apiCreateEvent(api, circleId, {
      event_type: 'task',
      title: titles.form,
      scheduled_date: yesterday,
      entry_source: 'form',
    });

    // An invalid value is refused on create, and nothing is written.
    const bad = await api.post(`/api/circles/${circleId}/events`, {
      event_type: 'task',
      title: `Invalid ${tag}`,
      scheduled_date: yesterday,
      entry_source: 'typed',
    });
    expect(bad.status(), await bad.text()).toBe(400);
    expect(storedSource(circleId, `Invalid ${tag}`)).toEqual([]);

    // An update cannot change it, and is not refused for echoing it back.
    const patched = await api.patch(`/api/circles/${circleId}/events/${voice.id}`, {
      title: titles.voice,
      entry_source: 'form',
    });
    expect(patched.status(), await patched.text()).toBe(200);

    expect(storedSource(circleId, titles.voice)).toEqual([falsify ? null : 'voice']);
    expect(storedSource(circleId, titles.old)).toEqual([null]);
    expect(storedSource(circleId, titles.form)).toEqual(['form']);

    // A completed task opens the read-only detail on the Tasks page.
    for (const t of [voice, old, form]) {
      const done = await api.post(`/api/circles/${circleId}/events/${t.id}/complete`, { scheduled_date: t.scheduled_date });
      expect(done.status(), `complete: ${await done.text()}`).toBe(200);
    }

    const page = await ctx.newPage();
    await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 20_000 });

    // The web form: a typed entry. Created FIRST (while the list is on Open),
    // through the same modal a caregiver uses.
    await page.getByRole('button', { name: 'Add task' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#title').fill(titles.web);
    await dialog.locator('#scheduled_date').fill(dateInZone(tz, 0));
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: `Mark "${titles.web}" complete` })).toBeVisible({ timeout: 20_000 });
    await expect.poll(() => storedSource(circleId, titles.web), { timeout: 15_000 }).toEqual(['form']);

    await page.getByRole('button', { name: /^Status:/ }).click();
    await page.getByRole('menuitem', { name: 'Completed', exact: true }).click();

    // 1. Saved by voice: the note, as plain text.
    let detail = await openCompletedDetail(page, titles.voice);
    const note = detail.getByText('Added by voice', { exact: true });
    await expect(note).toBeVisible();
    await expect(detail.getByTestId('entry-source-note')).toHaveCount(1);
    // Plain text a screen reader reads: no icon inside it, nothing hiding it.
    await expect(note.locator('svg, img, ion-icon')).toHaveCount(0);
    expect(await note.evaluate((el) => !!el.closest('[aria-hidden="true"]'))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // 2. Saved by an older app (unknown): no note.
    detail = await openCompletedDetail(page, titles.old);
    await expect(detail.getByText('Added by voice')).toHaveCount(0);
    await expect(detail.getByTestId('entry-source-note')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    // 3. Typed on the phone: stored, shown nowhere.
    detail = await openCompletedDetail(page, titles.form);
    await expect(detail.getByText('Added by voice')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // The list read carries the field (the detail is drawn from it).
    const listed = (await (await api.get(`/api/circles/${circleId}/tasks?status=completed`)).json()) as {
      data: { tasks: Array<{ id: string; entry_source?: string | null }> };
    };
    const byId = new Map(listed.data.tasks.map((t) => [t.id, t.entry_source ?? null]));
    expect(byId.get(voice.id)).toBe(falsify ? null : 'voice');
    expect(byId.get(old.id)).toBeNull();
    expect(byId.get(form.id)).toBe('form');
  } finally {
    await ctx.close();
    const c = `${sqlStr(circleId)}::uuid`;
    sqlExec(`
      delete from event_notes where event_id in (select id from calendar_events where circle_id = ${c});
      delete from activity_feed where circle_id = ${c};
      delete from calendar_events where circle_id = ${c};
    `);
  }
});
