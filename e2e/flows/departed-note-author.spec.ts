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

// A MEMBER REMOVED FROM THE CIRCLE KEEPS THEIR NAME ON THE NOTES THEY WROTE (Fix 2b).
//
// Event notes and daily care notes embed their author through the user-scoped
// client, and `users` RLS hides a person the viewer no longer shares ANY circle
// with — so after removal the author came back NULL. On web that read as an
// empty author on the event-notes panel (and, before `note.author?.…`, crashed
// EventNotesPanel into the error boundary) and as "Former member" on the Notes
// page. Fixed in the backend (utils/userDisplayNames.ts backfillDepartedUserNames,
// wired into routes/eventNotes.ts + careNotes.ts): a name-only {id, first_name,
// last_name} is filled in — never the email.
//
// SELF-CONTAINED SCENE (same reasoning as task-removed-assignee.spec.ts): the
// owner and member are fresh run-scoped accounts and the test ASSERTS from the
// DB that after removal they share NO circle, so RLS really hides the member and
// only the backfill can name them.
//
// FALSIFY: PW_FALSIFY=departed-note-author skips the removal → the "shares no
// circle" control fails. Against a backend without the fix the name assertions
// fail (proven 2026-10-01 on a private backend with the backfill neutralised).

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

/** Circles both users are CURRENTLY members of. */
function sharedCircles(a: string, b: string): number {
  return dbCount(
    `select 1 from circle_memberships x join circle_memberships y on x.circle_id = y.circle_id
      where x.user_id = ${sqlStr(a)}::uuid and y.user_id = ${sqlStr(b)}::uuid`
  );
}

test('a removed member who shares no other circle keeps their name on their event note and care note', async ({
  browser,
  request,
  baseURL,
}) => {
  const falsify = (process.env.PW_FALSIFY ?? '').split(',').includes('departed-note-author');
  const tag = uniq('dna').replace(/[^a-z0-9]/g, '');

  const owner = await createScopedAccount('dna-owner');
  const ownerApi = await apiSession(request, owner);
  const circleId = await createCircle(ownerApi, `dna ${tag}`);

  const member = await createScopedAccount('dna-member');
  const first = 'Departed';
  const last = `Author${tag}`;
  const name = `${first} ${last}`;
  sqlExec(
    `update public.users set first_name = ${sqlStr(first)}, last_name = ${sqlStr(last)}
      where id = ${sqlStr(member.userId)}::uuid;`
  );
  const memberApi = await apiSession(request, member);
  const invite = await createInvite(ownerApi, circleId);
  const acc = await memberApi.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);
  // Brand-new accounts: this circle is the ONLY one they share.
  expect(sharedCircles(owner.userId, member.userId), 'fixture: exactly one shared circle').toBe(1);

  const title = `Departed note appt ${tag}`;
  const eventNoteBody = `Event note by departed ${tag}`;
  const careNoteBody = `Care note by departed ${tag}`;
  const tz = await recipientTimezone(ownerApi, circleId);
  const today = dateInZone(tz, 0);
  const ctx = await loginCtx(browser, baseURL, owner);
  let careNoteId: string | null = null;
  try {
    const appt = await apiCreateEvent(ownerApi, circleId, {
      event_type: 'appointment',
      title,
      scheduled_date: today,
      scheduled_time: '10:00',
    });

    // The MEMBER writes both notes: the author is the person about to be removed.
    const en = await memberApi.post(`/api/circles/${circleId}/events/${appt.id}/notes`, {
      body: eventNoteBody,
    });
    expect(en.status(), `event note: ${await en.text()}`).toBe(201);
    careNoteId = await apiCreateCareNote(memberApi, circleId, careNoteBody);

    if (!falsify) {
      const removed = await ownerApi.delete(`/api/circles/${circleId}/members/${member.userId}`);
      expect(removed.status(), `remove member: ${await removed.text()}`).toBe(200);
    }
    // NEGATIVE CONTROL: the member is gone and shares NO circle with the owner,
    // so `users` RLS hides them and only the backend backfill can name them.
    expect(sharedCircles(owner.userId, member.userId), 'the removed member shares no circle with the owner').toBe(0);

    // API: the name is there, the email is not. Soft, so a missing name still
    // lets the UI assertions below run and report too.
    const enJson = await (await ownerApi.get(`/api/circles/${circleId}/events/${appt.id}/notes`)).text();
    expect(enJson).toContain(eventNoteBody);
    expect.soft(enJson, 'event-notes GET names the departed author').toContain(last);
    expect(enJson).not.toContain(member.email);
    const cnJson = await (await ownerApi.get(`/api/circles/${circleId}/care-notes`)).text();
    expect(cnJson).toContain(careNoteBody);
    expect.soft(cnJson, 'care-notes GET names the departed author').toContain(last);
    expect(cnJson).not.toContain(member.email);

    const page = await ctx.newPage();

    // 1. Event detail → notes panel: author name next to the body, no crash.
    await page.goto(`/circles/${circleId}/calendar?date=${today}&eventId=${appt.id}&panel=notes`, {
      waitUntil: 'domcontentloaded',
    });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole('heading', { name: new RegExp(escapeRe(title)) })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({ timeout: 10_000 });
    const noteItem = dialog.getByRole('listitem').filter({ hasText: eventNoteBody });
    await expect(noteItem).toBeVisible({ timeout: 20_000 });
    await expect.soft(noteItem.getByText(name, { exact: true }), 'event note shows the departed author').toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 2. Notes page for the note's date: the care note row names its author.
    await page.goto(`/circles/${circleId}/notes?date=${today}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Notes', exact: true })).toBeVisible({ timeout: 20_000 });
    const row = page.locator('li').filter({ hasText: careNoteBody }).last();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText(name, { exact: true }).first(), 'care note shows the departed author').toBeVisible();
    await expect(row.getByText('Former member')).toHaveCount(0);
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
  } finally {
    await ctx.close();
    if (careNoteId) sqlExec(`delete from care_notes where id = ${sqlStr(careNoteId)}::uuid;`);
    sqlExec(
      `delete from care_notes where circle_id = ${sqlStr(circleId)}::uuid and body = ${sqlStr(careNoteBody)};`
    );
    purgeEventsTitled(circleId, title);
  }
});
