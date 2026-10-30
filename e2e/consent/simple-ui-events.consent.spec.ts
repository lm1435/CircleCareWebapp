import { consentTest as test, expect, presetAnalyticsConsent } from '../consent';
import { sqlExec } from '../db';
import { sqlStr } from '../unhappy';
import { cookieLogin, createCircle, createScopedAccount, ownerApi, uniq } from '../unhappy/auth-invites/_helpers';
import { createDailyMedication, dateInTz, uniqueSuffix } from '../notesFirstClassShared';
import type { CapturedEvent } from '../unhappy';

// THE SIMPLE-UI ANALYTICS CONTRACT (docs/plans/simple-ui-1-3-1.md "Analytics
// contract"): each new event fires with exactly its documented props, through the
// real app, and carries NO circle_id (enums, counts and booleans only). Runs in the
// `consent` project (a Vite with the fake PostHog key; every PostHog request is
// intercepted and decoded, none is sent).
//
// A fresh owner + circle per test so the coaching state is ours alone.

const TZ = 'America/Denver';
test.use({ storageState: { cookies: [], origins: [] }, timezoneId: TZ });
test.describe.configure({ timeout: 120_000 });

async function arrange(
  page: import('@playwright/test').Page,
  context: import('@playwright/test').BrowserContext,
  request: import('@playwright/test').APIRequestContext,
  baseURL: string | undefined,
  label: string,
  opts: { med?: boolean } = {}
) {
  const owner = await createScopedAccount(label);
  sqlExec(`update users set timezone = ${sqlStr(TZ)} where id = ${sqlStr(owner.userId)}::uuid;`);
  const session = await ownerApi(request, owner);
  const recipient = uniq(label);
  const circleId = await createCircle(session, recipient);
  let medName: string | null = null;
  if (opts.med) {
    medName = `ZZ_E2E_EV_${uniqueSuffix()}`;
    await createDailyMedication(session, circleId, medName, dateInTz(TZ, -1), { time: '00:01' });
  }
  await presetAnalyticsConsent(page, 'granted', owner.userId);
  await cookieLogin(context, owner, baseURL);
  return { owner, circleId, recipient, medName };
}

function props(e: CapturedEvent): Record<string, unknown> {
  // Only the event's own props (drop posthog's $-prefixed bookkeeping and the session/identity fields).
  return Object.fromEntries(
    Object.entries(e.properties).filter(
      ([k]) => !k.startsWith('$') && !['distinct_id', 'token', 'time', 'app_env', 'platform', 'theme', 'theme_preference', 'upsell'].includes(k)
    )
  );
}

const newTrigger = (page: import('@playwright/test').Page) =>
  page.locator('aside').getByRole('button', { name: 'New', exact: true });

test('Today: today_viewed (coaching next_step), next_step_shown/tapped/dismissed with their step, no circle_id', async ({
  page,
  context,
  request,
  baseURL,
  posthog,
}) => {
  const a = await arrange(page, context, request, baseURL, 'evtoday');
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });

  const viewed = await posthog.waitForEvent('today_viewed', { timeoutMs: 30_000 });
  expect(props(viewed)).toMatchObject({ has_items: false, next_up_count: 0, coaching: 'next_step' });
  expect(viewed.properties).not.toHaveProperty('circle_id');
  expect(typeof viewed.properties.next_up_count).toBe('number');
  expect(typeof viewed.properties.has_items).toBe('boolean');

  const shown = await posthog.waitForEvent('next_step_shown', { timeoutMs: 20_000 });
  expect(props(shown)).toEqual({ step: 'first_med' });

  // "Not now" -> dismissed (first_med), then the invite step is shown.
  await page.getByTestId('next-step-card').getByRole('button', { name: 'Not now' }).click();
  const dismissed = await posthog.waitForEvent('next_step_dismissed', { timeoutMs: 20_000 });
  expect(props(dismissed)).toEqual({ step: 'first_med' });
  const shownInvite = await posthog.waitForEvent('next_step_shown', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.step === 'invite',
  });
  expect(props(shownInvite)).toEqual({ step: 'invite' });

  await page.getByTestId('next-step-card').getByRole('button', { name: 'Invite' }).click();
  const tapped = await posthog.waitForEvent('next_step_tapped', { timeoutMs: 20_000 });
  expect(props(tapped)).toEqual({ step: 'invite' });

  for (const e of posthog.captures()) {
    if (/^(today_|next_step_|next_up_|add_menu_|entry_form_|time_chip_|coaching_hint_)/.test(e.event)) {
      expect(e.properties, `${e.event} must not carry circle_id`).not.toHaveProperty('circle_id');
    }
  }
});

