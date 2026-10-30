import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { dbQuery, sqlStr } from '../unhappy';
import { createAccount, runScopedEmail, ACCOUNT_PASSWORD } from '../isolation';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  ownerApi,
  stubJson,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// KEYBOARD + SCREEN-READER CONTRACT for the NEW 1.3.1 web surfaces (WCAG 2.2 AA:
// 2.1.1 keyboard, 2.1.2 no trap, 2.4.3 focus order, 2.4.7 focus visible, 4.1.2 name,
// 4.1.3 status messages). axe already scans these pages (a11y-wcag22, simple-ui-a11y,
// notifications-inbox, onboarding-invitee-welcome); axe cannot press keys, so this spec
// does: Tab / Shift+Tab / Enter / Space / Escape only, never a mouse click. Setup steps
// that are not under test (logging in, seeding) use the API or `fill`, which types.
//
// What this proves: every control is reachable and operable from the keyboard, in a
// sensible order, with a visible ring; dialogs trap focus and give it back; focus never
// falls to <body> when the focused control disappears; the names a screen reader reads;
// the polite live-region text after Mark it / Mark all read. What it CANNOT prove: that
// VoiceOver / NVDA actually speak those regions, in that order, without double reads.

const GONE_EVENT = '00000000-0000-4000-8000-00000000dead';
const NO_CIRCLE = '00000000-0000-4000-8000-00000000c1c1';

// ── keyboard helpers ──────────────────────────────────────────────────────────

/** Press Tab (or Shift+Tab) until `target` holds focus; fail with the path taken. */
async function tabTo(page: Page, target: Locator, opts: { back?: boolean; max?: number } = {}): Promise<void> {
  const max = opts.max ?? 40;
  const path: string[] = [];
  for (let i = 0; i < max; i += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press(opts.back ? 'Shift+Tab' : 'Tab');
    path.push(await describeFocus(page));
  }
  throw new Error(`never reached the target in ${max} ${opts.back ? 'Shift+Tab' : 'Tab'} presses: ${path.join(' > ')}`);
}

/** A short label for document.activeElement ("BODY" when focus fell to nothing). */
function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'BODY';
    const name = el.getAttribute('aria-label') ?? el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 50) ?? '';
    return `${el.tagName.toLowerCase()}${el.dataset.testid ? `#${el.dataset.testid}` : ''}[${name}]`;
  });
}

/** Focus did not fall to <body> (WCAG 2.4.3: a removed control must hand focus on). */
async function expectFocusNotLost(page: Page): Promise<void> {
  await expect.poll(() => describeFocus(page), { timeout: 5_000 }).not.toBe('BODY');
}

/** The focused element paints a visible ring (2.4.7): a solid outline of at least 2px. */
async function expectVisibleRing(page: Page): Promise<void> {
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement as Element);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), color: s.outlineColor };
  });
  expect(ring.style, `focus ring ${JSON.stringify(ring)}`).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
}

/** Activate a control the way a keyboard user does: move focus to it, press the key. */
async function press(target: Locator, key: 'Enter' | 'Space' = 'Enter'): Promise<void> {
  await target.focus();
  await target.press(key === 'Space' ? ' ' : 'Enter');
}

async function noHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'no horizontal page scroll (1.4.10 reflow)').toBeLessThanOrEqual(client + 1);
}

// ── inbox stub (same shape as notifications-inbox.spec.ts) ────────────────────

interface StubItem {
  id: string;
  type: string;
  circle_id: string;
  circle_name: string;
  title: string;
  body: string;
  data: Record<string, string>;
  state: null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  target_status: 'ok' | 'removed' | 'ended' | 'no_access';
}

function item(circleId: string, over: Partial<StubItem>): StubItem {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    type: 'note_added',
    circle_id: circleId,
    circle_name: 'Circle',
    title: 'Ana added a note',
    body: 'Slept well',
    data: {},
    state: null,
    read_at: null,
    created_at: now,
    updated_at: now,
    target_status: 'ok',
    ...over,
  };
}

