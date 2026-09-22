import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { Page, Request, TestInfo } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { sqlExec, sqlStr } from '../db';

// "Why did you turn off renewal?" — the web CancelReasonPrompt
// (src/components/subscription/CancelReasonPrompt.tsx; spec
// docs/plans/cancel-reason-prompt.md, "Web companion").
//
// OPTION B (2026-09-21): eligibility now comes ENTIRELY from `GET
// /subscription-status`'s `cancelPrompt` field — a cache on `public.users`
// written only by the RevenueCat webhook (backend/src/routes/webhooks.ts,
// the CANCELLATION/UNCANCELLATION/RENEWAL/INITIAL_PURCHASE cases) via
// migration 20260921120000_users_renewal_off_cache.sql. purchases-js is GONE
// from this whole feature: no SDK chunk, no RevenueCat request, for anyone,
// on this route. This suite therefore drives state through the REAL local
// backend + REAL local Postgres (`sqlExec`/`sqlStr`, e2e/db.ts — the same
// local-only-guarded helper the isolation layer itself uses) rather than
// stubbing RevenueCat in the browser: a direct `UPDATE users SET
// renewal_off_at = …` sets up each scenario, and the running app + backend
// answer `GET /subscription-status` for real.
//
// WHAT IS STILL PROVEN NEGATIVELY: zero requests ever reach
// api.revenuecat.com or e.revenue.cat, and the purchases-js dev chunk
// (`@revenuecat_purchases-js`, Vite's pre-bundled dep name — see
// node_modules/.vite/deps/) is never requested on the /circles route. Both
// hosts are also explicitly BLOCKED (route.abort), so a regression that
// reintroduces an RC call fails loudly instead of quietly succeeding against
// whatever happens to be reachable.
//
// NO REAL EMAIL. `POST /api/feedback` is ALWAYS fulfilled here (200, or 500
// for the failure case) — the local backend has a real Resend key and would
// mail support@. The request body is captured and asserted instead.
//
// NO OWNER GATE ANY MORE (component-side change, see CancelReasonPrompt.tsx):
// `cancelPrompt` is the signed-in user's OWN row, independent of which
// circles they own, so this suite does not need to arrange circle ownership
// for the prompt to apply — the default persona (premiumOwner) is used only
// because it is the suite's ordinary authenticated account.
//
// ISOLATION: each worker owns one real account (e2e/isolation.ts); tests in
// this file share it across a run, so `test.beforeEach` resets the three
// `renewal_off_*` columns to NULL before every test and each test then writes
// exactly the state its scenario needs. FRESH BROWSER STATE PER TEST:
// Playwright gives every test a new context, so the show-once localStorage
// key never carries over — asserted at the start of each test rather than
// assumed. The module-scope "evaluated this page load" flag resets on every
// `page.reload()`.

const SCREENS_DIR =
  '/private/tmp/claude-501/-Users-meza-Desktop-projects-CircleCare/220bd14f-0758-4d31-a0eb-ce5278b8c1c4/scratchpad/screens';

const DAY_MS = 86_400_000;
const KEY_PREFIX = 'circlecare_install:cancel_ask:';
const PRESENT_DELAY_MS = 2000;
/** Vite's pre-bundled dep chunk name for the SDK (node_modules/.vite/deps/). */
const PURCHASES_CHUNK_PATTERN = /@revenuecat_purchases-js/;
const REVENUECAT_HOST_PATTERN = /^https:\/\/(api\.revenuecat\.com|e\.revenue\.cat)\//;
const SUBSCRIPTION_STATUS_PATTERN = /\/api\/subscription-status(\?.*)?$/;

test.use({ viewport: { width: 1280, height: 800 } });

// ── DB-driven eligibility setup ─────────────────────────────────────────────
// Writes directly to `public.users` via the SAME local-only-guarded psql
// wrapper e2e/isolation.ts uses (e2e/db.ts) — not a new DB connection.