test('Today: next_up_action (taken / open), today_all_items_opened, quick_access_tapped incl. the new shifts link, large_text_layout inactive', async ({
  page,
  context,
  request,
  baseURL,
  posthog,
}) => {
  const a = await arrange(page, context, request, baseURL, 'evnext', { med: true });
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  // Started yesterday: yesterday's unanswered dose (position 1) and today's (position 2).
  const rowsForMed = page.getByTestId('next-up-row').filter({ hasText: a.medName! });
  await expect(rowsForMed).toHaveCount(2, { timeout: 30_000 });
  const row = rowsForMed.last();

  const viewed = await posthog.waitForEvent('today_viewed', { timeoutMs: 20_000 });
  expect(props(viewed)).toMatchObject({ has_items: true, next_up_count: 2 });
  expect(['next_step', 'dose_hint']).toContain(viewed.properties.coaching);

  const large = await posthog.waitForEvent('large_text_layout', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.screen === 'today',
  });
  expect(props(large)).toEqual({ screen: 'today', active: false });

  // Taken -> next_up_action {taken, medication, position 1}.
  await row.getByRole('button', { name: `Taken, ${a.medName}` }).click();
  const taken = await posthog.waitForEvent('next_up_action', { timeoutMs: 20_000 });
  expect(props(taken)).toEqual({ action: 'taken', item_type: 'medication', position: 2 });

  // Quick access: a tile and the new Shifts link.
  await page.getByTestId('quick-access-grid').getByRole('link', { name: /Tasks/ }).click();
  const tile = await posthog.waitForEvent('quick_access_tapped', { timeoutMs: 20_000 });
  expect(tile.properties.destination).toBe('tasks');
  await page.goBack();
  await page
    .locator('section[aria-labelledby="quick-access-heading"] > ul')
    .getByRole('link', { name: 'Shifts' })
    .click();
  const shifts = await posthog.waitForEvent('quick_access_tapped', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.destination === 'shifts',
  });
  expect(shifts.properties.destination).toBe('shifts');

  // All of today.
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: /^All of today/ }).click();
  await posthog.waitForEvent('today_all_items_opened', { timeoutMs: 20_000 });

  // Opening a row (not its button) is next_up_action 'open'.
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('next-up-row').filter({ hasText: a.medName! }).getByRole('link').first().click();
  const open = await posthog.waitForEvent('next_up_action', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.action === 'open',
  });
  expect(props(open)).toEqual({ action: 'open', item_type: 'medication', position: 1 });
});

test('Add menu + medication form funnel: add_menu_opened, option tapped, entry_form_opened, step completed, time_chip_selected', async ({
  page,
  context,
  request,
  baseURL,
  posthog,
}) => {
  const a = await arrange(page, context, request, baseURL, 'evadd');
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });

  await newTrigger(page).click();
  expect(props(await posthog.waitForEvent('add_menu_opened', { timeoutMs: 20_000 }))).toEqual({ from: 'nav' });
  const lg = await posthog.waitForEvent('large_text_layout', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.screen === 'add_menu',
  });
  expect(props(lg)).toEqual({ screen: 'add_menu', active: false });

  // Closing without a choice.
  await page.keyboard.press('Escape');
  expect(props(await posthog.waitForEvent('add_menu_closed_empty', { timeoutMs: 20_000 }))).toEqual({});

  await newTrigger(page).click();
  await page.getByRole('menuitem', { name: 'Med', exact: true }).click();
  expect(props(await posthog.waitForEvent('add_menu_option_tapped', { timeoutMs: 20_000 }))).toEqual({
    option: 'medication',
  });
  const opened = await posthog.waitForEvent('entry_form_opened', { timeoutMs: 20_000 });
  expect(props(opened)).toEqual({ type: 'medication', entry: 'add_menu' });

  const dialog = page.getByRole('dialog', { name: 'New medication' });
  await dialog.locator('#medication_name').fill('ZZ_E2E_FUNNEL');
  await dialog.locator('#medication_dosage').click(); // blur the name field
  const what = await posthog.waitForEvent('entry_form_step_completed', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.step === 'what',
  });
  expect(props(what)).toEqual({ type: 'medication', step: 'what' });

  await dialog.getByRole('radio', { name: /Evening/ }).click();
  expect(props(await posthog.waitForEvent('time_chip_selected', { timeoutMs: 20_000 }))).toEqual({
    chip: 'evening',
  });
  const when = await posthog.waitForEvent('entry_form_step_completed', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.step === 'when',
  });
  expect(props(when)).toEqual({ type: 'medication', step: 'when' });

  await dialog.getByRole('radio', { name: 'Some days' }).click();
  const oft = await posthog.waitForEvent('entry_form_step_completed', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.step === 'how_often',
  });
  expect(props(oft)).toEqual({ type: 'medication', step: 'how_often' });

  await dialog.getByRole('button', { name: 'Other time' }).click();
  await posthog.waitForEvent('time_chip_selected', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.chip === 'other',
  });
  const lgForm = await posthog.waitForEvent('large_text_layout', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.screen === 'med_form',
  });
  expect(props(lgForm)).toEqual({ screen: 'med_form', active: false });

  // Abandon it: the existing medication_form_abandoned fires with the origin.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const abandoned = await posthog.waitForEvent('medication_form_abandoned', { timeoutMs: 20_000 });
  expect(abandoned.properties.entry_source).toBe('add_menu');
  expect(abandoned.properties).not.toHaveProperty('circle_id');
});

