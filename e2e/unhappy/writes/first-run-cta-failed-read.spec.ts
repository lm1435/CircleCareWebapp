import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { apiSession, type ApiSession } from '../../unhappy';
import type { IsolatedAccount } from '../../isolation';
import { apiCreateEvent, dateInZone, failRequestWhere, recipientTimezone } from './_helpers';

// FIRST-RUN PROMPTS MUST NOT APPEAR WHEN THE READ THAT DECIDES THEM FAILED (or is paused offline).
//
// Today (docs/plans/simple-ui-1-3-1.md) has two places that split "you have these" from "you never
// had one":
//   - the NEXT-STEP card's first step, "Add {name}'s first medication" (button "Add medication"):
//     decided by GET /events/presence over the 211-day window (-30..+180, recipient frame).
//     While that read is unanswered or failed the card is simply NOT shown (status 'unknown');
//   - NEXT UP's empty line "Nothing else scheduled for {name} today.": decided by the day's
//     medication, calendar-window and open-task reads. When one FAILED it says
//     "Couldn't load today's list" + Retry instead of claiming the day is empty.
// (This file used to pin the same rule for the retired Open tasks / Today's medications /
// Get-started cards. A failed presence read once invited caregivers to add "the first one"
// again - a duplicate-record generator.)
//
// ABSENCE IS ONLY EVIDENCE FROM A SETTLED PAGE. "No CTA" is also true while Today is on its
// skeleton or not mounted at all (e.g. the ErrorBoundary reloading after a lazy chunk failed).
// So Today is SAMPLED atomically (mounted? loading? CTA?) in one evaluate, a settled sample is
// required, and every settled sample over a window must lack the CTA.
//
// Data: a FRESH circle per test (real API writes), so the worker's seeded circles are untouched.

test.use({ persona: 'premiumOwner' });

const NEXT_UP = 'section[aria-labelledby="next-up-heading"]';
const FIRST_MED_CTA = 'Add medication';
const LOAD_ERROR = "Couldn't load today's list";
const SERVER_ERROR = { status: 500, code: 'SERVER_ERROR', message: 'Internal server error' };

interface TodaySample {
  mounted: boolean;
  loading: boolean;
  online: boolean;
  /** The first-medication prompt: a next-step card whose button reads "Add medication". */
  firstMedCta: boolean;
  /** Next up claims the day is empty. */
  emptyClaim: boolean;
}

async function sampleToday(page: Page): Promise<TodaySample | null> {
  try {
    return await page.evaluate((cta) => {
      const nextUp = document.querySelector('section[aria-labelledby="next-up-heading"]');
      const card = document.querySelector('[data-testid="next-step-card"]');
      return {
        mounted: !!nextUp && !!document.querySelector('[data-testid="quick-access-grid"]'),
        loading: !!nextUp?.querySelector('[aria-busy="true"]') || nextUp?.getAttribute('aria-busy') === 'true',
        online: navigator.onLine,
        firstMedCta:
          !!card &&
          Array.from(card.querySelectorAll('button')).some((b) => (b.textContent ?? '').trim() === cta),
        emptyClaim: /Nothing else scheduled/.test(nextUp?.textContent ?? ''),
      };
    }, FIRST_MED_CTA);
  } catch (err) {
    // A navigation (the ErrorBoundary chunk reload) destroys the context: not on screen at that instant.
    if (/Execution context was destroyed|navigation/i.test(String(err))) return null;
    throw err;
  }
}

async function samples(
  page: Page,
  keep: (s: TodaySample) => boolean,
  windowMs = 2_000
): Promise<TodaySample[]> {
  const deadline = Date.now() + 25_000;
  const out: TodaySample[] = [];
  let first = false;
  while (Date.now() < deadline && !first) {
    const s = await sampleToday(page);
    if (s && keep(s)) {
      out.push(s);
      first = true;
    } else await page.waitForTimeout(100);
  }
  expect(first, 'Today reached a settled render').toBe(true);
  const until = Date.now() + windowMs;
  while (Date.now() < until) {
    const s = await sampleToday(page);
    if (s && keep(s)) out.push(s);
    await page.waitForTimeout(100);
  }
  return out;
}

const settled = (s: TodaySample) => s.mounted && !s.loading;

