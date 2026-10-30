import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  inviteStatus,
  membershipCount,
  ownerApi,
  rewriteJson,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// Onboarding 1.3.1, section 4 (web): the invitee welcome at /circles/:id/welcome.
// A NEW member who accepts an invite (landing page / pending invites) sees it once,
// then "Go to Today". Owners, existing members and reloads just land on Today.
// Run-scoped accounts only (invitees and owners are created per test).

test.use({ storageState: { cookies: [], origins: [] } });

const ACCEPT_BY_CODE = '/api/invites/code/:code/accept';
const circleNameFor = (label: string) => `E2E ${label}`.slice(0, 100);

async function ownerWithInvite(request: Parameters<typeof ownerApi>[0], label: string) {
  const api = await ownerApi(request, await createScopedAccount('obw-owner'));
  const circleId = await createCircle(api, label);
  return { api, circleId, circleName: circleNameFor(label) };
}

/** The welcome heading: the inviter has no first name on a scoped account, so either title form. */
const heading = (page: Page, circleName: string) =>
  page.getByRole('heading', {
    level: 1,
    name: new RegExp(`^(.+ invited you to help with|You're helping with) ${circleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.$`),
  });

test('landing accept: welcome with the three editor items, Go to Today, and a reload never shows it again', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const label = uniq('obw-land');
  const { api, circleId, circleName } = await ownerWithInvite(request, label);
  const invite = await createInvite(api, circleId);
  const invitee = await createScopedAccount('obw-invitee');
  await cookieLogin(context, invitee, baseURL);

  await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Accept invitation' }).click();

  await expect(heading(page, circleName)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/welcome$`));
  await expect(page.getByText('Welcome', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  const items = page.getByTestId('invitee-welcome-items').getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(page.getByText("See today's meds and mark a dose Taken")).toBeVisible();
  await expect(page.getByText('Add a note about how the day went')).toBeVisible();
  await expect(page.getByText('See appointments and tasks')).toBeVisible();

  // Reload before continuing: the welcome was consumed on first view, so it is not shown again.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Go to Today' })).toHaveCount(0);

  // Walking back to the welcome URL by hand does not show it either.
  await page.goto(`/circles/${circleId}/welcome`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Go to Today' })).toHaveCount(0);

  expect(membershipCount(circleId, invitee.userId)).toBe(1);
  expect(inviteStatus(invite.id)).toBe('accepted');
});

test('Go to Today opens the circle', async ({ page, request, context, baseURL }) => {
  const label = uniq('obw-go');
  const { api, circleId, circleName } = await ownerWithInvite(request, label);
  const invite = await createInvite(api, circleId);
  await cookieLogin(context, await createScopedAccount('obw-invitee'), baseURL);

  await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(heading(page, circleName)).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Go to Today', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Go to Today' })).toHaveCount(0);
});

test('pending invitations path: Accept lands on the welcome', async ({ page, request, context, baseURL }) => {
  const label = uniq('obw-pend');
  const { api, circleId, circleName } = await ownerWithInvite(request, label);
  const invitee = await createScopedAccount('obw-invitee');
  // A second circle of their own, so /circles does not auto-forward and /invites is reachable.
  await createCircle(await ownerApi(request, invitee), uniq('obw-own'));
  const created = await api.post(`/api/circles/${circleId}/invites`, {
    email: invitee.email,
    member_type: 'caregiver',
  });
  expect(created.status(), await created.text()).toBeLessThan(300);
  await cookieLogin(context, invitee, baseURL);

  await page.goto('/invites', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(heading(page, circleName)).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/welcome$`));
  await page.getByRole('button', { name: 'Go to Today', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
});

test('view-only member sees only the "See" items', async ({ page, request, context, baseURL }) => {
  const label = uniq('obw-view');
  const { api, circleId, circleName } = await ownerWithInvite(request, label);
  const invite = await createInvite(api, circleId);
  await cookieLogin(context, await createScopedAccount('obw-invitee'), baseURL);

  await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
  // The real accept, with only the view_only flag forced (a capped free circle is what sets it server-side).
  const rewrite = await rewriteJson(page, 'POST', ACCEPT_BY_CODE, (json) => ({
    ...json,
    data: { ...(json.data as Record<string, unknown>), view_only: true },
  }));
  await page.getByRole('button', { name: 'Accept invitation' }).click();

  await expect(heading(page, circleName)).toBeVisible({ timeout: 20_000 });
  const items = page.getByTestId('invitee-welcome-items').getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(page.getByText("See today's meds", { exact: true })).toBeVisible();
  await expect(page.getByText('Who gave what, and when.')).toBeVisible();
  await expect(page.getByText(`Everything coming up for ${circleName}.`)).toBeVisible();
  await expect(page.getByText(/mark a dose/i)).toHaveCount(0);
  await expect(page.getByText('Add a note about how the day went')).toHaveCount(0);
  expect(rewrite.requests).toHaveLength(1);
});

test('the circle owner never sees the welcome', async ({ page, request, context, baseURL }) => {
  const owner = await createScopedAccount('obw-owner-self');
  const circleId = await createCircle(await ownerApi(request, owner), uniq('obw-owner'));
  await cookieLogin(context, owner, baseURL);
  await page.goto(`/circles/${circleId}/welcome`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Go to Today' })).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`welcome is accessible (axe) in ${scheme} mode and fits a phone width`, async ({
    page,
    request,
    context,
    baseURL,
  }, testInfo) => {
    const label = uniq(`obw-a11y-${scheme}`);
    const { api, circleId, circleName } = await ownerWithInvite(request, label);
    const invite = await createInvite(api, circleId);
    await cookieLogin(context, await createScopedAccount('obw-invitee'), baseURL);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 375, height: 760 });

    await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(heading(page, circleName)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Go to Today' })).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no horizontal scroll at 375px').toBeLessThanOrEqual(0);
    const box = await page.getByRole('button', { name: 'Go to Today' }).boundingBox();
    expect(box?.height ?? 0, 'touch target >= 44px').toBeGreaterThanOrEqual(44);
    await checkA11y(page, `/circles/${circleId}/welcome`, testInfo);
  });
}
