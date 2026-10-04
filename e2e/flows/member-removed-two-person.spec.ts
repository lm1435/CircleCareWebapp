import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec } from '../db';
import { apiSession, sqlStr, type ApiSession } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { apiCreateCareNote } from '../unhappy/writes/_helpers';
import { circleTimezone, createDailyMedication, dateInTz } from '../notesFirstClassShared';

// PK14 (privacy), TWO REAL PEOPLE. The owner removes a caregiver through the real Members
// UI while the caregiver's own browser (a second context, its own session) has the
// circle's PHI on screen. Nothing is injected at the network edge: real backend, real
// removal, real 403 on the member's next circle read. circle-access-lost-purge.spec.ts
// covers the same purge with a simulated server; this is the end-to-end proof.
//
// What "no PHI afterwards" means here: the marker emergency contact / allergy, the
// medication name and the care note are absent from the DOM (a) with NO page reload —
// only a real-life refetch trigger (tab focus, or a route change) — and (b) when the
// member navigates to the circle's emergency / meds / notes URLs by client-side routing.
//
// FALSIFY: neutralise the QueryCache onError purge in webapp/src/lib/queryClient.ts →
// the "PHI is gone" assertions go red (cached data survives a failed refetch).
//
// Run-scoped accounts only (own owner, own circle, own member); nothing of the worker's
// cloned circles is touched. NOT asserted: the React Query cache contents (needs an app
// hook; src/lib/__tests__ purge/privacy vitest specs cover the cache itself).

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

const RAW_ERROR = /FORBIDDEN|NOT_FOUND|TypeError|undefined|\[object|Unexpected Application Error/;

const MEMBER_FIRST = 'Removable';

interface Scene {
  owner: ScopedAccount;
  ownerSession: ApiSession;
  member: ScopedAccount;
  memberSession: ApiSession;
  circleId: string;
  memberName: string;
  phi: { contact: string; allergy: string; med: string; note: string };
}

async function scene(request: APIRequestContext): Promise<Scene> {
  const tag = uniq('rm').replace(/[^a-z0-9]/g, '');
  const owner = await createScopedAccount('rm-owner');
  const ownerSession = await apiSession(request, owner);
  const circleId = await createCircle(ownerSession, `rm ${tag}`);
  const member = await createScopedAccount('rm-member');
  const memberLast = `Tag${tag}`;
  sqlExec(
    `update public.users set first_name = ${sqlStr(MEMBER_FIRST)}, last_name = ${sqlStr(memberLast)}
      where id = ${sqlStr(member.userId)}::uuid;`
  );
  const memberSession = await apiSession(request, member);
  const invite = await createInvite(ownerSession, circleId);
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);

  const phi = {
    contact: `PhiContact${tag}`,
    allergy: `PhiAllergy${tag}`,
    med: `PhiMed${tag}`,
    note: `PhiNote${tag} private care note`,
  };
  const put = await ownerSession.put(`/api/circles/${circleId}/emergency-info`, {
    allergies: [phi.allergy],
    emergency_contacts: [{ name: phi.contact, relationship: 'Daughter', phone: '5551234567', is_primary: true }],
  });
  expect(put.status(), await put.text()).toBe(200);
  const today = dateInTz(await circleTimezone(ownerSession, circleId), 0);
  await createDailyMedication(ownerSession, circleId, phi.med, today);
  await apiCreateCareNote(ownerSession, circleId, phi.note);
  return { owner, ownerSession, member, memberSession, circleId, memberName: `${MEMBER_FIRST} ${memberLast}`, phi };
}

/** The owner removes the member through the real Members page (menu → Remove → confirm). */
async function ownerRemovesViaUi(ownerPage: Page, s: Scene): Promise<void> {
  await ownerPage.goto(`/circles/${s.circleId}/members`, { waitUntil: 'domcontentloaded' });
  await expect(ownerPage.getByRole('heading', { name: 'Members' })).toBeVisible({ timeout: 20_000 });
  await ownerPage.getByRole('button', { name: `Actions for ${s.memberName}`, exact: true }).click();
  await ownerPage.getByRole('menuitem', { name: 'Remove', exact: true }).click();
  const dialog = ownerPage.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Remove member?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(ownerPage.getByRole('button', { name: `Actions for ${s.memberName}`, exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  expect(membershipCount(s.circleId, s.member.userId), 'membership row deleted').toBe(0);
}

/** Return-to-the-tab, as the browser does it: visibilitychange hidden → visible (React Query's focus signal). */
async function refocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const state of ['hidden', 'visible']) {
      Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    }
  });
}

/** Client-side navigation (no reload): click the sidebar link. */
async function spaTo(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('navigation').getByRole('link', { name }).first().click();
}