interface RenewalOffState {
  /** Epoch ms `renewal_off_at` — null clears all three columns. */
  renewalOffAtMs: number | null;
  /** Epoch ms `renewal_off_access_ends_at`. */
  accessEndsAtMs?: number | null;
  periodType?: string | null;
}

function writeRenewalOffCache(userId: string, state: RenewalOffState): void {
  const renewalOffAtIso = state.renewalOffAtMs == null ? null : new Date(state.renewalOffAtMs).toISOString();
  const accessEndsAtIso =
    state.renewalOffAtMs == null || state.accessEndsAtMs == null
      ? null
      : new Date(state.accessEndsAtMs).toISOString();
  const periodType = state.renewalOffAtMs == null ? null : (state.periodType ?? 'trial');
  sqlExec(
    `UPDATE users SET
       renewal_off_at = ${sqlStr(renewalOffAtIso)}::timestamptz,
       renewal_off_access_ends_at = ${sqlStr(accessEndsAtIso)}::timestamptz,
       renewal_off_period_type = ${sqlStr(periodType)}
     WHERE id = ${sqlStr(userId)}`
  );
}

function clearRenewalOffCache(userId: string): void {
  writeRenewalOffCache(userId, { renewalOffAtMs: null });
}

test.beforeEach(async ({ account }) => {
  clearRenewalOffCache(account.userId);
});

// ── Network guards ───────────────────────────────────────────────────────────

interface NetworkGuard {
  purchasesChunkHits: () => number;
  revenueCatHits: () => number;
  subscriptionStatusHits: () => number;
}

/**
 * Counts every request matching the patterns above AND (for RevenueCat)
 * aborts them outright, so a regression that reintroduces an RC call fails
 * the test loudly (a rejected fetch inside the app) rather than quietly
 * succeeding against whatever happens to answer that host.
 */
async function watchNetwork(page: Page): Promise<NetworkGuard> {
  let purchasesChunk = 0;
  let revenueCat = 0;
  let subscriptionStatus = 0;
  page.on('request', (request) => {
    const url = request.url();
    if (PURCHASES_CHUNK_PATTERN.test(url)) purchasesChunk += 1;
    if (REVENUECAT_HOST_PATTERN.test(url)) revenueCat += 1;
    if (SUBSCRIPTION_STATUS_PATTERN.test(url) && request.method() === 'GET') subscriptionStatus += 1;
  });
  await page.route(REVENUECAT_HOST_PATTERN, (route) => route.abort('failed'));
  return {
    purchasesChunkHits: () => purchasesChunk,
    revenueCatHits: () => revenueCat,
    subscriptionStatusHits: () => subscriptionStatus,
  };
}

interface FeedbackStub {
  bodies: unknown[];
  setStatus: (status: number) => void;
}

/** ALWAYS installed: no test may reach the real /api/feedback (real Resend key). */
async function stubFeedback(page: Page, initialStatus = 200): Promise<FeedbackStub> {
  const bodies: unknown[] = [];
  let status = initialStatus;
  await page.route('**/api/feedback', async (route) => {
    const request: Request = route.request();
    if (request.method() !== 'POST') {
      await route.fulfill({ status: 405, body: '' });
      return;
    }
    bodies.push(request.postDataJSON());
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(
        status < 300
          ? { success: true }
          : { success: false, error: { code: 'INTERNAL_ERROR', message: 'stubbed failure' } }
      ),
    });
  });
  return { bodies, setStatus: (next) => (status = next) };
}