async function stubInbox(page: Page, items: StubItem[]): Promise<void> {
  await page.route(/\/api\/inbox(\/|\?|$)/, async (route) => {
    const req = route.request();
    const unread = () => items.filter((i) => !i.read_at).length;
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as { ids?: string[]; all?: boolean };
      for (const i of items) if (body.all || body.ids?.includes(i.id)) i.read_at = new Date().toISOString();
      return route.fulfill({ json: { success: true, data: { updated: 1 } } });
    }
    if (req.url().includes('/unread-count')) {
      return route.fulfill({ json: { success: true, data: { unread_count: unread() } } });
    }
    return route.fulfill({ json: { success: true, data: { items, unread_count: unread() } } });
  });
}

function inboxRows(circleId: string): StubItem[] {
  // Newest first, all "today", so DOM order == the order asserted below.
  const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();
  return [
    item(circleId, {
      title: 'Open the notes',
      type: 'care_note_added',
      data: { noteDate: '2026-10-28' },
      created_at: at(1),
      updated_at: at(1),
    }),
    item(circleId, {
      title: 'Metformin reminder',
      body: 'It was scheduled',
      type: 'medication_reminder',
      data: { eventId: GONE_EVENT, scheduledDate: '2026-10-28' },
      target_status: 'removed',
      created_at: at(2),
      updated_at: at(2),
    }),
    item(circleId, { title: 'Third row', created_at: at(3), updated_at: at(3) }),
  ];
}

// ── 1. Header bell + /notifications ───────────────────────────────────────────

