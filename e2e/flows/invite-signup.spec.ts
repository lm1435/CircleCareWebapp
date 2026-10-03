import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { runScopedEmail } from '../isolation';
import { dbCount, dbQuery, generateSignupOtp, sqlStr } from '../unhappy';
import {
  PARKED,
  createCircle,
  createScopedAccount,
  inviteStatus,
  ownerApi,
  sessionItems,
  typeOtp,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// ===========================================================================
// SIGNING UP FROM AN INVITE (docs/plans/test-gap-audit-2026-09-29.md #6;
// Maestro twins: mobile/.maestro/parity/invites/invite-signup-{link,pending}.yaml).
//
// A NEW account holding an invite must land IN the inviting circle and never
// be pushed into creating a throwaway one (memory
// project_forced_circle_before_invite_accept: 9 prod users burned their free
// circle on a shell; the next real circle then 402s).
//   1. LINK: /invite/:code -> "Create an account to join" -> /signup ->
//      /verify-email (OTP) -> back on /invite/:code -> auto-accept -> "You've
//      joined <circle>." on /circles/<id>. DB: one membership, 0 owned circles.
//   2. PENDING (no link): plain /signup with the invited address -> verify ->
//      /circles offers "You have 1 pending invitation" -> /invites -> Accept ->
//      the circle. DB: one membership, 0 owned circles.
//
// MAIL. The invitee is a run-scoped @circlecare.test address (teardown purges
// it; `generateSignupOtp` requires it). RUN THIS SPEC AGAINST A BACKEND STARTED
// WITH `EMAIL_BLOCKED_DOMAINS=circlecare.test`: then the invite e-mail and
// the signup are refused by the backend's own blocked-domain rule
// (services/emailService.ts isEmailBlocked) — the invite is stored but never
// mailed, and POST /api/auth/signup answers its by-design fake 200 without
// calling GoTrue (no hook, no mail). The spec checks that precondition first
// and FAILS naming it (never a silent skip). The signup code comes from
// GoTrue's admin generate_link (`generateSignupOtp`), which also pre-claims
// the welcome mail.
//
// FALSIFY (PW_FALSIFY=<name>[,…]): invite-signup-link / invite-signup-pending
// cancel the invite right after creating it — the join (and the banner) must
// then be absent and the test red.
// ===========================================================================

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));

test.use({ storageState: { cookies: [], origins: [] } });

const joinedNamed = (circleName: string) => `You've joined ${circleName}.`;
const circleNameFor = (label: string) => `E2E ${label}`.slice(0, 100);

/** Precondition: this backend treats @circlecare.test as a blocked domain (see header). */
async function assertBlockedDomainBackend(page: Page): Promise<void> {
  const probe = runScopedEmail(uniq('probe-blocked'));
  const res = await page.request.post('/api/auth/signup', {
    data: { email: probe, password: 'Str0ng!Passw0rd', first_name: 'Probe', last_name: 'Blocked', termsAccepted: true },
  });
  const body = (await res.json().catch(() => ({}))) as { data?: unknown };
  const created = dbCount(`select 1 from auth.users where email = ${sqlStr(probe)}`);
  expect(
    res.status() === 200 && body.data === undefined && created === 0,
    `[e2e precondition] this spec needs a backend started with EMAIL_BLOCKED_DOMAINS=circlecare.test ` +
      `(signup of ${probe} answered ${res.status()} ${JSON.stringify(body).slice(0, 120)}, auth user created: ${created})`
  ).toBe(true);
}

async function fillSignup(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 20_000 });
  await page.locator('#first_name').fill('Ada');
  await page.locator('#last_name').fill('Invitee');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('Str0ng!Passw0rd');
  await page.locator('#confirmPassword').fill('Str0ng!Passw0rd');
  await page.locator('#termsAccepted').check({ force: true });
}

async function verifyWithCode(page: Page, email: string): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 20_000 });
  const otp = await generateSignupOtp(email);
  await typeOtp(page, otp); // auto-submits on the sixth digit
}

