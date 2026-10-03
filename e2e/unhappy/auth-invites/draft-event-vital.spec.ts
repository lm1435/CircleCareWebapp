import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { sqlExec } from '../../db';
import { dbCount, failRequest, sqlStr, type FaultHandle } from '../../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from './_helpers';

// X12 / PK9 for the two remaining NEW-record forms: "Add event" (AddEventModal)
// and "Add reading" (VitalFormModal). A FORCED sign-out (the write 401s and the
// refresh fails) saves the open form to sessionStorage; the same user, signing
// back in within 30 minutes, gets it back in the same form with the notice, and
// nothing is written until they press the button themselves.
//
// The care-note composer (session-expiry-mid-write.spec.ts) and the emergency
// editors (draft-circle-scope / draft-entry-identity) already had e2e; these two
// forms were unit-tested only.
//
// FALSIFY: PW_FALSIFY=draft-event-vital makes the refresh SUCCEED (a normal 401
// that is refreshed and retried, no sign-out), so there is no forced sign-out and
// no draft: the run must go red. The app-level proof (the forms' draft hook
// disabled in a scratch copy of the web app) is logged in
// docs/plans/web-e2e-coverage-2026-10-02.md.
//
// Run-scoped account with its own circle; the worker account is never touched.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').includes('draft-event-vital');

const DRAFT_ENTRIES = (page: Page): Promise<string[]> =>
  page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('cc:draft:')));

async function loginViaForm(page: Page, acct: ScopedAccount): Promise<void> {
  await page.locator('#login-email').fill(acct.email);
  await page.locator('#login-password').fill(acct.password);
  // The login page may already speak the account's language (es) after a forced sign-out.
  await page.getByRole('button', { name: /^(Sign in|Iniciar sesión)$/ }).click();
  await expect(page).toHaveURL(/\/circles\//, { timeout: 30_000 });
}

/** Kill the session on the next `method path` write: it 401s and every refresh 401s. */
async function killSessionOn(page: Page, method: 'POST' | 'PUT', path: string) {
  const handles: FaultHandle[] = [];
  if (!FALSIFY) {
    handles.push(await failRequest(page, 'POST', '/api/auth/refresh', { status: 401, code: 'UNAUTHORIZED', times: 5 }));
  }
  handles.push(await failRequest(page, method, path, { status: 401, code: 'UNAUTHORIZED', times: 1 }));
  return { dispose: async () => void (await Promise.all(handles.map((h) => h.dispose()))) };
}

async function setup(request: Parameters<typeof ownerApi>[0], lang: 'en' | 'es') {
  const acct = await createScopedAccount(`pk9ev-${lang}`);
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() where id = ${sqlStr(acct.userId)}::uuid;`
  );
  const circleId = await createCircle(await ownerApi(request, acct), uniq(`pk9ev${lang}`));
  return { acct, circleId };
}

test('PK9 Add event: a forced sign-out on Create keeps the appointment draft; after re-login the form is refilled with the notice, nothing written until Create', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { acct, circleId } = await setup(request, 'en');
  const title = `DRAFT-APPT-${uniq('t')}`;
  const where = `Clinic ${uniq('l')}`;
  const eventRows = () =>
    dbCount(`select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid and title = ${sqlStr(title)}`);
  await cookieLogin(context, acct, baseURL);

  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  // A fresh circle's empty week shows "No events this week", not the grid.
  await expect(page.getByRole('button', { name: 'Add event' }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add event' }).first().click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#event_type').selectOption('appointment');
  await dialog.locator('#title').fill(title);
  await dialog.locator('#location').fill(where);

  const faults = await killSessionOn(page, 'POST', '/api/circles/:id/events');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await faults.dispose();
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);
  // sessionStorage only, never localStorage.
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(title);
  expect(eventRows()).toBe(0);

  await loginViaForm(page, acct);
  if (!new URL(page.url()).pathname.endsWith(`/circles/${circleId}/calendar`)) {
    await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  }
  // A fresh circle's empty week shows "No events this week", not the grid.
  await expect(page.getByRole('button', { name: 'Add event' }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add event' }).first().click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#event_type')).toHaveValue('appointment', { timeout: 5_000 });
  await expect(dialog.locator('#title')).toHaveValue(title);
  await expect(dialog.locator('#location')).toHaveValue(where);
  await expect(page.getByText('We restored your unsaved draft.')).toBeVisible();
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  // The restore itself writes nothing...
  expect(eventRows()).toBe(0);
  // ...and the restored draft saves exactly once when the user presses Create.
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect.poll(eventRows, { timeout: 15_000 }).toBe(1);
});

test('PK9 Add reading (Spanish): a forced sign-out on Save keeps the reading; after re-login the form is refilled with "Recuperamos tu borrador sin guardar."', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { acct, circleId } = await setup(request, 'es');
  const note = `BORRADOR-${uniq('v')}`;
  const vitalRows = () =>
    dbCount(`select 1 from health_vitals where circle_id = ${sqlStr(circleId)}::uuid and notes = ${sqlStr(note)}`);
  await cookieLogin(context, acct, baseURL);

  await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  const add = page.getByRole('button', { name: 'Agregar lectura' }).first();
  await expect(add).toBeVisible({ timeout: 20_000 });
  await add.click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#vital_type').selectOption('heart_rate');
  await dialog.locator('#value1').fill('77');
  await dialog.locator('#notes').fill(note);

  const faults = await killSessionOn(page, 'POST', '/api/circles/:id/vitals');
  await dialog.getByRole('button', { name: 'Guardar lectura', exact: true }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  await faults.dispose();
  expect(await DRAFT_ENTRIES(page)).toHaveLength(1);
  expect(vitalRows()).toBe(0);

  await loginViaForm(page, acct);
  if (!new URL(page.url()).pathname.endsWith(`/circles/${circleId}/vitals`)) {
    await page.goto(`/circles/${circleId}/vitals`, { waitUntil: 'domcontentloaded' });
  }
  const addAgain = page.getByRole('button', { name: 'Agregar lectura' }).first();
  await expect(addAgain).toBeVisible({ timeout: 20_000 });
  await addAgain.click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#vital_type')).toHaveValue('heart_rate', { timeout: 5_000 });
  await expect(dialog.locator('#value1')).toHaveValue('77');
  await expect(dialog.locator('#notes')).toHaveValue(note);
  await expect(page.getByText('Recuperamos tu borrador sin guardar.')).toBeVisible();
  expect(await DRAFT_ENTRIES(page)).toHaveLength(0);
  expect(vitalRows()).toBe(0);
});
