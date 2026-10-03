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
import { apiCreateEvent, dateInZone, purgeEventsTitled, recipientTimezone } from '../unhappy/writes/_helpers';

// A MEMBER REMOVED FROM THE CIRCLE KEEPS THEIR NAME ON THE TASK THEY DID (W19).
//
// Backend contract (routes/circles.ts removeMemberFromCircle): COMPLETED tasks
// deliberately keep their assignee "for historical record". But the embed is
// read through the user-scoped client and `users` RLS hides a person the viewer
// no longer shares ANY circle with — so it came back null and the row read
// "Unassigned", the detail an unattributed "Completed on", the feed "System".
// Fixed in the backend (utils/userDisplayNames.ts: name-only backfill).
//
// WHY A SELF-CONTAINED SCENE. The 09-30 version removed a satellite member of
// the worker's cloned circle. It was green only when that member ALSO sat in a
// second circle with the viewer (RLS then still showed them) — it passed by
// victim luck and failed when another spec had already removed the lucky one.
// Here the owner and the member are fresh run-scoped accounts, and the test
// ASSERTS from the DB that after removal they share NO circle at all.
//
// The member completes the task themselves, so assignee AND completer are the
// removed person. Real API for setup, real Tasks + Activity pages for reading.
//
// FALSIFY: PW_FALSIFY=task-removed-assignee skips the removal → the "shares no
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

test('a removed member who shares no other circle keeps their name as assignee, completer and feed actor', async ({
  browser,
  request,
  baseURL,
}) => {
  const falsify = (process.env.PW_FALSIFY ?? '').split(',').includes('task-removed-assignee');
  const tag = uniq('tra').replace(/[^a-z0-9]/g, '');

  const owner = await createScopedAccount('tra-owner');
  const ownerApi = await apiSession(request, owner);
  const circleId = await createCircle(ownerApi, `tra ${tag}`);

  const member = await createScopedAccount('tra-member');
  const first = 'Departed';
  const last = `Tag${tag}`;
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

  const title = `Removed assignee task ${tag}`;
  const tz = await recipientTimezone(ownerApi, circleId);
  const ctx = await loginCtx(browser, baseURL, owner);
  try {
    const task = await apiCreateEvent(ownerApi, circleId, {
      event_type: 'task',
      title,
      scheduled_date: dateInZone(tz, 0),
      assigned_to: member.userId,
    });
    // The MEMBER completes it: completed_by = the person about to be removed.
    const done = await memberApi.post(`/api/circles/${circleId}/events/${task.id}/complete`, {
      scheduled_date: task.scheduled_date,
    });
    expect(done.status(), `complete: ${await done.text()}`).toBe(200);

    if (!falsify) {
      const removed = await ownerApi.delete(`/api/circles/${circleId}/members/${member.userId}`);
      expect(removed.status(), `remove member: ${await removed.text()}`).toBe(200);
    }
    // NEGATIVE CONTROL: the member is gone and shares NO circle with the owner,
    // so `users` RLS hides them and only the backend backfill can name them.
    expect(sharedCircles(owner.userId, member.userId), 'the removed member shares no circle with the owner').toBe(0);

    const page = await ctx.newPage();

    // 1. Tasks page row — the assignee.
    await page.goto(`/circles/${circleId}/tasks`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /^Status:/ }).click();
    await page.getByRole('menuitem', { name: 'Completed', exact: true }).click();
    const row = page.getByRole('listitem').filter({ hasText: title });
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText(name, { exact: true })).toBeVisible();
    await expect(row.getByText('Unassigned')).toHaveCount(0);

    // 2. Read-only detail — assignee AND completer.
    await row.getByRole('button', { name: new RegExp(title) }).click();
    const detail = page.getByRole('dialog');
    await expect(detail).toBeVisible();
    await expect(detail.getByText('Assigned to')).toBeVisible();
    await expect(detail.getByText(name, { exact: true })).toBeVisible();
    await expect(detail.getByText('Completed by')).toBeVisible();
    await expect(detail.getByText(new RegExp(`^${name} · `))).toBeVisible();
    await expect(detail.getByText('Unassigned')).toHaveCount(0);
    await expect(detail.getByText('Completed on')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // 3. Activity feed — the completion row names its actor, not "System".
    await page.goto(`/circles/${circleId}/activity`, { waitUntil: 'domcontentloaded' });
    const feedRow = page.getByRole('listitem').filter({ hasText: title }).first();
    await expect(feedRow).toBeVisible({ timeout: 20_000 });
    await expect(feedRow.getByText(name, { exact: true })).toBeVisible();
    await expect(feedRow.getByText('System', { exact: true })).toHaveCount(0);

    // Nothing beyond the name reached the client: the member's email is not on any page read.
    const tasksJson = await (await ownerApi.get(`/api/circles/${circleId}/tasks?status=completed`)).text();
    expect(tasksJson).toContain(last);
    expect(tasksJson).not.toContain(member.email);
  } finally {
    await ctx.close();
    purgeEventsTitled(circleId, title);
  }
});