/** The date string the dialog renders, formatted by the page's own Intl. */
async function renderedDate(page: Page, ms: number, locale: string): Promise<string> {
  return page.evaluate(
    ([value, loc]) =>
      new Date(value).toLocaleDateString(loc, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    [ms, locale] as const
  );
}

async function askKeys(page: Page): Promise<string[]> {
  return page.evaluate((prefix) => Object.keys(window.localStorage).filter((k) => k.startsWith(prefix)), KEY_PREFIX);
}

/**
 * The user part of the show-once key: SHA-256 of `cancel_ask:<userId>`, hex,
 * first 16 chars — computed independently here (node:crypto) so the page's
 * WebCrypto implementation is checked, not just echoed.
 */
function hashedUserPart(userId: string): string {
  return createHash('sha256').update(`cancel_ask:${userId}`).digest('hex').slice(0, 16);
}

/**
 * Pre-existing keys, OUTSIDE this prompt, that still embed the raw user id.
 * `cc:onboardingCompleted:<userId>` is written by the onboarding flow (not this
 * feature); listed here so this check catches any NEW raw-id key — above all a
 * regression of the show-once key — without failing on it. Remove the entry
 * once that key is hashed too.
 */
const KNOWN_RAW_ID_KEY_PREFIXES = ['cc:onboardingCompleted:'];

/** Every localStorage KEY that contains the raw user id — must be none. */
async function storageEntriesContaining(page: Page, needle: string): Promise<string[]> {
  const keys = await page.evaluate(
    (n) => Object.keys(window.localStorage).filter((k) => k.includes(n)),
    needle
  );
  return keys.filter((k) => !KNOWN_RAW_ID_KEY_PREFIXES.some((prefix) => k.startsWith(prefix)));
}

function promptDialog(page: Page, name: RegExp = /Your premium (stays on until|ended on)/) {
  return page.getByRole('dialog', { name });
}

async function shoot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  // One set of review screenshots is enough; repeats would only overwrite.
  if (testInfo.repeatEachIndex !== 0 || testInfo.retry !== 0) return;
  fs.mkdirSync(SCREENS_DIR, { recursive: true });
  // Let the modal's entrance animation settle so the capture is the resting state.
  await page
    .evaluate(() =>
      Promise.race([
        Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {}))
        ),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ])
    )
    .catch(() => {});
  await page.screenshot({ path: `${SCREENS_DIR}/${name}.png` });
}

/** Load the home route and wait for the prompt to appear. Returns ms from navigation start. */
async function openHomeAndAwaitPrompt(page: Page): Promise<number> {
  const started = Date.now();
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  await expect(promptDialog(page)).toBeVisible({ timeout: 20_000 });
  return Date.now() - started;
}

/**
 * Prove a NEGATIVE: the page load really evaluated (GET /subscription-status
 * — the prompt's ONLY input — resolved after `action` ran) and still no
 * dialog appeared.
 */
