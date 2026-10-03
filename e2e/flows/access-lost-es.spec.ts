import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// XR + the Spanish wording work (10-02): when a member is REMOVED while their tab
// is open, the circle layout shows the access-lost state (CircleAccessLost) in
// the member's language: "Acceso eliminado", "Ya no tienes acceso a este
// círculo…", "Volver a círculos". The English state has e2e
// (circle-access-lost-purge, member-removed-two-person); the Spanish copy did not.
//
// A real removal: the owner removes the member through the public API (seeding;
// the owner's Members UI is covered by member-removed-two-person), the member's
// tab is refocused (the real refetch trigger), and the member's UI is read.
//
// FALSIFY: PW_FALSIFY=access-lost-es skips the removal, so the access-lost state
// must never appear and the run must go red. The app-level proof (the Spanish
// strings reverted to English in a scratch copy) is logged in
// docs/plans/web-e2e-coverage-2026-10-02.md.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').includes('access-lost-es');

/** The same refetch the user triggers by returning to the tab. */
const refocus = (page: Page) =>
  page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    }
  });

test('ES: a member removed while the tab is open sees "Acceso eliminado", the Spanish body and "Volver a círculos"', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createScopedAccount('lostes-owner');
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq('lostes'));
  const member = await createScopedAccount('lostes-member');
  sqlExec(
    `update public.users set language = 'es', language_set_at = now() where id = ${sqlStr(member.userId)}::uuid;`
  );
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId); // @example.com, never mailed
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);

  await cookieLogin(context, member, baseURL);
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('lang', /^es/, { timeout: 20_000 });
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'Acceso eliminado' })).toHaveCount(0);

  if (!FALSIFY) {
    const kick = await ownerSession.delete(`/api/circles/${circleId}/members/${member.userId}`);
    expect(kick.status(), await kick.text()).toBeLessThan(300);
    expect(membershipCount(circleId, member.userId)).toBe(0);
  }

  await refocus(page);
  const h1 = page.getByRole('heading', { level: 1, name: 'Acceso eliminado' });
  await expect(h1).toBeVisible({ timeout: 20_000 });
  await expect(h1).toBeFocused();
  await expect(
    page.getByText(
      'Ya no tienes acceso a este círculo. Es posible que el dueño te haya eliminado de él o que haya eliminado el círculo.',
      { exact: true }
    )
  ).toBeVisible();
  const back = page.getByRole('link', { name: 'Volver a círculos', exact: true });
  await expect(back).toHaveAttribute('href', '/circles');
  // No English left over, and none of the per-page "couldn't load" cards.
  await expect(page.locator('main')).not.toContainText(/Access removed|no longer have access|Return to circles/);
  await expect(page.locator('main')).not.toContainText(/No se pudo cargar|Couldn't load/);

  // The action works: back to the (now empty) picker, in Spanish.
  await back.click();
  await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Crear círculo', exact: true })).toBeVisible({ timeout: 20_000 });
});