async function expectNoFirstMedCtaWhileSettled(page: Page): Promise<void> {
  const got = await samples(page, settled);
  expect(got.length, 'enough settled samples to judge absence').toBeGreaterThanOrEqual(5);
  expect(
    got.filter((s) => s.firstMedCta).length,
    `"${FIRST_MED_CTA}" rendered on a settled Today (${got.length} samples)`
  ).toBe(0);
}

async function freshCircle(
  request: APIRequestContext,
  account: IsolatedAccount
): Promise<{ api: ApiSession; circleId: string; tz: string }> {
  const api = await apiSession(request, account);
  const res = await api.post('/api/circles', { recipient_name: uniqueLabel('CTA') });
  expect(res.status(), await res.text()).toBe(201);
  const circleId = ((await res.json()) as { data: { circle: { id: string } } }).data.circle.id;
  return { api, circleId, tz: await recipientTimezone(api, circleId) };
}

async function removeCircle(api: ApiSession, circleId: string): Promise<void> {
  const res = await api.delete(`/api/circles/${circleId}`);
  expect(res.ok(), await res.text()).toBe(true);
}

async function seedFutureMedication(api: ApiSession, circleId: string, tz: string): Promise<void> {
  const name = uniqueLabel('CTA med');
  // Three days out, one-off: inside the presence window, never "today" or "yesterday".
  await apiCreateEvent(api, circleId, {
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '5 mg',
    scheduled_date: dateInZone(tz, 3),
    scheduled_time: '09:00',
  });
}

async function seedCompletedTask(api: ApiSession, circleId: string, tz: string): Promise<void> {
  const task = await apiCreateEvent(api, circleId, {
    event_type: 'task',
    title: uniqueLabel('CTA done task'),
    scheduled_date: dateInZone(tz, 0),
  });
  const done = await api.post(`/api/circles/${circleId}/events/${task.id}/complete`);
  expect(done.status(), await done.text()).toBe(200);
}

/** True for the 211-day presence window only (not today's/yesterday's dose reads, not the 14-day window). */
function isMedsPresenceWindow(url: URL): boolean {
  const start = url.searchParams.get('start_date');
  const end = url.searchParams.get('end_date');
  if (!start || !end || url.searchParams.has('event_type')) return false;
  const days = (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000;
  return days === 210;
}

test.describe('next-step card (first medication)', () => {
  test('control: the prompt is on a truly empty circle; a circle with a medication moves on to the invite step and never offers "Add medication"', async ({
    page,
    request,
    account,
  }) => {
    const { api, circleId, tz } = await freshCircle(request, account);
    try {
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      const card = page.getByTestId('next-step-card');
      await expect(card.getByRole('button', { name: FIRST_MED_CTA })).toBeVisible({ timeout: 20_000 });
      await expect(card).toHaveAttribute('data-step', 'first_med');

      await seedFutureMedication(api, circleId, tz);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('next-step-card')).toHaveAttribute('data-step', 'invite', { timeout: 20_000 });
      await expectNoFirstMedCtaWhileSettled(page);
    } finally {
      await removeCircle(api, circleId);
    }
  });

  test('a failed medication presence read does not offer "Add medication" to a circle that has medications; the real state lands once it answers', async ({
    page,
    request,
    account,
  }) => {
    const { api, circleId, tz } = await freshCircle(request, account);
    try {
      await seedFutureMedication(api, circleId, tz);
      const presence = await failRequestWhere(page, 'GET', '/api/circles/:id/events/presence', isMedsPresenceWindow, SERVER_ERROR);
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      // The read failed for good: first attempt + React Query's one retry.
      await expect.poll(() => presence.hits.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
      // Today itself is up (Next up and Quick access do not depend on presence).
      await expect(page.getByTestId('quick-access-grid')).toBeVisible({ timeout: 20_000 });
      await expectNoFirstMedCtaWhileSettled(page);
      await expect(page.getByTestId('next-step-card')).toHaveCount(0);

      // Recovery: the read answers, and the REAL state (a medication exists) lands.
      await presence.dispose();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('next-step-card')).toHaveAttribute('data-step', 'invite', { timeout: 20_000 });
      await expectNoFirstMedCtaWhileSettled(page);
    } finally {
      await removeCircle(api, circleId);
    }
  });
});