test.describe('bell and notifications inbox, keyboard only', () => {
  test('bell name carries the count; Enter opens the inbox; Tab order; Space opens a row', async ({
    page,
    circleId,
  }) => {
    await stubInbox(page, inboxRows(circleId));
    await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

    // What a screen reader reads for the bell: the name WITH the unread count; the pill is hidden.
    const bell = page.getByRole('link', { name: 'Notifications, 3 unread', exact: true });
    await expect(bell).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('notification-bell-count')).toHaveAttribute('aria-hidden', 'true');

    await page.locator('body').focus();
    await tabTo(page, bell);
    await expectVisibleRing(page);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    // On its own page the bell says so (aria-current), like any nav link.
    await expect(page.getByRole('link', { name: 'Notifications, 3 unread' })).toHaveAttribute('aria-current', 'page');

    const markAll = page.getByRole('button', { name: 'Mark all read' });
    const rows = page.getByTestId('inbox-row');
    await expect(rows).toHaveCount(3, { timeout: 20_000 });
    // Each unread row's accessible name starts with the sr-only "Unread." (the dot is hidden).
    await expect(rows.nth(0)).toHaveAccessibleName(/^Unread\. Open the notes/);
    await expect(rows.nth(0).getByTestId('inbox-unread-dot')).toHaveAttribute('aria-hidden', 'true');
    // Sections are headed regions a screen reader can jump between.
    await expect(page.getByRole('region', { name: 'Today' })).toBeVisible();

    // Forward order: Mark all read, Back (the bell on a circle page opens THAT circle's inbox, per-circle counts
    // 1.3.1, whose header has a Back link under Mark all read), the three rows, See older, Notification settings.
    await tabTo(page, markAll);
    await expectVisibleRing(page);
    const order = [
      page.getByTestId('inbox-back'),
      rows.nth(0),
      rows.nth(1),
      rows.nth(2),
      // Scoped inbox + 2 or more circles: "All notifications" (back to the account-wide list) follows the rows.
      ...((await page.getByTestId('inbox-all-link').count()) > 0 ? [page.getByTestId('inbox-all-link')] : []),
      page.getByRole('link', { name: 'See older in Activity' }),
      page.getByRole('link', { name: 'Notification settings' }),
    ];
    for (const stop of order) {
      await page.keyboard.press('Tab');
      await expect(stop).toBeFocused();
      await expectVisibleRing(page);
    }
    // And back again with Shift+Tab.
    for (const stop of [...order].reverse().slice(1)) {
      await page.keyboard.press('Shift+Tab');
      await expect(stop).toBeFocused();
    }
    await page.keyboard.press('Shift+Tab');
    await expect(markAll).toBeFocused();

    // Space activates a row (a real <button>): it lands where the push would. (Back first, then the row.)
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('inbox-back')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(rows.nth(0)).toBeFocused();
    await page.keyboard.press(' ');
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/notes\\?date=2026-10-28`));
  });

  test('a gone row: Enter shows the removed state with focus on its heading; OK gives focus back to the row', async ({
    page,
    circleId,
  }) => {
    await stubInbox(page, inboxRows(circleId));
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    const gone = page.getByRole('button', { name: /Metformin reminder/ });
    await expect(gone).toBeVisible({ timeout: 20_000 });
    await page.locator('body').focus();
    await tabTo(page, gone);
    await page.keyboard.press('Enter');

    const removedHeading = page.getByRole('heading', { name: 'This was removed' });
    await expect(removedHeading).toBeFocused();
    await expect(page.getByTestId('inbox-gone-title')).toHaveText('Metformin reminder');
    await page.keyboard.press('Tab');
    const ok = page.getByTestId('inbox-gone').getByRole('button', { name: 'OK' });
    await expect(ok).toBeFocused();
    await expectVisibleRing(page);
    await page.keyboard.press('Enter');

    // Back on the list, on the row the user opened (now read), not on <body>.
    const sameRow = page.getByRole('button', { name: /Metformin reminder/ });
    await expect(sameRow).toBeFocused();
    await expect(sameRow).toHaveAttribute('data-unread', 'false');
  });

  test('Mark all read: announced in a live region, focus stays put, the bell drops its count', async ({
    page,
    circleId,
  }) => {
    await stubInbox(page, inboxRows(circleId));
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    const markAll = page.getByRole('button', { name: 'Mark all read' });
    await expect(page.getByTestId('inbox-row')).toHaveCount(3, { timeout: 20_000 });

    // The live region is in the page BEFORE the change (a region inserted with its text is
    // not reliably spoken), and empty.
    const announcer = page.getByTestId('inbox-announcer');
    await expect(announcer).toHaveAttribute('role', 'status');
    await expect(announcer).toHaveText('');

    await page.locator('body').focus();
    await tabTo(page, markAll);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="inbox-row"][data-unread="true"]')).toHaveCount(0);
    await expect(announcer).toHaveText('All notifications marked as read.');
    // Nothing left to mark: the button says so (aria-disabled) but keeps focus.
    await expect(markAll).toBeFocused();
    await expect(markAll).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('link', { name: 'Notifications', exact: true })).toBeVisible();

    // Enter again does nothing and announces nothing new.
    await page.keyboard.press('Enter');
    await expect(markAll).toBeFocused();

    // See older in Activity, by keyboard.
    await tabTo(page, page.getByRole('link', { name: 'See older in Activity' }));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/activity$`));
  });

  test('320px reflow and dark mode: axe clean, no horizontal scroll', async ({ page, circleId }, testInfo) => {
    await stubInbox(page, inboxRows(circleId));
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('inbox-row')).toHaveCount(3, { timeout: 20_000 });
    await noHorizontalScroll(page);
    await checkA11y(page, '/notifications @320', testInfo, { wcag22: true });
    for (const box of await page.getByTestId('inbox-row').all()) {
      const b = (await box.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(24);
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('dark');
    // Let the 'transition-colors' controls finish fading to their dark colours before axe reads them.
    await page.waitForTimeout(600);
    await checkA11y(page, '/notifications @320 dark', testInfo);
  });
});

// ── 2. Invitee welcome ────────────────────────────────────────────────────────

