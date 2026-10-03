import type { APIRequestContext, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';

// ===========================================================================
// PK5 (approved-recs-2026-09-30, batch B10): Emergency Info concurrent edits,
// two REAL caregivers in two browser contexts against the real backend.
//
//   * Same section: A and B both open Medical info; B saves first; A's save is
//     refused (409 EMERGENCY_INFO_CHANGED). A sees "Someone else updated this",
//     A's modal STAYS OPEN showing B's version (A's stale draft is gone, not
//     re-submitted), the server still holds B's data only, and after A makes the
//     change again it saves and both edits are on the server.
//   * Different sections: A edits a contact while B edits Medical info; both save
//     (no false conflict) and both edits are on the server.
//
// FALSIFY: PW_FALSIFY=emergency-concurrent drops `if_match` from the PUT in A's
// browser (route.continue with the field stripped) = the old last-write-wins:
// the "A is refused" check must go red.
// ===========================================================================

const FALSIFY = new Set((process.env.PW_FALSIFY ?? '').split(',').filter(Boolean));

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

type Json = Record<string, unknown>;

interface World {
  owner: ScopedAccount;
  member: ScopedAccount;
  circleId: string;
  ownerSession: Awaited<ReturnType<typeof ownerApi>>;
}

async function world(request: APIRequestContext): Promise<World> {
  const owner = await createScopedAccount('pk5-owner');
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq('pk5'));
  const member = await createScopedAccount('pk5-member');
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId);
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  expect(membershipCount(circleId, member.userId)).toBe(1);
  // The row must exist (a first-ever create has no versions to guard).
  const seed = await ownerSession.put(`/api/circles/${circleId}/emergency-info`, {
    blood_type: 'O+',
    allergies: ['Seeded'],
    emergency_contacts: [{ name: 'Ana Seed', relationship: 'Daughter', phone: '(303) 555-0101', country_code: '+1' }],
  });
  expect(seed.ok(), await seed.text()).toBe(true);
  return { owner, member, circleId, ownerSession };
}

async function loggedInPage(
  browser: Browser,
  account: ScopedAccount,
  baseURL: string | undefined,
  circleId: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL });
  await cookieLogin(context, account, baseURL);
  const page = await context.newPage();
  await page.goto(`/circles/${circleId}/emergency`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Emergency Info' })).toBeVisible({ timeout: 20_000 });
  return { context, page };
}

async function serverInfo(api: World['ownerSession'], circleId: string): Promise<Json> {
  const res = await api.get(`/api/circles/${circleId}/emergency-info`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { data: { emergency_info: Json } }).data.emergency_info;
}

const PUT_RE = (circleId: string) => (r: { request(): { method(): string }; url(): string }) =>
  r.request().method() === 'PUT' && new URL(r.url()).pathname === `/api/circles/${circleId}/emergency-info`;

async function openMedical(page: Page) {
  await page.getByRole('button', { name: 'Edit medical information' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  return dialog;
}

async function addAllergy(dialog: ReturnType<Page['getByRole']>, value: string) {
  const input = dialog.locator('#allergies-input');
  await input.fill(value);
  await input.press('Enter');
  await expect(dialog.getByRole('button', { name: `Remove ${value}` })).toBeVisible();
}

test('same section: the second caregiver is refused, sees the latest, and re-does the change', async ({
  browser,
  request,
  baseURL,
}) => {
  const w = await world(request);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  const B = await loggedInPage(browser, w.member, baseURL, w.circleId);
  try {
    if (FALSIFY.has('emergency-concurrent')) {
      await A.page.route(`**/api/circles/${w.circleId}/emergency-info`, async (route) => {
        const req = route.request();
        if (req.method() !== 'PUT') return route.continue();
        const body = JSON.parse(req.postData() ?? '{}') as Json;
        delete body.if_match;
        return route.continue({ postData: JSON.stringify(body) });
      });
    }

    // Both open the editor on the SAME loaded state.
    const dialogA = await openMedical(A.page);
    const dialogB = await openMedical(B.page);

    // B adds an allergy and saves first.
    await addAllergy(dialogB, 'FromB');
    const savedB = B.page.waitForResponse(PUT_RE(w.circleId));
    await dialogB.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await savedB).status()).toBe(200);
    await expect(dialogB).toBeHidden({ timeout: 20_000 });

    // A (stale) adds a different one and saves: refused.
    await addAllergy(dialogA, 'FromA');
    const refusedA = A.page.waitForResponse(PUT_RE(w.circleId));
    await dialogA.getByRole('button', { name: 'Save', exact: true }).click();
    const res = await refusedA;
    expect(res.status(), 'the stale save is refused').toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('EMERGENCY_INFO_CHANGED');

    // Message shown, modal stays open with the SERVER's version (B's allergy in,
    // A's stale draft out), nothing of A's written.
    await expect(A.page.getByText(/Someone else updated this/)).toBeVisible({ timeout: 15_000 });
    await expect(dialogA).toBeVisible();
    await expect(dialogA.getByRole('button', { name: 'Remove FromB' })).toBeVisible({ timeout: 15_000 });
    await expect(dialogA.getByRole('button', { name: 'Remove FromA' })).toHaveCount(0);
    expect((await serverInfo(w.ownerSession, w.circleId)).allergies).toEqual(['Seeded', 'FromB']);

    // A makes the change again: it saves, and BOTH edits are on the server.
    await addAllergy(dialogA, 'FromA');
    const savedA = A.page.waitForResponse(PUT_RE(w.circleId));
    await dialogA.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await savedA).status()).toBe(200);
    await expect(dialogA).toBeHidden({ timeout: 20_000 });
    expect((await serverInfo(w.ownerSession, w.circleId)).allergies).toEqual(['Seeded', 'FromB', 'FromA']);
  } finally {
    await A.context.close();
    await B.context.close();
  }
});

test('different sections: both caregivers save, no false conflict', async ({ browser, request, baseURL }) => {
  const w = await world(request);
  const A = await loggedInPage(browser, w.owner, baseURL, w.circleId);
  const B = await loggedInPage(browser, w.member, baseURL, w.circleId);
  try {
    // A opens the contact editor first, B then edits Medical info and saves.
    await A.page.getByRole('button', { name: 'Actions for Ana Seed', exact: true }).click();
    await A.page.getByRole('menuitem', { name: 'Edit contact Ana Seed', exact: true }).click();
    const dialogA = A.page.getByRole('dialog');
    await expect(dialogA).toBeVisible({ timeout: 20_000 });

    const dialogB = await openMedical(B.page);
    await addAllergy(dialogB, 'FromB');
    const savedB = B.page.waitForResponse(PUT_RE(w.circleId));
    await dialogB.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await savedB).status()).toBe(200);
    await expect(dialogB).toBeHidden({ timeout: 20_000 });

    // A's contact edit is a different section: accepted.
    await dialogA.locator('#contact-name').fill('Ana Renamed');
    const savedA = A.page.waitForResponse(PUT_RE(w.circleId));
    await dialogA.getByRole('button', { name: 'Save', exact: true }).click();
    expect((await savedA).status(), 'a save to a different section is not a conflict').toBe(200);
    await expect(dialogA).toBeHidden({ timeout: 20_000 });
    await expect(A.page.getByText(/Someone else updated this/)).toHaveCount(0);

    const info = await serverInfo(w.ownerSession, w.circleId);
    expect(info.allergies).toEqual(['Seeded', 'FromB']);
    expect((info.emergency_contacts as Json[]).map((c) => c.name)).toEqual(['Ana Renamed']);
  } finally {
    await A.context.close();
    await B.context.close();
  }
});