test('Appointment form: entry_form_opened + the who/what/when steps + appointment_form_abandoned', async ({
  page,
  context,
  request,
  baseURL,
  posthog,
}) => {
  const a = await arrange(page, context, request, baseURL, 'evappt');
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  await newTrigger(page).click();
  await page.getByRole('menuitem', { name: 'Appt', exact: true }).click();
  expect(props(await posthog.waitForEvent('add_menu_option_tapped', { timeoutMs: 20_000 }))).toEqual({
    option: 'appointment',
  });
  expect(props(await posthog.waitForEvent('entry_form_opened', { timeoutMs: 20_000 }))).toEqual({
    type: 'appointment',
    entry: 'add_menu',
  });
  const dialog = page.getByRole('dialog', { name: 'New appointment' });
  await dialog.locator('#title').fill('ZZ_E2E_FUNNEL_APPT');
  await dialog.locator('#scheduled_time').click(); // blur title
  await posthog.waitForEvent('entry_form_step_completed', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.type === 'appointment' && e.properties.step === 'what',
  });
  // "Anyone" is pre-selected (re-clicking it is no change); choose a member.
  await dialog.getByRole('radiogroup', { name: "Who's going?" }).getByRole('radio').nth(1).click();
  await posthog.waitForEvent('entry_form_step_completed', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.type === 'appointment' && e.properties.step === 'who',
  });
  const lgForm = await posthog.waitForEvent('large_text_layout', {
    timeoutMs: 20_000,
    predicate: (e) => e.properties.screen === 'appt_form',
  });
  expect(props(lgForm)).toEqual({ screen: 'appt_form', active: false });

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const abandoned = await posthog.waitForEvent('appointment_form_abandoned', { timeoutMs: 20_000 });
  expect(abandoned.properties.entry_source).toBe('add_menu');
  expect(typeof abandoned.properties.last_field).toBe('string');
  expect(abandoned.properties).not.toHaveProperty('circle_id');
});

test('first-dose hint: coaching_hint_shown then dismissed ("Got it") and acted (Taken)', async ({
  page,
  context,
  request,
  baseURL,
  posthog,
}) => {
  const a = await arrange(page, context, request, baseURL, 'evhint', { med: true });
  await page.goto(`/circles/${a.circleId}`, { waitUntil: 'domcontentloaded' });
  // The invite step sits above the hint: snooze it so the hint can show.
  const card = page.getByTestId('next-step-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByTestId('dose-hint')).toBeVisible();
  expect(props(await posthog.waitForEvent('coaching_hint_shown', { timeoutMs: 20_000 }))).toEqual({
    hint: 'first_dose',
  });
  await page.getByTestId('dose-hint').getByRole('button', { name: 'Got it' }).click();
  expect(props(await posthog.waitForEvent('coaching_hint_dismissed', { timeoutMs: 20_000 }))).toEqual({
    hint: 'first_dose',
  });
});