test.describe('invitee welcome, keyboard only', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('heading takes focus on arrival; the next Tab is Go to Today; Enter opens Today', async ({
    page,
    request,
    context,
    baseURL,
  }, testInfo) => {
    const api = await ownerApi(request, await createScopedAccount('kbw-owner'));
    const circleId = await createCircle(api, uniq('kbw'));
    const invite = await createInvite(api, circleId);
    await cookieLogin(context, await createScopedAccount('kbw-invitee'), baseURL);

    await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
    await press(page.getByRole('button', { name: 'Accept invitation' }));

    const h1 = page.getByRole('heading', { level: 1 });
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/welcome$`), { timeout: 20_000 });
    await expect(h1).toBeFocused();
    await page.setViewportSize({ width: 320, height: 720 });
    await noHorizontalScroll(page);
    await checkA11y(page, 'welcome @320', testInfo, { wcag22: true });

    await page.keyboard.press('Tab');
    const go = page.getByRole('button', { name: 'Go to Today', exact: true });
    await expect(go).toBeFocused();
    await expectVisibleRing(page);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
  });
});

// ── 3-5. First-run wizard, payoff Mark it, Today's Mark it ────────────────────

const wizardDialog = (page: Page) => page.getByRole('dialog', { name: 'Circle created' });

/** /circles -> Create circle (keyboard) -> the wizard over the new circle. */
async function createFirstCircleByKeyboard(page: Page, recipient: string): Promise<string> {
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await press(page.getByRole('button', { name: 'Create circle' }).first());
  const modal = page.getByRole('dialog');
  await modal.locator('#recipient_name').fill(recipient);
  const circleLoaded = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' &&
      /^\/api\/circles\/[0-9a-f-]{36}$/.test(new URL(r.url()).pathname) &&
      r.ok(),
    { timeout: 30_000 }
  );
  await press(modal.getByRole('button', { name: 'Create circle' }));
  await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(wizardDialog(page)).toBeVisible({ timeout: 20_000 });
  await circleLoaded;
  return /\/circles\/([0-9a-f-]{36})/.exec(page.url())![1];
}

/** Name + a PAST time ("Other time" 00:01) in the simple form, all by keyboard. */
async function fillPastTimeMedByKeyboard(page: Page, name: string): Promise<void> {
  const form = page.getByRole('dialog').last();
  await form.getByLabel(/Medication name/i).fill(name);
  await press(form.getByRole('button', { name: 'Other time' }));
  await form.getByLabel(/^Time/).fill('00:01');
  await expect(form.getByTestId('dose-past-time-note')).toBeVisible();
}

/** Every Tab stop the dialog cycles through, starting from the current focus. */
async function tabCycle(page: Page, dialog: Locator, presses: number, back = false): Promise<string[]> {
  const stops: string[] = [];
  for (let i = 0; i < presses; i += 1) {
    await page.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    // The on-screen toast's controls are PART of the topmost dialog's cycle by design
    // (Modal.tsx, WCAG 2.1.1: a toast raised over a dialog must be reachable), so a stop
    // in the toast region counts as inside; anything else on the page does not.
    const where = await dialog.evaluate((d) => {
      const a = document.activeElement;
      if (d.contains(a)) return '';
      return a?.closest('[data-toast-region]') ? 'TOAST:' : 'OUTSIDE:';
    });
    stops.push(`${where}${await describeFocus(page)}`);
  }
  return stops;
}

async function freeAccount(prefix: string) {
  const email = runScopedEmail(uniq(prefix));
  const userId = await createAccount(email, 'free');
  return { email, password: ACCOUNT_PASSWORD, userId };
}

test.describe('first-run wizard, keyboard only', () => {
  test.setTimeout(120_000);

  test('Setup: heading focused on open, Tab is trapped both ways, a hand-off and Escape give focus back', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    const acct = await createScopedAccount('kbwiz');
    await cookieLogin(context, acct, baseURL);
    const recipient = uniq('kbwiz');
    const circleId = await createFirstCircleByKeyboard(page, recipient);
    const wizard = wizardDialog(page);

    // Focus goes to the step's heading (what just happened), not the x.
    const heading = wizard.getByRole('heading', { name: `${recipient}'s circle is ready.` });
    await expect(heading).toBeFocused();
    // The primary is described by its one-line promise.
    await expect(wizard.getByTestId('first-run-primary')).toHaveAccessibleDescription(/About a minute/);

    // Trap: 12 Tabs and 12 Shift+Tabs never leave the dialog, and every control is a stop.
    const forward = await tabCycle(page, wizard, 12);
    expect(forward.filter((s) => s.startsWith('OUTSIDE:') || s === 'BODY'), forward.join(' > ')).toEqual([]);
    for (const name of ['Close setup', `Add ${recipient}'s first med`, 'An appointment', 'Someone to help', 'Emergency info', 'Skip for now']) {
      expect(forward.some((s) => s.includes(name)), `${name} in ${forward.join(' > ')}`).toBe(true);
    }
    const backward = await tabCycle(page, wizard, 12, true);
    expect(backward.filter((s) => s.startsWith('OUTSIDE:') || s === 'BODY'), backward.join(' > ')).toEqual([]);

    await page.setViewportSize({ width: 320, height: 720 });
    await checkA11y(page, 'wizard setup @320', testInfo);
    await page.setViewportSize({ width: 1280, height: 720 });

    // A hand-off: Enter on "An appointment" puts focus in THAT dialog; Escape returns to Setup.
    const appointment = wizard.getByTestId('first-run-start-with-appointment');
    await heading.focus();
    await tabTo(page, appointment);
    await expectVisibleRing(page);
    await page.keyboard.press('Enter');
    const apptDialog = page.getByRole('dialog', { name: /appointment/i }).first();
    await expect(apptDialog).toBeVisible();
    await expect.poll(() => apptDialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(wizard.getByRole('heading', { name: `${recipient}'s circle is ready.` })).toBeFocused();

    // Escape on Setup = skip: the wizard closes and focus lands on Today's heading, not <body>.
    await page.keyboard.press('Escape');
    await expect(wizard).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('overview-hero').getByRole('heading', { level: 1 })).toBeFocused();
    expect(dbQuery(`select 1 from calendar_events where circle_id = ${sqlStr(circleId)}::uuid`)).toHaveLength(0);
  });

  test('payoff: heading focused, Mark it is announced and focus moves on; Continue -> paywall -> Today by keyboard', async ({
    page,
    context,
    baseURL,
  }) => {
    await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
    const a = await freeAccount('kbpay');
    await cookieLogin(context, a, baseURL);
    const circleId = await createFirstCircleByKeyboard(page, uniq('KbPay'));
    const wizard = wizardDialog(page);

    await press(wizard.getByTestId('first-run-primary'));
    const form = page.getByRole('dialog').last();
    await expect(form.getByTestId('first-run-form-heading')).toBeVisible();
    // Focus moved INTO the form dialog (never left behind on the page).
    await expect.poll(() => form.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await fillPastTimeMedByKeyboard(page, 'Lisinopril');
    await press(form.getByRole('button', { name: 'Add medication' }));

    const payoffHeading = wizard.getByRole('heading', { name: /reminder is set\.$/ });
    await expect(payoffHeading).toBeFocused({ timeout: 20_000 });

    const markIt = wizard.getByTestId('mark-it-button');
    await tabTo(page, markIt);
    await expectVisibleRing(page);
    // The polite region exists, empty, before the tap.
    const announcer = wizard.getByTestId('mark-it-announcer');
    await expect(announcer).toHaveAttribute('role', 'status');
    await expect(announcer).toHaveText('');
    await page.keyboard.press('Enter');
    await expect(announcer).toHaveText('Marked as taken.', { timeout: 20_000 });
    // The button is gone; focus moved to the next step (Continue), never to <body>.
    const cont = wizard.getByRole('button', { name: 'Continue', exact: true });
    await expect(cont).toBeFocused();

    await page.keyboard.press('Enter');
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    // The paywall is a page: its "Continue with free plan" is reachable by Tab.
    const free = page.getByRole('button', { name: /Continue with free plan/ });
    await expect(free).toBeVisible({ timeout: 20_000 });
    await tabTo(page, free, { max: 60 });
    await expectVisibleRing(page);
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });
  });

  test('Today: Mark it on the first-med row is announced and focus lands on the Taken row; Not now hands focus on', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
    const a = await freeAccount('kbtoday');
    await cookieLogin(context, a, baseURL);
    const circleId = await createFirstCircleByKeyboard(page, uniq('KbTd'));

    // Skip Setup by keyboard, take the paywall's free exit.
    await press(wizardDialog(page).getByRole('button', { name: 'Skip for now' }));
    await page.waitForURL(/\/upgrade$/, { timeout: 30_000 });
    await press(page.getByRole('button', { name: /Continue with free plan/ }));
    await page.waitForURL(new RegExp(`/circles/${circleId}$`), { timeout: 30_000 });

    const card = page.getByTestId('next-step-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('region', { name: /first med/i })).toBeVisible();
    await page.locator('body').focus();
    await tabTo(page, card.getByRole('button', { name: 'Add medication' }), { max: 60 });
    await page.keyboard.press('Enter');
    const form = page.getByRole('dialog').last();
    await expect.poll(() => form.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await fillPastTimeMedByKeyboard(page, 'Amlodipine');
    await press(form.getByRole('button', { name: 'Add medication' }));
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });

    const row = page.getByTestId('first-med-mark-it');
    await expect(row.getByTestId('mark-it-line')).toContainText('Already given today? Mark it', { timeout: 20_000 });
    const announcer = row.getByTestId('mark-it-announcer');
    await expect(announcer).toHaveText('');
    await page.locator('body').focus();
    await tabTo(page, row.getByTestId('mark-it-button'), { max: 60 });
    await expectVisibleRing(page);
    await page.keyboard.press('Enter');
    await expect(announcer).toHaveText('Taken', { timeout: 20_000 });
    await expect(row.getByTestId('mark-it-line')).toHaveCount(0);
    // Focus moved to the new Taken row (which reads "Today, Amlodipine, Taken by you").
    await expect(row.getByTestId('mark-it-taken-row')).toBeFocused();

    await page.setViewportSize({ width: 320, height: 720 });
    await noHorizontalScroll(page);
    await checkA11y(page, 'today mark it @320', testInfo);
    await page.setViewportSize({ width: 1280, height: 720 });

    // Whatever next step Today offers now, "Not now" must hand focus on, not drop it.
    const nextCard = page.getByTestId('next-step-card');
    if (await nextCard.isVisible().catch(() => false)) {
      await press(nextCard.getByRole('button', { name: 'Not now' }));
      await expectFocusNotLost(page);
    }
  });
});