async function memberSeesPhi(page: Page, s: Scene): Promise<void> {
  await page.goto(`/circles/${s.circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(s.phi.contact).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(s.phi.allergy).first()).toBeVisible();
  await spaTo(page, /^Medications/);
  await expect(page.getByText(s.phi.med).first()).toBeVisible({ timeout: 20_000 });
  await spaTo(page, /^Notes/);
  await expect(page.getByText(s.phi.note).first()).toBeVisible({ timeout: 20_000 });
}

async function expectNoPhi(page: Page, s: Scene): Promise<void> {
  for (const text of Object.values(s.phi)) {
    await expect(page.getByText(text)).toHaveCount(0);
  }
}

async function assertServerRefuses(s: Scene): Promise<void> {
  const detail = await s.memberSession.get(`/api/circles/${s.circleId}`);
  expect(detail.status(), await detail.text()).toBe(403);
  for (const sub of ['emergency-info', 'care-notes', 'events']) {
    const r = await s.memberSession.get(`/api/circles/${s.circleId}/${sub}`);
    expect(r.status(), `member GET ${sub}`).toBe(403);
  }
  const list = await s.memberSession.get('/api/circles');
  expect(list.ok()).toBe(true);
  expect(JSON.stringify(await list.json())).not.toContain(s.circleId);
}

/** After removal the circle must be unreachable from the member's tab, by every client route, without a reload. */
async function assertGoneEverywhere(page: Page, s: Scene): Promise<void> {
  await expectNoPhi(page, s);
  for (const seg of ['emergency', 'meds', 'notes']) {
    // A client-side navigation to the circle's own URL (what a bookmark-in-app / back button does).
    await page.evaluate((path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/circles/${s.circleId}/${seg}`);
    await expect(page).toHaveURL(new RegExp(`/circles/${s.circleId}/${seg}$`));
    await page.waitForTimeout(1_500);
    // Let the read settle (Loading… → the page's own error card) before judging what is shown.
    await expect(page.locator('main')).not.toContainText(/Loading/, { timeout: 20_000 });
    await expectNoPhi(page, s);
    await expectAccessRemoved(page);
    const body = await page.locator('body').innerText();
    expect(body, `${seg}: no raw error text`).not.toMatch(RAW_ERROR);
    expect(body.trim().length, `${seg}: page is not blank`).toBeGreaterThan(50);
    test.info().annotations.push({
      type: `shows-${seg}`,
      description: (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160),
    });
  }
}

/**
 * The circle-layout "access removed" state (parity with mobile CircleDetailScreen): the SAME copy,
 * one <h1> that took focus, a Return-to-circles link, and NONE of the per-page "Couldn't load" cards.
 */