test.describe('Next up (empty line)', () => {
  test('control: a day with nothing says so in one sentence', async ({ page, request, account }) => {
    const { api, circleId, tz } = await freshCircle(request, account);
    try {
      await seedCompletedTask(api, circleId, tz);
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator(NEXT_UP).getByText(/^Nothing else scheduled for .* today\.$/)).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await removeCircle(api, circleId);
    }
  });

  test('a failed open-tasks read does not claim the day is empty: "Couldn\'t load today\'s list" + Retry, which recovers', async ({
    page,
    request,
    account,
  }) => {
    const { api, circleId, tz } = await freshCircle(request, account);
    try {
      await seedCompletedTask(api, circleId, tz);
      const tasks = await failRequestWhere(
        page,
        'GET',
        '/api/circles/:id/tasks',
        (url) => url.searchParams.get('status') === 'open',
        SERVER_ERROR
      );
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      await expect.poll(() => tasks.hits.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
      const nextUp = page.locator(NEXT_UP);
      await expect(nextUp.getByText(LOAD_ERROR)).toBeVisible({ timeout: 20_000 });
      const got = await samples(page, settled);
      expect(got.filter((s) => s.emptyClaim).length, 'Next up claimed an empty day while a read had failed').toBe(0);

      await tasks.dispose();
      await nextUp.getByRole('button', { name: 'Retry' }).click();
      await expect(nextUp.getByText(/^Nothing else scheduled for .* today\.$/)).toBeVisible({ timeout: 20_000 });
      await expect(nextUp.getByText(LOAD_ERROR)).toHaveCount(0);
    } finally {
      await removeCircle(api, circleId);
    }
  });
});

// ===========================================================================
// OFFLINE. Under `networkMode: 'online'` React Query PAUSES reads while the
// browser is offline: status 'pending', fetchStatus 'paused', `isLoading` FALSE,
// `isError` false, no data. A gate on `isLoading` reads that as a settled empty
// answer - a circle with a medication, opened client-side offline, showed "Add
// your first medication" until reconnect.
//
// The page must be reached by SPA navigation: a full load offline has no app at
// all. So Today's code is loaded first on another circle, the target circle is
// visited on a page that caches only the circle itself (Members), and Today is
// entered client-side after going offline - its reads are uncached and paused.
// ===========================================================================

/** Client-side (SPA) navigation: history push + popstate, which react-router follows. */
async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
}

async function openTodayOffline(page: Page, decoyCircleId: string, circleId: string): Promise<void> {
  // 1. Load Today's code (page chunk + components) on a DIFFERENT circle, online.
  await page.goto(`/circles/${decoyCircleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('quick-access-grid')).toBeVisible({ timeout: 20_000 });

  // 2. Client-side to the target circle's Members page, online: caches the circle, not Today's reads.
  const detail = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/circles/${circleId}`,
    { timeout: 20_000 }
  );
  await spaNavigate(page, `/circles/${circleId}/members`);
  expect((await detail).status(), 'target circle detail loaded online').toBe(200);
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/members$`));
  await expect(page.getByTestId('quick-access-grid')).toHaveCount(0, { timeout: 20_000 });

  // 3. Offline, then client-side into Today.
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await spaNavigate(page, `/circles/${circleId}`);
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
}

test.describe('offline', () => {
  test('a circle with a medication, opened client-side offline, shows no first-run prompt and no "nothing scheduled" claim; online shows the real state', async ({
    page,
    request,
    account,
    circleId: decoyCircleId,
  }) => {
    test.setTimeout(90_000);
    const { api, circleId, tz } = await freshCircle(request, account);
    try {
      await seedFutureMedication(api, circleId, tz);
      await openTodayOffline(page, decoyCircleId, circleId);

      const got = await samples(page, (s) => s.mounted && !s.online, 3_000);
      expect(got.length, 'enough samples with Today mounted and the browser offline').toBeGreaterThanOrEqual(10);
      expect(got.filter((s) => s.firstMedCta).length, 'first-medication prompt while every deciding read was paused').toBe(0);
      expect(got.filter((s) => s.emptyClaim).length, 'an empty-day claim while the day\'s reads were paused').toBe(0);

      await page.context().setOffline(false);
      await expect(page.getByTestId('next-step-card')).toHaveAttribute('data-step', 'invite', { timeout: 20_000 });
      await expect(page.locator(NEXT_UP).getByText(/^Nothing else scheduled for .* today\.$/)).toBeVisible({ timeout: 20_000 });
      await expectNoFirstMedCtaWhileSettled(page);
    } finally {
      await page.context().setOffline(false);
      await removeCircle(api, circleId);
    }
  });
});