async function expectEvaluatedButNotShown(page: Page, action: () => Promise<unknown>): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (res) => SUBSCRIPTION_STATUS_PATTERN.test(res.url()) && res.request().method() === 'GET'
    ),
    action(),
  ]);
  // The show happens (if it's going to) shortly after the settle delay;
  // give it ample margin.
  await page.waitForTimeout(PRESENT_DELAY_MS + 1500);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('cancel reason prompt (web)', () => {
  test('eligible owner: dialog appears after the settle delay, reasons + comment field, axe clean', async ({
    page,
    account,
  }, testInfo) => {
    const guard = await watchNetwork(page);
    const now = Date.now();
    const expiresMs = now + 5 * DAY_MS;
    writeRenewalOffCache(account.userId, {
      renewalOffAtMs: now - 2 * DAY_MS,
      accessEndsAtMs: expiresMs,
      periodType: 'trial',
    });
    const feedback = await stubFeedback(page);

    const elapsed = await openHomeAndAwaitPrompt(page);
    expect(elapsed, 'the prompt must wait out the 2 s settle delay').toBeGreaterThanOrEqual(PRESENT_DELAY_MS);
    expect(await askKeys(page), 'fresh context: no show-once key yet').toEqual([]);
    expect(guard.subscriptionStatusHits(), 'exactly one GET /subscription-status for the page load').toBe(1);

    const dialog = promptDialog(page);
    const date = await renderedDate(page, expiresMs, 'en-US');
    await expect(dialog.getByRole('heading', { name: `Your premium stays on until ${date}.` })).toBeVisible();
    await expect(
      dialog.getByRole('radiogroup', { name: 'Mind telling us why you turned off renewal? It helps us improve.' })
    ).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(6);
    for (const label of [
      "I just didn't want to be charged automatically",
      'Too expensive',
      "Something didn't work",
      'Missing a feature I need',
      "I didn't need it",
      'Other',
    ]) {
      await expect(dialog.getByRole('radio', { name: label, exact: true })).not.toBeChecked();
    }
    const send = dialog.getByRole('button', { name: 'Send', exact: true });
    await expect(send).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Not now', exact: true })).toBeEnabled();
    const comment = dialog.getByRole('textbox', { name: 'Add a comment (optional)' });
    await expect(comment).toHaveCount(0);

    await shoot(page, '01-desktop-initial', testInfo);
    await checkA11y(page, 'cancel-reason-dialog', testInfo);

    await dialog.getByRole('radio', { name: 'Too expensive', exact: true }).check();
    await expect(send).toBeEnabled();
    await expect(comment).toBeVisible();
    await expect(comment).toHaveAttribute('placeholder', 'Anything else? (optional)');

    await dialog.getByRole('radio', { name: "Something didn't work", exact: true }).check();
    await expect(comment).toHaveAttribute('placeholder', 'What happened?');
    await comment.fill('The calendar would not load on Tuesday.');
    await shoot(page, '02-desktop-something-broken-comment', testInfo);
    await checkA11y(page, 'cancel-reason-dialog-with-comment', testInfo);

    await dialog.getByRole('radio', { name: 'Missing a feature I need', exact: true }).check();
    await expect(comment).toHaveAttribute('placeholder', 'What were you looking for?');

    // Nothing was sent by merely interacting.
    expect(feedback.bodies).toEqual([]);
    expect(guard.revenueCatHits(), 'requests to api.revenuecat.com / e.revenue.cat').toBe(0);
    expect(guard.purchasesChunkHits(), 'purchases-js chunk requested').toBe(0);
  });

  test('send success: thanks + reassurance, closes, key written, not asked again on reload', async ({
    page,
    account,
  }, testInfo) => {
    const now = Date.now();
    const expiresMs = now + 5 * DAY_MS;
    writeRenewalOffCache(account.userId, { renewalOffAtMs: now - 2 * DAY_MS, accessEndsAtMs: expiresMs });
    const feedback = await stubFeedback(page, 200);
    await openHomeAndAwaitPrompt(page);
    expect(await askKeys(page)).toEqual([]);

    const dialog = promptDialog(page);
    await dialog.getByRole('radio', { name: "I just didn't want to be charged automatically" }).check();
    await dialog.getByRole('textbox', { name: 'Add a comment (optional)' }).fill('  Prefer to pay yearly.  ');
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();

    const date = await renderedDate(page, expiresMs, 'en-US');
    // The title swaps to the thanks line, which renames the dialog.
    const thanks = page.getByRole('dialog', { name: 'Thanks, this really helps.' });
    await expect(thanks).toBeVisible();
    await expect(thanks.getByText(`Got it. You keep full access until ${date}.`)).toBeVisible();
    await expect(thanks.getByText(/Your premium stays on/), 'date must not be said twice').toHaveCount(0);
    await shoot(page, '04-desktop-thanks', testInfo);

    expect(feedback.bodies).toEqual([
      { type: 'cancellation', reason: 'auto_charge', description: 'Prefer to pay yearly.', isSandbox: false },
    ]);
    // Auto-closes after the thanks beat (THANKS_DURATION_MS = 1.5 s).
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 5_000 });
    const keys = await askKeys(page);
    expect(keys).toHaveLength(1);
    // Hashed user part, never the raw id.
    expect(keys[0]).toMatch(new RegExp(`^${KEY_PREFIX}[0-9a-f]{16}:\\d+$`));
    expect(keys[0]).toMatch(new RegExp(`^${KEY_PREFIX}${hashedUserPart(account.userId)}:\\d+$`));
    expect(await storageEntriesContaining(page, account.userId), 'raw user id in localStorage').toEqual([]);

    await expectEvaluatedButNotShown(page, () => page.reload({ waitUntil: 'domcontentloaded' }));
    expect(feedback.bodies).toHaveLength(1);
  });

  test('send without a comment omits description; no reassurance for other reasons', async ({ page, account }) => {
    const now = Date.now();
    writeRenewalOffCache(account.userId, { renewalOffAtMs: now - 2 * DAY_MS, accessEndsAtMs: now + 5 * DAY_MS });
    const feedback = await stubFeedback(page, 200);
    await openHomeAndAwaitPrompt(page);

    const dialog = promptDialog(page);
    await dialog.getByRole('radio', { name: 'Too expensive', exact: true }).check();
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    const thanks = page.getByRole('dialog', { name: 'Thanks, this really helps.' });
    await expect(thanks).toBeVisible();
    await expect(thanks.getByText(/You keep full access until/)).toHaveCount(0);
    expect(feedback.bodies).toEqual([{ type: 'cancellation', reason: 'too_expensive', isSandbox: false }]);
  });

  test('send failure (500): alert shown, selection kept, no key, asked again on reload', async ({
    page,
    account,
  }, testInfo) => {
    const now = Date.now();
    writeRenewalOffCache(account.userId, { renewalOffAtMs: now - 2 * DAY_MS, accessEndsAtMs: now + 5 * DAY_MS });
    const feedback = await stubFeedback(page, 500);
    await openHomeAndAwaitPrompt(page);

    const dialog = promptDialog(page);
    const broken = dialog.getByRole('radio', { name: "Something didn't work", exact: true });
    await broken.check();
    const comment = dialog.getByRole('textbox', { name: 'Add a comment (optional)' });
    await comment.fill('Reminders came late.');
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();

    await expect(dialog.getByRole('alert')).toHaveText("Couldn't send. Try again.");
    await expect(dialog.getByRole('alert'), 'a failed Send must be visible without scrolling').toBeInViewport();
    await expect(broken).toBeChecked();
    await expect(comment).toHaveValue('Reminders came late.');
    await expect(dialog.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    expect(feedback.bodies).toEqual([
      { type: 'cancellation', reason: 'something_broken', description: 'Reminders came late.', isSandbox: false },
    ]);
    expect(await askKeys(page), 'an answer that never landed writes no key').toEqual([]);
    await shoot(page, '03-desktop-error', testInfo);
    await checkA11y(page, 'cancel-reason-dialog-error', testInfo);

    // Picking another reason clears the stale error.
    await dialog.getByRole('radio', { name: 'Other', exact: true }).check();
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    // The key was never written, so a reload re-evaluates and asks again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(promptDialog(page)).toBeVisible({ timeout: 20_000 });
  });

  test('Not now closes, writes the key, and is not asked again on reload', async ({ page, account }) => {
    const now = Date.now();
    writeRenewalOffCache(account.userId, { renewalOffAtMs: now - 2 * DAY_MS, accessEndsAtMs: now + 5 * DAY_MS });
    const feedback = await stubFeedback(page);
    await openHomeAndAwaitPrompt(page);

    await promptDialog(page).getByRole('button', { name: 'Not now', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The dismiss write lands after an async hash — poll rather than read once.
    await expect.poll(() => askKeys(page)).toHaveLength(1);
    expect((await askKeys(page))[0]).toMatch(
      new RegExp(`^${KEY_PREFIX}${hashedUserPart(account.userId)}:\\d+$`)
    );
    expect(await storageEntriesContaining(page, account.userId), 'raw user id in localStorage').toEqual([]);

    await expectEvaluatedButNotShown(page, () => page.reload({ waitUntil: 'domcontentloaded' }));
    expect(feedback.bodies).toEqual([]);
  });

  test('Escape closes (counts as a dismissal)', async ({ page, account }) => {
    const now = Date.now();
    writeRenewalOffCache(account.userId, { renewalOffAtMs: now - 2 * DAY_MS, accessEndsAtMs: now + 5 * DAY_MS });
    const feedback = await stubFeedback(page);
    await openHomeAndAwaitPrompt(page);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => askKeys(page)).toHaveLength(1);
    expect(await storageEntriesContaining(page, account.userId), 'raw user id in localStorage').toEqual([]);
    expect(feedback.bodies).toEqual([]);
  });

  test('not eligible — unsubscribed 31 days ago: never shown', async ({ page, account }) => {
    const now = Date.now();
    // Still within the window per accessEndsAt (irrelevant — the backend gates
    // strictly on renewalOffAt, 30 days back from ITS OWN clock).
    writeRenewalOffCache(account.userId, {
      renewalOffAtMs: now - 31 * DAY_MS,
      accessEndsAtMs: now - 1 * DAY_MS,
    });
    await stubFeedback(page);
    await expectEvaluatedButNotShown(page, () => page.goto('/circles', { waitUntil: 'domcontentloaded' }));
    expect(await askKeys(page)).toEqual([]);
  });

  test('cancelled and access already ended, still inside the 30-day window: "ended on" headline', async ({
    page,
    account,
  }, testInfo) => {
    const now = Date.now();
    const endedMs = now - 3 * DAY_MS;
    writeRenewalOffCache(account.userId, {
      renewalOffAtMs: now - 10 * DAY_MS,
      accessEndsAtMs: endedMs,
      periodType: 'normal',
    });
    await stubFeedback(page);
    await openHomeAndAwaitPrompt(page);

    const dialog = promptDialog(page);
    const date = await renderedDate(page, endedMs, 'en-US');
    await expect(dialog.getByRole('heading', { name: `Your premium ended on ${date}.` })).toBeVisible();

    await dialog.getByRole('radio', { name: "I just didn't want to be charged automatically" }).check();
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    // entitlementActive is false, so the reassurance line — which claims
    // access continues — must NOT appear even for auto_charge.
    const thanks = page.getByRole('dialog', { name: 'Thanks, this really helps.' });
    await expect(thanks).toBeVisible();
    await expect(thanks.getByText(/You keep full access until/)).toHaveCount(0);
    await shoot(page, '09-desktop-ended', testInfo);
  });

  test('mobile viewport (390x844) renders the dialog', async ({ page, account }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const now = Date.now();
    writeRenewalOffCache(account.userId, { renewalOffAtMs: now - 2 * DAY_MS, accessEndsAtMs: now + 5 * DAY_MS });
    await stubFeedback(page);
    await openHomeAndAwaitPrompt(page);
    const dialog = promptDialog(page);
    await shoot(page, '06-mobile-initial', testInfo);
    await dialog.getByRole('radio', { name: "Something didn't work", exact: true }).check();
    await dialog.getByRole('textbox', { name: 'Add a comment (optional)' }).fill('The calendar would not load.');
    await shoot(page, '07-mobile-something-broken-comment', testInfo);

    // Nothing may overflow the viewport horizontally.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await checkA11y(page, 'cancel-reason-dialog-mobile', testInfo);
  });
});

