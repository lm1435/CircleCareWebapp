import { test, expect, uniqueLabel } from '../fixtures';
import { API_ERRORS, dbCount, failRequest, sqlStr } from '../unhappy';
import { gotoCirclePage } from '../unhappy/access/_helpers';

// PK18 — a write refused on a LAPSED (frozen) circle (403 SUBSCRIPTION_REQUIRED from
// requireCircleEditAccess) says what is TRUE: the owner's subscription ended and the
// circle is read-only. Never "That feature isn't included in the free plan" (false), and
// never a paywall for a member. The OWNER gets an Upgrade action to /upgrade.
// The member variant lives in unhappy/access/freeMember.accessRefresh.spec.ts (vitals).
// The refusal is injected (a real one would withdraw the write controls first), the same
// way the access-refresh spec does it. Event create/edit (B9b) is covered at the bottom of this file.
test.use({ persona: 'premiumOwner' });

const OWNER_COPY = 'Your subscription has ended, so this circle is read-only for everyone. Your data is safe.';

test('vitals: a reading refused on a lapsed circle gives the OWNER the lapse copy with an Upgrade action; the draft is kept', async ({
  page,
  personaHandle: h,
}) => {
  const note = uniqueLabel('Lapsed vital');
  await gotoCirclePage(page, h.circleId, 'vitals');
  const add = page.getByRole('button', { name: 'Add reading', exact: true });
  await expect(add).toBeVisible({ timeout: 20_000 });
  await add.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#vital_type').selectOption('heart_rate');
  await dialog.locator('#value1').fill('77');
  await dialog.locator('#notes').fill(note);

  const fault = await failRequest(page, 'POST', '/api/circles/:id/vitals', API_ERRORS.writeSubscriptionRequired);
  await dialog.getByRole('button', { name: 'Save reading' }).click();
  await fault.expectHits(1);

  await expect(page.getByText(OWNER_COPY)).toBeVisible();
  await expect(page.getByText("That feature isn't included in the free plan.", { exact: false })).toHaveCount(0);
  // Draft kept: the form is still open with what was typed.
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#value1')).toHaveValue('77');
  await expect(dialog.locator('#notes')).toHaveValue(note);
  expect(
    dbCount(`select 1 from health_vitals where circle_id = ${sqlStr(h.circleId)}::uuid and notes = ${sqlStr(note)}`),
    'no vital row'
  ).toBe(0);

  await page.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await expect(page).toHaveURL(/\/upgrade/);
});

test('events: an appointment refused on a lapsed circle gives the OWNER the lapse copy with an Upgrade action; the draft is kept', async ({
  page,
  personaHandle: h,
}) => {
  const title = uniqueLabel('Lapsed appointment');
  await gotoCirclePage(page, h.circleId, 'calendar');
  const add = page.getByRole('button', { name: 'Add event' }).first();
  await expect(add).toBeVisible({ timeout: 20_000 });
  await add.click();
  const dialog = page.getByRole('dialog', { name: 'New event' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#event_type').selectOption('appointment');
  await dialog.locator('#title').fill(title);

  const fault = await failRequest(page, 'POST', '/api/circles/:id/events', API_ERRORS.writeSubscriptionRequired);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await fault.expectHits(1);

  await expect(page.getByText(OWNER_COPY)).toBeVisible();
  await expect(page.getByText("That feature isn't included in the free plan.", { exact: false })).toHaveCount(0);
  // Draft kept: the form is still open with what was typed.
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#title')).toHaveValue(title);
  expect(
    dbCount(`select 1 from calendar_events where circle_id = ${sqlStr(h.circleId)}::uuid and title = ${sqlStr(title)}`),
    'no event row'
  ).toBe(0);

  await page.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await expect(page).toHaveURL(/\/upgrade/);
});