// ── 6. Email-link landing: the removed state ──────────────────────────────────

test.describe('removed state, keyboard only', () => {
  test('inline: heading focused on arrival, Tab to OK, Enter dismisses and focus moves to the page heading', async ({
    page,
    circleId,
  }) => {
    await page.goto(`/circles/${circleId}/calendar?date=2026-06-12&eventId=${GONE_EVENT}&src=weekly_digest`, {
      waitUntil: 'domcontentloaded',
    });
    const removed = page.getByTestId('removed-state');
    await expect(removed.getByRole('heading', { name: 'This was removed' })).toBeFocused({ timeout: 20_000 });
    await page.keyboard.press('Tab');
    await expect(removed.getByRole('button', { name: 'OK' })).toBeFocused();
    await expectVisibleRing(page);
    await page.keyboard.press('Enter');
    await expect(removed).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeFocused();
  });

  test('no access: the page heading is focused, Tab reaches See your circles, Enter opens the list', async ({
    page,
  }) => {
    await page.goto(`/circles/${NO_CIRCLE}/calendar?src=weekly_digest`, { waitUntil: 'domcontentloaded' });
    const removed = page.getByTestId('removed-state');
    await expect(removed.getByRole('heading', { level: 1, name: 'This was removed' })).toBeFocused({ timeout: 20_000 });
    await page.keyboard.press('Tab');
    await expect(removed.getByRole('link', { name: 'See your circles' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/circles(\?.*)?$/);
  });
});