/**
 * WHO MUST NEVER SEE IT: `cancelPrompt` is `null` — the everyday case, and the
 * one place this suite proves the RevenueCat SDK and its hosts are entirely
 * out of the picture.
 */
test.describe('cancel reason prompt (web) — did not cancel', () => {
  test('never cancelled (cancelPrompt null): never shown; zero RevenueCat requests; purchases-js chunk never requested', async ({
    page,
    account,
  }, testInfo) => {
    // beforeEach already cleared the cache; explicit for readability.
    clearRenewalOffCache(account.userId);
    const guard = await watchNetwork(page);
    await stubFeedback(page);

    await expectEvaluatedButNotShown(page, () => page.goto('/circles', { waitUntil: 'domcontentloaded' }));
    expect(await askKeys(page)).toEqual([]);

    // A reload is a fresh evaluation, and still nothing.
    await expectEvaluatedButNotShown(page, () => page.reload({ waitUntil: 'domcontentloaded' }));
    expect(await askKeys(page)).toEqual([]);

    expect(guard.revenueCatHits(), 'requests to api.revenuecat.com / e.revenue.cat').toBe(0);
    expect(
      guard.purchasesChunkHits(),
      'the purchases-js chunk must never be requested on the /circles route'
    ).toBe(0);
    await shoot(page, '10-account-not-cancelled', testInfo);
  });
});

