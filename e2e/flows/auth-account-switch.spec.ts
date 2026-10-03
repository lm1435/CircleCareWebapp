import { test, expect } from '../fixtures';
import {
  circleTimezone,
  createDailyMedication,
  dateInTz,
  uniqueSuffix,
} from '../notesFirstClassShared';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { apiCreateCareNote } from '../unhappy/writes/_helpers';

// K7 (web test gaps 2026-09-29). Sign out, then sign in as SOMEONE ELSE in the
// same tab: nothing of account A may be rendered, cached in storage, or shown
// again by walking back through history. Run-scoped accounts only.
//
// Pinned (observed): going back into A's circle URLs as B renders B's
// no-access / not-found state, never A's data (see the history walk).

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

async function signOutThroughUi(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
}

async function signInThroughUi(
  page: import('@playwright/test').Page,
  who: { email: string; password: string }
): Promise<void> {
  await page.locator('#login-email').fill(who.email);
  await page.locator('#login-password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Run the whole flow; `second` is who signs in after A signs out. */
async function switchFlow(
  args: {
    page: import('@playwright/test').Page;
    context: import('@playwright/test').BrowserContext;
    request: import('@playwright/test').APIRequestContext;
    baseURL: string | undefined;
  },
  loginAsSameAccount: boolean
): Promise<void> {
  const { page, context, request, baseURL } = args;
  const suffix = uniqueSuffix();

  // --- Account A: a circle with a note, a medication and an allergy ----------
  const a = await createScopedAccount('switcha');
  const aApi = await ownerApi(request, a);
  const aLabel = uniq('switcha');
  const aCircle = await createCircle(aApi, aLabel);
  const aTz = await circleTimezone(aApi, aCircle);
  const noteSecret = `SECRET-A-${suffix}`;
  const medSecret = `SECRETMED-A-${suffix}`;
  const allergySecret = `SECRETALLERGY-A-${suffix}`;
  await apiCreateCareNote(aApi, aCircle, noteSecret);
  await createDailyMedication(aApi, aCircle, medSecret, dateInTz(aTz, -1), { time: '08:00' });
  const put = await aApi.put(`/api/circles/${aCircle}/emergency-info`, {
    allergies: [allergySecret],
  });
  expect(put.status(), await put.text()).toBeLessThan(300);
  const aCircleName = `E2E ${aLabel}`;
  const secrets = [noteSecret, medSecret, allergySecret, aCircleName];

  // --- Account B: one circle of its own ---------------------------------------
  const b = await createScopedAccount('switchb');
  const bApi = await ownerApi(request, b);
  const bCircle = await createCircle(bApi, uniq('switchb'));

  // 1. A is signed in and really sees their data.
  await cookieLogin(context, a, baseURL);
  await page.goto(`/circles/${aCircle}/notes`);
  await expect(page.getByText(noteSecret)).toBeVisible({ timeout: 20_000 });
  await page.goto(`/circles/${aCircle}/meds`);
  await expect(page.getByText(medSecret).first()).toBeVisible({ timeout: 20_000 });
  await page.goto(`/circles/${aCircle}/emergency`);
  await expect(page.getByText(allergySecret).first()).toBeVisible({ timeout: 20_000 });

  // 2. Sign out, then sign in as B (or, for the falsification, as A again) in the same tab.
  await signOutThroughUi(page);
  await signInThroughUi(page, loginAsSameAccount ? a : b);

  // 3. Land in the account's only circle.
  const landing = loginAsSameAccount ? aCircle : bCircle;
  await expect(page).toHaveURL(new RegExp(`/circles/${landing}`), { timeout: 30_000 });

  const assertClean = async (where: string): Promise<void> => {
    const html = await page.content();
    for (const s of secrets) {
      expect(html.includes(s), `${where}: page must not contain "${s}"`).toBe(false);
    }
  };

  // 4. B's own pages never show A's data.
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await assertClean('B overview');
  await page.goto(`/circles/${bCircle}/notes`);
  await expect(page.getByRole('heading', { name: 'No notes yet' })).toBeVisible({
    timeout: 20_000,
  });
  await assertClean('B notes');
  await page.goto(`/circles/${bCircle}/meds`);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 });
  await assertClean('B meds');

  // 5. Walking back through history never resurrects A's data. Whatever A's
  //    circle URLs show to B (no-access / not-found), it is not A's content.
  for (let i = 1; i <= 4; i++) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    await page.waitForTimeout(1_500);
    await assertClean(`history step ${i} (${page.url()})`);
  }

  // 5b. B opening A's circle URL directly: pin what B sees.
  await page.goto(`/circles/${aCircle}/notes`);
  // Pinned (observed): the access-lost screen ("Access removed", AppLayout / CircleAccessLost,
  // 2026-09-30; it was a "Couldn't load notes" error state before), not A's data.
  await expect(page.getByRole('heading', { level: 1, name: 'Access removed' })).toBeVisible({
    timeout: 20_000,
  });
  await assertClean('B on A circle notes');

  // 6. Nothing of A survives in browser storage either.
  const storage = await page.evaluate(
    () => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })
  );
  for (const s of [...secrets, aCircle]) {
    expect(storage.includes(s), `web storage must not contain "${s}"`).toBe(false);
  }
}

test('sign out, then sign in as someone else in the same tab leaks nothing of the first account', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await switchFlow({ page, context, request, baseURL }, false);
});