function userIdOf(email: string): string {
  const rows = dbQuery<{ id: string }>(`select id from public.users where email = ${sqlStr(email.toLowerCase())}`);
  expect(rows, `public.users row for ${email}`).toHaveLength(1);
  return rows[0].id;
}
function ownedCircles(userId: string): number {
  return dbCount(`select 1 from care_circles where owner_id = ${sqlStr(userId)}::uuid`);
}
function memberships(userId: string): string[] {
  return dbQuery<{ circle_id: string }>(
    `select circle_id from circle_memberships where user_id = ${sqlStr(userId)}::uuid`
  ).map((r) => r.circle_id);
}

test('invite link -> create account -> verify -> lands in the invited circle, named, no throwaway circle', async ({
  page,
  request,
}) => {
  test.slow();
  await assertBlockedDomainBackend(page);
  const api = await ownerApi(request, await createScopedAccount('invsu-owner'));
  const label = uniq('invsu-link');
  const circleId = await createCircle(api, label);
  const email = runScopedEmail(uniq('invsu-link-new'));
  const created = await api.post(`/api/circles/${circleId}/invites`, { email, member_type: 'caregiver' });
  expect(created.status(), `create invite: ${await created.text()}`).toBeLessThan(300);
  const invite = ((await created.json()) as { data: { invite: { id: string; invite_code: string } } }).data.invite;
  if (FALSIFY.has('invite-signup-link')) expect((await api.delete(`/api/invites/${invite.id}`)).ok()).toBe(true);

  await page.goto(`/invite/${invite.invite_code}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Create an account to join' }).click();
  await expect(page).toHaveURL(/\/signup$/, { timeout: 20_000 });
  expect((await sessionItems(page, [PARKED.invite]))[PARKED.invite], 'the code is parked across signup').toBe(invite.invite_code);
  await fillSignup(page, email);
  await page.getByRole('button', { name: 'Create account' }).click();
  await verifyWithCode(page, email);

  // Verified -> back through the invite page -> auto-accept -> the circle, named.
  await expect(page.getByText(joinedNamed(circleNameFor(label)))).toBeVisible({ timeout: 25_000 });
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Who are you caring for/i })).toHaveCount(0);

  const userId = userIdOf(email);
  expect(memberships(userId), 'exactly one membership: the invited circle').toEqual([circleId]);
  expect(ownedCircles(userId), 'NO throwaway circle').toBe(0);
  expect(inviteStatus(invite.id)).toBe('accepted');
  expect((await sessionItems(page, [PARKED.invite]))[PARKED.invite], 'parked code consumed').toBeNull();
});

test('plain signup with a pending email invite -> verify -> the pending invitation is offered -> accept -> no throwaway circle', async ({
  page,
  request,
}) => {
  test.slow();
  await assertBlockedDomainBackend(page);
  const api = await ownerApi(request, await createScopedAccount('invsu-owner'));
  const label = uniq('invsu-pend');
  const circleId = await createCircle(api, label);
  const email = runScopedEmail(uniq('invsu-pend-new'));
  const created = await api.post(`/api/circles/${circleId}/invites`, { email, member_type: 'caregiver' });
  expect(created.status(), `create invite: ${await created.text()}`).toBeLessThan(300);
  const inviteId = ((await created.json()) as { data: { invite: { id: string } } }).data.invite.id;
  if (FALSIFY.has('invite-signup-pending')) expect((await api.delete(`/api/invites/${inviteId}`)).ok()).toBe(true);

  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await fillSignup(page, email);
  await page.getByRole('button', { name: 'Create account' }).click();
  await verifyWithCode(page, email);

  // The landing OFFERS the pending invite.
  await expect(page).toHaveURL(/\/circles$/, { timeout: 25_000 });
  const banner = page.getByRole('link', { name: /You have 1 pending invitation/ });
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await banner.click();
  await expect(page).toHaveURL(/\/invites$/, { timeout: 20_000 });
  const accept = page.getByRole('button', { name: 'Accept', exact: true });
  await expect(accept).toBeVisible({ timeout: 20_000 });
  await accept.click();
  await expect(page.getByText(joinedNamed(circleNameFor(label)))).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });

  const userId = userIdOf(email);
  expect(memberships(userId), 'exactly one membership: the invited circle').toEqual([circleId]);
  expect(ownedCircles(userId), 'NO throwaway circle').toBe(0);
  expect(inviteStatus(inviteId)).toBe('accepted');
});