test.describe('cancel reason prompt (web) — Spanish', () => {
  // Same technique as i18n-spanish.spec.ts: navigator locale `es` plus this
  // context's GET /users/me rewritten to `language: 'es'` so <LanguageSync>
  // keeps the UI in Spanish.
  test.use({ locale: 'es' });

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      try {
        const res = await route.fetch();
        const text = await res.text();
        let body: { data?: { user?: { language?: string } } };
        try {
          body = JSON.parse(text);
        } catch {
          await route.fulfill({ response: res });
          return;
        }
        if (body?.data?.user) body.data.user.language = 'es';
        await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(body) });
      } catch {
        try {
          await route.continue();
        } catch {
          /* request already gone */
        }
      }
    });
  });

  test('renders the Spanish copy', async ({ page, account }, testInfo) => {
    const now = Date.now();
    const expiresMs = now + 5 * DAY_MS;
    writeRenewalOffCache(account.userId, { renewalOffAtMs: now - 2 * DAY_MS, accessEndsAtMs: expiresMs });
    const feedback = await stubFeedback(page);
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    const dialog = promptDialog(page, /Tu premium (sigue activo hasta el|terminó el)/);
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    const date = await renderedDate(page, expiresMs, 'es');
    await expect(dialog.getByRole('heading', { name: `Tu premium sigue activo hasta el ${date}.` })).toBeVisible();
    await expect(
      dialog.getByRole('radiogroup', {
        name: '¿Nos cuentas por qué desactivaste la renovación? Nos ayuda a mejorar.',
      })
    ).toBeVisible();
    for (const label of [
      'Solo no quería que me cobraran automáticamente',
      'Es muy caro',
      'Algo no funcionó',
      'Le falta una función que necesito',
      'No lo necesitaba',
      'Otro',
    ]) {
      await expect(dialog.getByRole('radio', { name: label, exact: true })).toBeVisible();
    }
    await expect(dialog.getByRole('button', { name: 'Ahora no', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
    await dialog.getByRole('radio', { name: 'Algo no funcionó', exact: true }).check();
    await expect(dialog.getByRole('textbox', { name: 'Agrega un comentario (opcional)' })).toHaveAttribute(
      'placeholder',
      '¿Qué pasó?'
    );
    await shoot(page, '05-desktop-spanish', testInfo);
    await checkA11y(page, 'cancel-reason-dialog-es', testInfo);
    expect(feedback.bodies).toEqual([]);
  });
});

test.describe('comparison (visual review only)', () => {
  // Not an assertion about the prompt: captures an existing app dialog at the
  // same viewport so the prompt can be compared against the house style.
  test('existing dialog: calendar "Add event"', async ({ page, circleId }, testInfo) => {
    test.skip(testInfo.repeatEachIndex !== 0, 'screenshot-only; once is enough');
    await stubFeedback(page);
    await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('grid')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Add event' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shoot(page, '08-comparison-add-event-dialog', testInfo);
  });
});