async function expectAccessRemoved(page: Page): Promise<void> {
  const h1 = page.getByRole('heading', { level: 1, name: 'Access removed' });
  await expect(h1).toBeVisible({ timeout: 20_000 });
  await expect(h1).toBeFocused();
  await expect(
    page.getByText('You no longer have access to this circle. The owner may have removed you or deleted the circle.')
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to circles' })).toHaveAttribute('href', '/circles');
  await expect(page.locator('main')).not.toContainText(/Couldn't load|Check your connection/);
}

/** The circle is gone from the member's own circle list (UI). */
async function assertGoneFromPicker(page: Page, s: Scene): Promise<void> {
  // Already on the picker (after Return to circles)? Then there is nothing to click; a member left
  // with no circle sees the onboarding empty state, which has no "All circles" switcher.
  if (!/\/circles(\?.*)?$/.test(new URL(page.url()).pathname + new URL(page.url()).search)) {
    await page.getByRole('link', { name: 'All circles' }).or(page.getByRole('button', { name: 'All circles' })).first().click();
  }
  await expect(page).toHaveURL(/\/circles(\?.*)?$/, { timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await expect(page.getByText(/E2E rm /)).toHaveCount(0);
  await expectNoPhi(page, s);
}

async function newCtx(browser: import('@playwright/test').Browser, baseURL: string | undefined, acc: ScopedAccount) {
  const origin = new URL(baseURL ?? 'http://localhost:5173').origin;
  const ctx: BrowserContext = await browser.newContext({
    baseURL: origin,
    // The project pins the browser zone (Denver); PW_E2E_TZ overrides it for the far-zone sweep.
    timezoneId: process.env.PW_E2E_TZ || 'America/Denver',
  });
  await cookieLogin(ctx, acc, baseURL);
  return ctx;
}

test("owner removes the member in the Members UI: the member's open tab drops the PHI on refocus, no reload", async ({
  browser,
  request,
  baseURL,
}) => {
  const s = await scene(request);
  const ctxM = await newCtx(browser, baseURL, s.member);
  const ctxO = await newCtx(browser, baseURL, s.owner);
  try {
    const memberPage = await ctxM.newPage();
    const ownerPage = await ctxO.newPage();
    await memberSeesPhi(memberPage, s);
    const navigations: string[] = [];
    memberPage.on('load', () => navigations.push(memberPage.url()));

    await ownerRemovesViaUi(ownerPage, s);

    // Real life: the member comes back to the tab. NO reload.
    await refocus(memberPage);
    await expect(memberPage.getByText(s.phi.note)).toHaveCount(0, { timeout: 20_000 });
    await assertGoneEverywhere(memberPage, s);
    // The action works: Return to circles lands on the picker (client-side), which no longer lists it.
    await memberPage.getByRole('link', { name: 'Return to circles' }).click();
    await expect(memberPage).toHaveURL(/\/circles$/, { timeout: 20_000 });
    await assertGoneFromPicker(memberPage, s);
    await assertServerRefuses(s);
    expect(navigations, 'the member tab was never reloaded').toEqual([]);
  } finally {
    await ctxM.close();
    await ctxO.close();
  }
});

test('member is on another page when removed, then clicks back into the circle: no PHI, circle gone', async ({
  browser,
  request,
  baseURL,
}) => {
  const s = await scene(request);
  const ctxM = await newCtx(browser, baseURL, s.member);
  const ctxO = await newCtx(browser, baseURL, s.owner);
  try {
    const memberPage = await ctxM.newPage();
    const ownerPage = await ctxO.newPage();
    await memberSeesPhi(memberPage, s);
    const navigations: string[] = [];
    memberPage.on('load', () => navigations.push(memberPage.url()));

    // Leave the circle's pages for the profile (client-side): the circle's queries unmount but stay cached.
    await memberPage.getByRole('button', { name: 'Account' }).click();
    await memberPage.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(memberPage).toHaveURL(/\/profile$/);
    await expect(memberPage.getByText(s.phi.note)).toHaveCount(0);

    await ownerRemovesViaUi(ownerPage, s);

    // The member heads for the circle list (the picker forwards a one-circle user straight into
    // their remaining circle). The cached list is inside staleTime (60s), so mounting alone would
    // NOT refetch it; the trigger is the one a returning user gives it: the tab regains focus
    // (the header's circle switcher keeps the list query active). That refetch no longer lists
    // the removed circle.
    await memberPage.getByRole('link', { name: 'CircleCare' }).first().click();
    await expect(memberPage).toHaveURL(/\/circles(\/[0-9a-f-]{36})?$/, { timeout: 20_000 });
    await expect(memberPage.getByRole('heading', { level: 1 })).toBeVisible();
    // Let the forward (lazy route chunk, remaining circle's reads) settle: a refocus that lands in the
    // gap between the picker unmounting and the next page mounting has no list observer to refetch.
    await memberPage.waitForLoadState('networkidle');
    await memberPage.waitForTimeout(1_000);
    const listRefetch = memberPage.waitForResponse(
      (r) => r.request().method() === 'GET' && /\/api\/circles(\?|$)/.test(r.url()),
      { timeout: 20_000 }
    );
    await refocus(memberPage);
    const listBody = JSON.stringify(await (await listRefetch).json());
    expect(listBody, 'the refetched list no longer contains the circle').not.toContain(s.circleId);

    // ...so the only way back in is History (Back x2: profile, then the circle's notes page).
    // The circles-LIST refetch above no longer contains the circle, so the QueryCache purged it
    // (purgeCirclesAbsentFromList): Back must NOT paint the cached PHI, even inside staleTime and
    // BEFORE any refocus refetch.
    await memberPage.goBack();
    await memberPage.goBack();
    await expect(memberPage).toHaveURL(new RegExp(`/circles/${s.circleId}/notes$`));
    const phiBeforeRefocus = await memberPage.getByText(s.phi.note).isVisible().catch(() => false);
    test.info().annotations.push({ type: 'phi-before-refocus-on-back', description: String(phiBeforeRefocus) });
    expect(phiBeforeRefocus, 'Back within staleTime must not paint the removed circle\'s PHI').toBe(false);
    await refocus(memberPage);
    await expect(memberPage.getByText(s.phi.note)).toHaveCount(0, { timeout: 20_000 });
    await assertGoneEverywhere(memberPage, s);
    await assertGoneFromPicker(memberPage, s);
    await assertServerRefuses(s);
    expect(navigations, 'the member tab was never reloaded').toEqual([]);
  } finally {
    await ctxM.close();
    await ctxO.close();
  }
});
