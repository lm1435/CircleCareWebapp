import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, errorCodeOf, failRequest, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { errorToast, successToast } from '../unhappy/writes/_helpers';

// K6 (web test gaps 2026-09-29). The medication manager decides who gets dose
// reminders. Set / clear / failure / non-owner refusal, each proven against
// circle_memberships.is_medication_responsible. Run-scoped accounts only.

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

const responsible = (circleId: string): string[] =>
  dbQuery<{ user_id: string }>(
    `select user_id::text as user_id from circle_memberships
      where circle_id = ${sqlStr(circleId)}::uuid and is_medication_responsible`
  ).map((r) => r.user_id);

test('medication manager: set, clear, fail, and non-owner refusal against the DB', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { owner, ownerSession, member, memberSession, circleId } = await circleWithMember(
    request,
    'medmgr'
  );

  // The member's display name exactly as MembersPage.memberName builds it.
  const detail = await ownerSession.get(`/api/circles/${circleId}`);
  expect(detail.status()).toBe(200);
  const members = ((await detail.json()) as {
    data: {
      circle: {
        members: { user_id?: string; id?: string; first_name?: string; last_name?: string; email: string }[];
      };
    };
  }).data.circle.members;
  const row = members.find((m) => (m.user_id ?? m.id) === member.userId);
  expect(row, 'member present in circle detail').toBeTruthy();
  const memberName =
    [row!.first_name, row!.last_name].filter(Boolean).join(' ') || row!.email;

  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}/members`);
  const actions = () => page.getByRole('button', { name: `Actions for ${memberName}` });

  // 1. Make manager.
  await actions().click();
  await page.getByRole('menuitem', { name: 'Make medication manager' }).click();
  await expect(successToast(page, `${memberName} now manages medication reminders.`)).toBeVisible({
    timeout: 15_000,
  });
  expect(responsible(circleId)).toEqual([member.userId]);

  // 2. Persisted: after a reload the menu offers to clear it.
  await page.reload();
  await actions().click();
  await page.getByRole('menuitem', { name: 'Remove medication manager' }).click();
  await expect(successToast(page, 'Medication manager cleared.')).toBeVisible({ timeout: 15_000 });
  expect(responsible(circleId)).toEqual([]);

  // 3. Failure: error toast, nothing written, the menu is usable again.
  await page.reload();
  const fault = await failRequest(page, 'PUT', '/api/circles/:id/medication-responsible', {
    status: 500,
  });
  await actions().click();
  await page.getByRole('menuitem', { name: 'Make medication manager' }).click();
  await fault.expectHits(1);
  await expect(errorToast(page, 'Something went wrong. Please try again.')).toBeVisible();
  expect(responsible(circleId)).toEqual([]);
  await actions().click();
  await expect(page.getByRole('menuitem', { name: 'Make medication manager' })).toBeEnabled();
  await page.keyboard.press('Escape');

  // 4. A non-owner cannot set it, whatever the UI hides.
  const refused = await memberSession.put(`/api/circles/${circleId}/medication-responsible`, {
    userId: member.userId,
  });
  expect(refused.status()).toBe(403);
  expect(await errorCodeOf(refused)).toBe('FORBIDDEN');
  expect(responsible(circleId)).toEqual([]);
});
