import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbCount, dbQuery, failRequest, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { apiCreateEvent, dateInZone, errorToast, successToast } from '../unhappy/writes/_helpers';
import { circleTimezone } from '../notesFirstClassShared';

// K5 (web test gaps 2026-09-29). A caregiver leaves a circle from the Members
// page. Proven against the DB and the API, not just the toast:
// membership row gone, medication-manager flag gone (reminders fall back to
// the owner), open task reassigned to the owner, member_left feed row, and the
// circle really unreachable for the ex-member. Run-scoped accounts only: the
// worker account's circles are never touched.
//
// NOT asserted (in-flight #12): that the leaver's cached circle data is purged.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

async function circleWithMember(request: APIRequestContext, label: string) {
  const owner = await createScopedAccount(`${label}-owner`);
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq(label)); // recipient_name "E2E <label>", no recipient account
  const member = await createScopedAccount(`${label}-member`);
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId); // @example.com, never mailed
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);
  return { owner, ownerSession, member, memberSession, circleId };
}

const respCount = (circleId: string): number =>
  dbCount(
    `select 1 from circle_memberships where circle_id = ${sqlStr(circleId)}::uuid and is_medication_responsible`
  );

test('member leaves: membership, manager flag, task, feed and access all follow', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { owner, ownerSession, member, memberSession, circleId } = await circleWithMember(
    request,
    'leave'
  );
  const tz = await circleTimezone(ownerSession, circleId);

  const put = await ownerSession.put(`/api/circles/${circleId}/medication-responsible`, {
    userId: member.userId,
  });
  expect(put.status(), await put.text()).toBe(200);
  expect(respCount(circleId)).toBe(1);

  const title = `E2E leave task ${uniq('t')}`;
  const task = await apiCreateEvent(ownerSession, circleId, {
    event_type: 'task',
    title,
    scheduled_date: dateInZone(tz, 2),
    assigned_to: member.userId,
  });
  const assignee = () =>
    dbQuery<{ assigned_to: string | null }>(
      `select assigned_to::text as assigned_to from calendar_events where id = ${sqlStr(task.id)}::uuid`
    )[0].assigned_to;
  expect(assignee()).toBe(member.userId);

  await cookieLogin(context, member, baseURL);
  await page.goto(`/circles/${circleId}/members`);

  await page.getByRole('button', { name: 'Leave circle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave this circle?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Leave circle' }).click();

  await expect(successToast(page, 'You left the circle.')).toBeVisible({ timeout: 15_000 });
  // navigate('/circles') runs while the cached circle list still holds the
  // circle just left, so the picker can auto-forward straight back into it
  // (race; observed in 1 of 2 runs). That stale-cache behaviour belongs to
  // in-flight #12 and is deliberately NOT asserted here, so only the prefix is.
  await expect(page).toHaveURL(/\/circles(\/|$)/);

  expect(membershipCount(circleId, member.userId)).toBe(0);
  // Reminders fall back to the owner by design (migration 20260418000000).
  expect(respCount(circleId)).toBe(0);
  expect(assignee()).toBe(owner.userId);
  const feed = dbQuery<{ actor_id: string }>(
    `select actor_id::text as actor_id from activity_feed
      where circle_id = ${sqlStr(circleId)}::uuid and action_type = 'member_left'`
  );
  expect(feed).toHaveLength(1);
  expect(feed[0].actor_id).toBe(member.userId);

  // The ex-member can no longer reach the circle.
  const detail = await memberSession.get(`/api/circles/${circleId}`);
  expect([403, 404], `observed status ${detail.status()}`).toContain(detail.status());
  // Pinned: the exact status observed today.
  expect(detail.status()).toBe(403);
  const list = await memberSession.get('/api/circles');
  expect(list.ok()).toBe(true);
  expect(JSON.stringify(await list.json())).not.toContain(circleId);

  // ...and the page's own circle list does not show it.
  await page.goto('/circles');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(`E2E leave`, { exact: false })).toHaveCount(0);
});

test('leave fails (500): error toast, dialog closes, still a member', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { member, circleId } = await circleWithMember(request, 'leavefail');
  await cookieLogin(context, member, baseURL);
  await page.goto(`/circles/${circleId}/members`);

  const fault = await failRequest(page, 'POST', '/api/circles/:id/leave', { status: 500 });
  await page.getByRole('button', { name: 'Leave circle' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave this circle?' });
  await dialog.getByRole('button', { name: 'Leave circle' }).click();

  await fault.expectHits(1);
  await expect(errorToast(page, 'Something went wrong. Please try again.')).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/members$`));
  expect(membershipCount(circleId, member.userId)).toBe(1);
});
