import type { BrowserContext } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { apiSession, dbCount, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import {
  apiCreateCareNote,
  apiCreateEvent,
  dateInZone,
  escapeRe,
  purgeEventsTitled,
  recipientTimezone,
} from '../unhappy/writes/_helpers';

// Fix 2b + A2, the residual case: a removed member WITH NO NAME (an OAuth signup
// that never set one) who shares no circle with the viewer. The backend has no
// name to fill in: the deployed 1.2.1 backend sends `author: null`, the current
// one (A2) `{id, first_name: null, last_name: null}`. The old web panel built the
// name as `${note.author.first_name} ...`: a null author threw into the error
// boundary ("Something went wrong"; the same crash was proven on a mobile
// device), and null names printed the word "null" as the author. Now the panel
// renders the note with an empty name, and the Notes page row says "Former
// member". Either wire shape is accepted below; the UI must survive both.
//
// departed-note-author.spec.ts covers the NAMED case (the backfill names them);
// this one is the null-author crash guard.
//
// FALSIFY: PW_FALSIFY=departed-nameless-note-author keeps the member's name, so
// the "name-free on the wire" control must go red. The app-level proof
// (the optional chaining removed from EventNotesPanel in a scratch copy) is
// logged in docs/plans/web-e2e-coverage-2026-10-02.md.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').includes('departed-nameless-note-author');

async function loginCtx(
  browser: import('@playwright/test').Browser,
  baseURL: string | undefined,
  acc: ScopedAccount
): Promise<BrowserContext> {
  const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
  const ctx = await browser.newContext({ baseURL: origin, timezoneId: process.env.PW_E2E_TZ || 'America/Denver' });
  await cookieLogin(ctx, acc, baseURL);
  return ctx;
}

function sharedCircles(a: string, b: string): number {
  return dbCount(
    `select 1 from circle_memberships x join circle_memberships y on x.circle_id = y.circle_id
      where x.user_id = ${sqlStr(a)}::uuid and y.user_id = ${sqlStr(b)}::uuid`
  );
}

test('a removed member with NO name: the event note renders with no "null" name and no crash; the care note says "Former member"', async ({
  browser,
  request,
  baseURL,
}) => {
  const tag = uniq('dnn').replace(/[^a-z0-9]/g, '');
  const owner = await createScopedAccount('dnn-owner');
  const ownerApi = await apiSession(request, owner);
  const circleId = await createCircle(ownerApi, `dnn ${tag}`);

  const member = await createScopedAccount('dnn-member');
  if (!FALSIFY) {
    sqlExec(`update public.users set first_name = null, last_name = null where id = ${sqlStr(member.userId)}::uuid;`);
  }
  const memberApi = await apiSession(request, member);
  const invite = await createInvite(ownerApi, circleId);
  const acc = await memberApi.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);

  const title = `Nameless note appt ${tag}`;
  const eventNoteBody = `Event note by nameless ${tag}`;
  const careNoteBody = `Care note by nameless ${tag}`;
  const tz = await recipientTimezone(ownerApi, circleId);
  const today = dateInZone(tz, 0);
  const ctx = await loginCtx(browser, baseURL, owner);
  try {
    const appt = await apiCreateEvent(ownerApi, circleId, {
      event_type: 'appointment',
      title,
      scheduled_date: today,
      scheduled_time: '10:00',
    });
    const en = await memberApi.post(`/api/circles/${circleId}/events/${appt.id}/notes`, { body: eventNoteBody });
    expect(en.status(), `event note: ${await en.text()}`).toBe(201);
    await apiCreateCareNote(memberApi, circleId, careNoteBody);

    const removed = await ownerApi.delete(`/api/circles/${circleId}/members/${member.userId}`);
    expect(removed.status(), `remove member: ${await removed.text()}`).toBe(200);
    expect(sharedCircles(owner.userId, member.userId), 'the removed member shares no circle with the owner').toBe(0);

    // CONTROL: the residual case really reaches the client: author null, no email.
    const notes = (await (await ownerApi.get(`/api/circles/${circleId}/events/${appt.id}/notes`)).json()) as {
      data?: { notes?: { body: string; author: unknown }[] } | { body: string; author: unknown }[];
    };
    const list = Array.isArray(notes.data) ? notes.data : (notes.data?.notes ?? []);
    const mine = list.find((n) => n.body === eventNoteBody);
    expect(mine, 'the event note is listed').toBeTruthy();
    // Name-free on the wire: null (1.2.1) or {id, null, null} (A2).
    const author = (mine!.author ?? null) as { first_name?: string | null; last_name?: string | null } | null;
    expect(author === null || (author.first_name == null && author.last_name == null), JSON.stringify(author)).toBe(true);
    expect(JSON.stringify(notes)).not.toContain(member.email);

    const page = await ctx.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    // 1. Calendar detail -> notes panel: the note renders, nothing crashes.
    await page.goto(`/circles/${circleId}/calendar?date=${today}&eventId=${appt.id}&panel=notes`, {
      waitUntil: 'domcontentloaded',
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole('heading', { name: new RegExp(escapeRe(title)) })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({ timeout: 10_000 });
    const noteItem = dialog.getByRole('listitem').filter({ hasText: eventNoteBody });
    await expect(noteItem).toBeVisible({ timeout: 20_000 });
    // The author slot (the row's first span) is EMPTY: never the words "null" /
    // "undefined" (textContent runs the author into the timestamp, so a \b regex
    // on the whole row cannot see them; the slot itself is asserted instead).
    const authorSlot = noteItem.locator('span').first();
    await expect(authorSlot).toHaveText('');
    await expect(noteItem).toContainText(eventNoteBody);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    expect(pageErrors, 'uncaught page errors').toEqual([]);
    await page.keyboard.press('Escape');

    // 2. Notes page: the care note row names nobody but says "Former member".
    await page.goto(`/circles/${circleId}/notes?date=${today}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({ timeout: 20_000 });
    const row = page.locator('li').filter({ hasText: careNoteBody }).last();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText('Former member')).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await ctx.close();
    sqlExec(`delete from care_notes where circle_id = ${sqlStr(circleId)}::uuid and body = ${sqlStr(careNoteBody)};`);
    purgeEventsTitled(circleId, title);
  }
});
