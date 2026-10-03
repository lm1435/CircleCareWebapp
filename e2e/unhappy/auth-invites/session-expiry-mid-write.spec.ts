import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { countRequests, dbCount, failRequest, sqlStr } from '../../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from './_helpers';

// K12 (web test gaps 2026-09-29). The session dies while a write is open.
//
// Test 1: the token expires at the moment of Post (401 on the write, then the
// refresh itself fails): the app must sign out to /login, write NOTHING, and
// must not replay the note after re-login. The typed draft is restored (PK9) to
// the same user only, within 30 minutes, from sessionStorage.
// Test 2: signing out in one tab signs out a second tab in the same browser
// context (BroadcastChannel) without a reload, and the second tab sends no write.
//
// Run-scoped account with its own circle; the worker account is never touched.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const NOTES = '/api/circles/:id/care-notes';

async function setup(
  request: APIRequestContext,
  context: BrowserContext,
  baseURL: string | undefined
): Promise<{ acct: ScopedAccount; circleId: string }> {
  const acct = await createScopedAccount('expiry');
  const circleId = await createCircle(await ownerApi(request, acct), uniq('expiry'));
  await cookieLogin(context, acct, baseURL);
  return { acct, circleId };
}

const noteRows = (circleId: string, body: string): number =>
  dbCount(
    `select 1 from care_notes where circle_id = ${sqlStr(circleId)}::uuid and body = ${sqlStr(body)}`
  );

/** Type a draft, kill the session, press Post; resolve once the app is on /login. */
async function postWithDeadSession(
  page: Page,
  circleId: string,
  draft: string,
  opts: { killRefresh: boolean }
): Promise<{ dispose: () => Promise<void> }> {
  await page.goto(`/circles/${circleId}/notes`);
  const composer = page.getByLabel(/^Add a note/);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await composer.fill(draft);
  const handles: { dispose: () => Promise<void> }[] = [];
  if (opts.killRefresh) {
    handles.push(await failRequest(page, 'POST', '/api/auth/refresh', {
      status: 401,
      code: 'UNAUTHORIZED',
      times: 5,
    }));
  }
  handles.push(await failRequest(page, 'POST', NOTES, { status: 401, code: 'UNAUTHORIZED', times: 1 }));
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  // The caller lifts the faults once signed out, so the re-login / next boot
  // sees a healthy refresh endpoint.
  return { dispose: async () => void (await Promise.all(handles.map((h) => h.dispose()))) };
}

test('session dies on Post: signed out to /login, nothing written, no replay after re-login', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { acct, circleId } = await setup(request, context, baseURL);
  const draft = `DRAFT-${uniq('d')}`;
  const posts = countRequests(page, 'POST', NOTES);

  const faults = await postWithDeadSession(page, circleId, draft, { killRefresh: true });

  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  await faults.dispose();
  // Forced sign-out says nothing about the failed save (lib/forcedSignOut): no
  // "couldn't save" toast over /login. Give a late onError time to (wrongly) fire.
  await page.waitForTimeout(1_500);
  await expect(page.locator('[data-toast]')).toHaveCount(0);
  // Pinned (observed): the redirect carries the page the user was on in the
  // router state (`from`), not in the URL.
  const loginState = await page.evaluate(() => JSON.stringify(window.history.state ?? {}));
  expect(new URL(page.url()).search).toBe('');
  expect(loginState).toContain(`/circles/${circleId}/notes`);
  expect(noteRows(circleId, draft)).toBe(0);

  // Re-login through the form: the note must not be replayed.
  const before = posts.count;
  await page.locator('#login-email').fill(acct.email);
  await page.locator('#login-password').fill(acct.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/circles\//, { timeout: 30_000 });
  await page.waitForTimeout(3_000);
  expect(posts.count).toBe(before);
  expect(noteRows(circleId, draft)).toBe(0);
});

const DRAFT_ENTRIES = (page: Page): Promise<string[]> =>
  page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('cc:draft:')));

async function loginViaForm(page: Page, acct: ScopedAccount): Promise<void> {
  await page.locator('#login-email').fill(acct.email);
  await page.locator('#login-password').fill(acct.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/circles\//, { timeout: 30_000 });
}

/** Login returns to the page the user was on (`from`); open it only if it did not. */
async function openNotes(page: Page, circleId: string): Promise<void> {
  if (!new URL(page.url()).pathname.endsWith(`/circles/${circleId}/notes`)) {
    await page.goto(`/circles/${circleId}/notes`);
  }
}

async function forcedSignOutWithDraft(
  page: Page,
  circleId: string,
  draft: string
): Promise<void> {
  const faults = await postWithDeadSession(page, circleId, draft, { killRefresh: true });
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  await faults.dispose();
}

// PK9 (B12): a forced sign-out saves the open form's draft to sessionStorage
// only; the same user gets it back (with the notice) after re-login.
test('PK9: the typed draft is restored after re-login, with the notice, then deleted', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { acct, circleId } = await setup(request, context, baseURL);
  const draft = `DRAFT-${uniq('p3')}`;

  await forcedSignOutWithDraft(page, circleId, draft);
  // Never localStorage; sessionStorage holds it, keyed by a hash.
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(draft);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);
  await loginViaForm(page, acct);
  await openNotes(page, circleId);

  const composer = page.getByLabel(/^Add a note/);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveValue(draft, { timeout: 5_000 });
  await expect(page.getByText('We restored your unsaved draft.')).toBeVisible();
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(draft);
  // Nothing was posted by the restore itself.
  expect(noteRows(circleId, draft)).toBe(0);
});

test('PK9 privacy: a DIFFERENT user signing in gets no restore and the entry is gone', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { circleId } = await setup(request, context, baseURL);
  const other = await createScopedAccount('expiry-other');
  const draft = `DRAFT-${uniq('other')}`;

  await forcedSignOutWithDraft(page, circleId, draft);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);

  await loginViaForm(page, other);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  // Not even visible anywhere for the new user.
  await expect(page.getByText(draft)).toHaveCount(0);
});

test('PK9 privacy: an EXPIRED (>30 min) draft is purged, not restored', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { acct, circleId } = await setup(request, context, baseURL);
  const draft = `DRAFT-${uniq('ttl')}`;

  await forcedSignOutWithDraft(page, circleId, draft);
  await page.evaluate(() => {
    for (const k of Object.keys(sessionStorage).filter((x) => x.startsWith('cc:draft:'))) {
      const v = JSON.parse(sessionStorage.getItem(k) as string);
      v.savedAt -= 31 * 60 * 1000;
      sessionStorage.setItem(k, JSON.stringify(v));
    }
  });
  await loginViaForm(page, acct);
  await openNotes(page, circleId);

  const composer = page.getByLabel(/^Add a note/);
  await expect(composer).toBeVisible({ timeout: 20_000 });
  await expect(composer).toHaveValue('');
  await expect(page.getByText('We restored your unsaved draft.')).toHaveCount(0);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
});

test('PK9 privacy: a VOLUNTARY sign-out purges any saved draft; re-login restores nothing', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { acct, circleId } = await setup(request, context, baseURL);
  const draft = `DRAFT-${uniq('vol')}`;

  // A forced sign-out leaves an entry; keep a copy, let the re-login consume it.
  await forcedSignOutWithDraft(page, circleId, draft);
  const saved = await page.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith('cc:draft:'))
      .map((k) => [k, sessionStorage.getItem(k)] as [string, string])
  );
  expect(saved).toHaveLength(1);
  await loginViaForm(page, acct);
  await openNotes(page, circleId);
  await expect(page.getByLabel(/^Add a note/)).toHaveValue(draft, { timeout: 5_000 });

  // Put the entry back (as if the form had not consumed it), then sign out on purpose.
  await page.evaluate((entries) => {
    for (const [k, v] of entries) sessionStorage.setItem(k, v);
  }, saved);
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);

  // A voluntary sign-out with a live draft in the composer saves nothing.
  await loginViaForm(page, acct);
  await openNotes(page, circleId);
  const composer = page.getByLabel(/^Add a note/);
  await expect(composer).toHaveValue('');
  await composer.fill(draft);
  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  await loginViaForm(page, acct);
  await openNotes(page, circleId);
  await expect(page.getByLabel(/^Add a note/)).toHaveValue('');
  await expect(page.getByText('We restored your unsaved draft.')).toHaveCount(0);
});

test('falsifier: with a working refresh the same 401 is retried and the note IS written', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { circleId } = await setup(request, context, baseURL);
  const draft = `DRAFT-${uniq('ok')}`;

  await postWithDeadSession(page, circleId, draft, { killRefresh: false });

  await expect
    .poll(() => noteRows(circleId, draft), { timeout: 15_000 })
    .toBe(1);
  await expect(page).not.toHaveURL(/\/login/);
});

test('sign out in one tab signs out the other tab (BroadcastChannel) and it writes nothing', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { circleId } = await setup(request, context, baseURL);
  await page.goto(`/circles/${circleId}/notes`);
  await expect(page.getByLabel(/^Add a note/)).toBeVisible({ timeout: 20_000 });

  const page2 = await context.newPage();
  const posts2 = countRequests(page2, 'POST', NOTES);
  await page2.goto(`/circles/${circleId}/notes`);
  await expect(page2.getByLabel(/^Add a note/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Account' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

  // No reload of page2: the broadcast alone must move it.
  await expect(page2).toHaveURL(/\/login/, { timeout: 10_000 });
  expect(posts2.count).toBe(0);
});
