import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { apiSession, type ApiSession } from '../../unhappy';
import type { IsolatedAccount } from '../../isolation';
import { apiCreateEvent, dateInZone, failRequestWhere, recipientTimezone } from './_helpers';

// FIRST-RUN CTAs MUST NOT APPEAR WHEN THE PRESENCE READ FAILS.
//
// Home's "Today's medications" and "Open tasks" cards split an empty list into
// "you have these, none today / none open" versus "you never had one — add
// your first". The second branch is decided by a PRESENCE read:
//   - TodaysMeds (and the Get-started checklist, sharing the same query):
//     GET /events/presence over the 211-day window (-30..+180, recipient
//     frame) — `hasAnyMedication = presence.medication` (falls back to the full
//     /events read only when an old backend 404s the presence route);
//   - OpenTasksCard: GET /tasks?status=all&limit=1 — `hasEverHadTask`.
// Neither USED to have an isError branch, so a FAILED presence read was
// indistinguishable from "never had one": a caregiver whose circle already had
// medications/tasks was invited to add "the first one" again — a
// duplicate-record generator. Both cards now render neutral copy + Retry.
//
// Each card gets a CONTROL (same real data, read succeeds: the fact copy shows
// and the CTA does not; plus the CTA IS found on a truly empty circle, so the
// locator is proven live) and the FAILED-READ test (read fails → CTA must not
// show, the unavailable copy does; Retry refetches and lands the real state).
// RED on the pre-fix code (served from a copy with the error branch removed).
//
// ABSENCE IS ONLY EVIDENCE FROM A SETTLED CARD. "No CTA" is also true while the
// card is on its skeleton, or not mounted at all — e.g. while the app's
// ErrorBoundary reloads the page after a lazy chunk failed to load under load
// (ErrorBoundary.tsx). So the card is SAMPLED atomically (mounted? loading?
// CTA?) in one evaluate, a settled sample is required, and every settled sample
// over a window must lack the CTA. An earlier version checked `aria-busy`
// count 0 and CTA count 0 separately; both were vacuously satisfied by a page
// mid-reload, and the known-bug tests "unexpectedly passed" on buggy code.
//
// Data: a FRESH circle per test (real API writes), so "has one, but none today
// / none open" is real state and the worker's seeded circles are untouched.

test.use({ persona: 'premiumOwner' });

const TASKS_CARD = 'section[aria-labelledby="open-tasks-heading"]';
const MEDS_CARD = 'section[aria-labelledby="todays-meds-heading"]';
const TASKS_CTA = 'Add your first task';
const MEDS_CTA = 'Add a medication';
const TASKS_CAUGHT_UP = "You're all caught up — no open tasks.";
const MEDS_NONE_TODAY = 'No medications scheduled today.';
const TASKS_LOAD_ERROR = "Couldn't load open tasks";
const MEDS_PRESENCE_ERROR = "Couldn't load medications";

type CardState = 'absent' | 'loading' | 'cta' | 'no-cta';

/** One atomic reading of a card: mounted? still loading? CTA rendered? */
async function cardState(page: Page, card: string, ctaLabel: string): Promise<CardState> {
  try {
    return await page.evaluate(
      ([selector, label]) => {
        const section = document.querySelector(selector);
        if (!section) return 'absent';
        if (section.querySelector('[aria-busy="true"]')) return 'loading';
        const hasCta = Array.from(section.querySelectorAll('button')).some(
          (b) => (b.textContent ?? '').trim() === label
        );
        return hasCta ? 'cta' : 'no-cta';
      },
      [card, ctaLabel] as const
    );
  } catch (err) {
    // A navigation (the ErrorBoundary chunk reload) destroys the context: the
    // card is not on screen at that instant. Classified, never counted as a pass.
    if (/Execution context was destroyed|navigation/i.test(String(err))) return 'absent';
    throw err;
  }
}

/**
 * Wait for the card's first SETTLED sample (mounted and not loading), then keep
 * sampling for `windowMs`. Returns only the settled samples ('cta' | 'no-cta').
 */
async function settledSamples(page: Page, card: string, ctaLabel: string, windowMs = 2_000): Promise<CardState[]> {
  const deadline = Date.now() + 25_000;
  let first: CardState | undefined;
  while (Date.now() < deadline) {
    const s = await cardState(page, card, ctaLabel);
    if (s === 'cta' || s === 'no-cta') {
      first = s;
      break;
    }
    await page.waitForTimeout(100);
  }
  expect(first, `${card} reached a settled render (mounted, not loading)`).toBeDefined();
  const samples: CardState[] = [first as CardState];
  const until = Date.now() + windowMs;
  while (Date.now() < until) {
    const s = await cardState(page, card, ctaLabel);
    if (s === 'cta' || s === 'no-cta') samples.push(s);
    await page.waitForTimeout(100);
  }
  return samples;
}

async function expectNoCtaWhileSettled(page: Page, card: string, ctaLabel: string): Promise<void> {
  const samples = await settledSamples(page, card, ctaLabel);
  expect(samples.length, 'enough settled samples to judge absence').toBeGreaterThanOrEqual(5);
  expect(
    samples.filter((s) => s === 'cta').length,
    `"${ctaLabel}" rendered in a settled card (samples: ${samples.join(',')})`
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

async function seedCompletedTask(api: ApiSession, circleId: string, tz: string): Promise<void> {
  const task = await apiCreateEvent(api, circleId, {
    event_type: 'task',
    title: uniqueLabel('CTA done task'),
    scheduled_date: dateInZone(tz, 0),
  });
  const done = await api.post(`/api/circles/${circleId}/events/${task.id}/complete`);
  expect(done.status(), await done.text()).toBe(200);
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

/** True for the ?status=all&limit=1 "ever had a task" probe only. */
const isEverHadTasks = (url: URL) => url.searchParams.get('status') === 'all' && url.searchParams.get('limit') === '1';

/** True for the 211-day presence window only (not today's/yesterday's dose reads, not the calendar week). */
function isMedsPresenceWindow(url: URL): boolean {
  const start = url.searchParams.get('start_date');
  const end = url.searchParams.get('end_date');
  if (!start || !end || url.searchParams.has('event_type')) return false;
  const days = (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000;
  return days === 210;
}

const SERVER_ERROR = { status: 500, code: 'SERVER_ERROR', message: 'Internal server error' };

test.describe('OpenTasksCard', () => {
  test('control: CTA on a truly empty circle; a circle with only completed tasks shows "all caught up" and no CTA', async ({
    page,
    request,
    account,
  }) => {
    const { api, circleId, tz } = await freshCircle(request, account);
    try {
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator(TASKS_CARD).getByRole('button', { name: TASKS_CTA })).toBeVisible({ timeout: 20_000 });

      await seedCompletedTask(api, circleId, tz);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(TASKS_CARD).getByText(TASKS_CAUGHT_UP)).toBeVisible({ timeout: 20_000 });
      await expectNoCtaWhileSettled(page, TASKS_CARD, TASKS_CTA);
    } finally {
      await removeCircle(api, circleId);
    }
  });

  test(
    'a failed "ever had a task" read does not show "Add your first task" to a circle that has tasks; Retry recovers',
    async ({ page, request, account }) => {
      const { api, circleId, tz } = await freshCircle(request, account);
      try {
        await seedCompletedTask(api, circleId, tz);
        const everHad = await failRequestWhere(page, 'GET', '/api/circles/:id/tasks', isEverHadTasks, SERVER_ERROR);
        const openLoaded = page.waitForResponse(
          (r) =>
            r.request().method() === 'GET' &&
            new URL(r.url()).pathname === `/api/circles/${circleId}/tasks` &&
            new URL(r.url()).searchParams.get('status') === 'open',
          { timeout: 20_000 }
        );
        await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
        expect((await openLoaded).status(), 'the open-tasks list itself loaded').toBe(200);
        // The probe failed for good: first attempt + React Query's one retry.
        await expect.poll(() => everHad.hits.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

        await expectNoCtaWhileSettled(page, TASKS_CARD, TASKS_CTA);
        const card = page.locator(TASKS_CARD);
        await expect(card.getByText(TASKS_LOAD_ERROR)).toBeVisible();

        // Retry must actually re-ask the probe, and land the REAL state.
        await everHad.dispose();
        const reProbe = page.waitForResponse(
          (r) =>
            r.request().method() === 'GET' &&
            new URL(r.url()).pathname === `/api/circles/${circleId}/tasks` &&
            isEverHadTasks(new URL(r.url())),
          { timeout: 20_000 }
        );
        await card.getByRole('button', { name: 'Retry' }).click();
        expect((await reProbe).status(), 'the retried probe reached the backend').toBe(200);
        await expect(card.getByText(TASKS_CAUGHT_UP)).toBeVisible({ timeout: 20_000 });
        await expect(card.getByText(TASKS_LOAD_ERROR)).toHaveCount(0);
        await expectNoCtaWhileSettled(page, TASKS_CARD, TASKS_CTA);
      } finally {
        await removeCircle(api, circleId);
      }
    }
  );
});

test.describe('TodaysMeds', () => {
  test('control: CTA on a truly empty circle; a circle with a future medication shows "none today" and no CTA', async ({
    page,
    request,
    account,
  }) => {
    const { api, circleId, tz } = await freshCircle(request, account);
    try {
      await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator(MEDS_CARD).getByRole('button', { name: MEDS_CTA })).toBeVisible({ timeout: 20_000 });

      await seedFutureMedication(api, circleId, tz);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(MEDS_CARD).getByText(MEDS_NONE_TODAY)).toBeVisible({ timeout: 20_000 });
      await expectNoCtaWhileSettled(page, MEDS_CARD, MEDS_CTA);
    } finally {
      await removeCircle(api, circleId);
    }
  });

  test(
    'a failed medication presence read does not show "Add a medication" to a circle that has medications; Retry recovers',
    async ({ page, request, account }) => {
      const { api, circleId, tz } = await freshCircle(request, account);
      try {
        await seedFutureMedication(api, circleId, tz);
        const presence = await failRequestWhere(page, 'GET', '/api/circles/:id/events/presence', isMedsPresenceWindow, SERVER_ERROR);
        const todayLoaded = page.waitForResponse(
          (r) => {
            if (r.request().method() !== 'GET') return false;
            const url = new URL(r.url());
            return (
              url.pathname === `/api/circles/${circleId}/events` &&
              url.searchParams.get('event_type') === 'medication' &&
              url.searchParams.get('start_date') === url.searchParams.get('end_date')
            );
          },
          { timeout: 20_000 }
        );
        await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
        expect((await todayLoaded).status(), "today's doses loaded").toBe(200);
        await expect.poll(() => presence.hits.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);

        await expectNoCtaWhileSettled(page, MEDS_CARD, MEDS_CTA);
        const card = page.locator(MEDS_CARD);
        await expect(card.getByText(MEDS_PRESENCE_ERROR)).toBeVisible();

        // Retry must actually re-ask the presence window, and land the REAL state.
        await presence.dispose();
        const rePresence = page.waitForResponse(
          (r) =>
            r.request().method() === 'GET' &&
            new URL(r.url()).pathname === `/api/circles/${circleId}/events/presence` &&
            isMedsPresenceWindow(new URL(r.url())),
          { timeout: 20_000 }
        );
        await card.getByRole('button', { name: 'Retry' }).click();
        expect((await rePresence).status(), 'the retried presence window reached the backend').toBe(200);
        await expect(card.getByText(MEDS_NONE_TODAY)).toBeVisible({ timeout: 20_000 });
        await expect(card.getByText(MEDS_PRESENCE_ERROR)).toHaveCount(0);
        await expectNoCtaWhileSettled(page, MEDS_CARD, MEDS_CTA);
      } finally {
        await removeCircle(api, circleId);
      }
    }
  );
});

// ===========================================================================
// THE GET-STARTED CHECKLIST reads the SAME 211-day presence window as
// TodaysMeds (same query key). It used to wait on `isLoading` only, so when that
// read FAILED it rendered "0 of 3 done" with "Add a medication" pending and an
// Add button on a circle that HAS a medication — right above TodaysMeds' own
// "Couldn't load medications". It now stays hidden until its reads SUCCEED;
// TodaysMeds owns the error + Retry, and that Retry brings the checklist back.
// ===========================================================================

const CHECKLIST = '[role="region"][aria-label="Get started"]';
const CHECKLIST_MED_STEP = 'Add a medication';

type ChecklistState = 'absent' | 'cta' | 'no-cta';

interface HomeSample {
  /** Both Home cards are mounted (not a blank page mid-navigation/reload). */
  mounted: boolean;
  /** TodaysMeds shows its settled presence-read failure. */
  medsPresenceError: boolean;
  checklist: ChecklistState;
  /** Which cards render a first-run "add" CTA right now. */
  ctas: string[];
  online: boolean;
}

/** One atomic reading of Home: every card's first-run CTA, the checklist's med step, and connectivity. */
async function homeSample(page: Page): Promise<HomeSample | null> {
  try {
    return await page.evaluate(
      ([tasksSel, medsSel, checklistSel, tasksCta, medsCta, stepLabel, presenceError]) => {
        const hasButton = (root: Element | null, label: string) =>
          !!root && Array.from(root.querySelectorAll('button')).some((b) => (b.textContent ?? '').trim() === label);
        const tasks = document.querySelector(tasksSel);
        const meds = document.querySelector(medsSel);
        const region = document.querySelector(checklistSel);
        // The med step is pending iff its row carries an action button ("Add").
        const stepHasCta =
          !!region &&
          Array.from(region.querySelectorAll('li')).some(
            (li) =>
              (li.querySelector('p')?.textContent ?? '').trim().startsWith(stepLabel) && li.querySelector('button') !== null
          );
        const ctas: string[] = [];
        if (hasButton(tasks, tasksCta)) ctas.push('tasks');
        if (hasButton(meds, medsCta)) ctas.push('meds');
        if (stepHasCta) ctas.push('checklist');
        return {
          mounted: !!tasks && !!meds,
          medsPresenceError:
            !!meds && !meds.querySelector('[aria-busy="true"]') && (meds.textContent ?? '').includes(presenceError),
          checklist: (!region ? 'absent' : stepHasCta ? 'cta' : 'no-cta') as ChecklistState,
          ctas,
          online: navigator.onLine,
        };
      },
      [TASKS_CARD, MEDS_CARD, CHECKLIST, TASKS_CTA, MEDS_CTA, CHECKLIST_MED_STEP, MEDS_PRESENCE_ERROR] as const
    );
  } catch (err) {
    if (/Execution context was destroyed|navigation/i.test(String(err))) return null;
    throw err;
  }
}

/** Sample Home for `windowMs`; returns only samples where `keep` holds. */
async function sampleHome(page: Page, keep: (s: HomeSample) => boolean, windowMs = 2_500): Promise<HomeSample[]> {
  const kept: HomeSample[] = [];
  const until = Date.now() + windowMs;
  while (Date.now() < until) {
    const s = await homeSample(page);
    if (s && keep(s)) kept.push(s);
    await page.waitForTimeout(100);
  }
  return kept;
}

async function checklistState(page: Page): Promise<ChecklistState | 'unmounted'> {
  const s = await homeSample(page);
  return s && s.mounted ? s.checklist : 'unmounted';
}

test.describe('GettingStartedChecklist', () => {
  test(
    'a failed presence read does not show "Add a medication" as pending in the checklist on a circle that has one; TodaysMeds\' Retry brings it back correct',
    async ({ page, request, account }) => {
      const { api, circleId, tz } = await freshCircle(request, account);
      try {
        // Locator proven live: a truly empty circle's checklist has the med step pending with its Add.
        await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => checklistState(page), { timeout: 20_000 }).toBe('cta');

        // Positive signal: with the read succeeding, this circle (a medication, but no invite and no
        // emergency info) still HAS the checklist on screen — setup is unfinished — and the step is done.
        await seedFutureMedication(api, circleId, tz);
        await page.reload({ waitUntil: 'domcontentloaded' });
        const checklist = page.locator(CHECKLIST);
        await expect(checklist).toBeVisible({ timeout: 20_000 });
        await expect(checklist.getByText('1 of 3 done')).toBeVisible();
        await expect.poll(() => checklistState(page), { timeout: 10_000 }).toBe('no-cta');

        // The presence window fails for good (first attempt + React Query's one retry).
        const presence = await failRequestWhere(page, 'GET', '/api/circles/:id/events/presence', isMedsPresenceWindow, SERVER_ERROR);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect.poll(() => presence.hits.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
        // Settled: TodaysMeds, reading the SAME query, shows its failure — the checklist's read has failed too.
        await expect(page.locator(MEDS_CARD).getByText(MEDS_PRESENCE_ERROR)).toBeVisible({ timeout: 20_000 });

        const settled = await sampleHome(page, (s) => s.mounted && s.medsPresenceError);
        expect(settled.length, 'enough settled samples (Home mounted, presence failure shown)').toBeGreaterThanOrEqual(5);
        expect(
          settled.filter((s) => s.checklist === 'cta').length,
          `checklist offered "${CHECKLIST_MED_STEP}" as pending (samples: ${settled.map((s) => s.checklist).join(',')})`
        ).toBe(0);
        // Nor TodaysMeds' door. (The tasks card's "Add your first task" is legitimate here — this circle has
        // no tasks and its reads are not faulted — so only the CTAs this failed read decides are judged.)
        expect(
          settled.filter((s) => s.ctas.some((c) => c !== 'tasks')).map((s) => s.ctas.join('+')),
          'a medication CTA rendered while the presence read had failed'
        ).toEqual([]);

        // Retry (on TodaysMeds — the one error surface) re-asks the shared window; the checklist returns, step done.
        await presence.dispose();
        const rePresence = page.waitForResponse(
          (r) =>
            r.request().method() === 'GET' &&
            new URL(r.url()).pathname === `/api/circles/${circleId}/events/presence` &&
            isMedsPresenceWindow(new URL(r.url())),
          { timeout: 20_000 }
        );
        await page.locator(MEDS_CARD).getByRole('button', { name: 'Retry' }).click();
        expect((await rePresence).status(), 'the retried presence window reached the backend').toBe(200);
        await expect(checklist).toBeVisible({ timeout: 20_000 });
        await expect(checklist.getByText('1 of 3 done')).toBeVisible();
        await expect.poll(() => checklistState(page), { timeout: 10_000 }).toBe('no-cta');
      } finally {
        await removeCircle(api, circleId);
      }
    }
  );
});

// ===========================================================================
// OFFLINE. Under `networkMode: 'online'` React Query PAUSES reads while the
// browser is offline: status 'pending', fetchStatus 'paused', `isLoading`
// FALSE, `isError` false, no data. Gates on `isLoading` read that as a settled
// empty answer — a circle with tasks, opened client-side offline, showed "Add
// your first task" (and the checklist "Add a medication") until reconnect.
//
// The page must be reached by SPA navigation: a full load offline has no app
// at all. So Home's code is loaded first on another circle, the target circle
// is visited on a page that caches only the circle itself (Members), and Home
// is entered client-side after going offline — its card reads are uncached and
// genuinely paused.
// ===========================================================================

/** Client-side (SPA) navigation: history push + popstate, which react-router follows. */
async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
}

async function openHomeOffline(page: Page, decoyCircleId: string, circleId: string): Promise<void> {
  // 1. Load Home's code (page chunk + card components) on a DIFFERENT circle, online.
  await page.goto(`/circles/${decoyCircleId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(TASKS_CARD)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(MEDS_CARD)).toBeVisible({ timeout: 20_000 });

  // 2. Client-side to the target circle's Members page, online: caches the circle, not Home's reads.
  const detail = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/circles/${circleId}`,
    { timeout: 20_000 }
  );
  await spaNavigate(page, `/circles/${circleId}/members`);
  expect((await detail).status(), 'target circle detail loaded online').toBe(200);
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/members$`));
  await expect(page.locator(TASKS_CARD)).toHaveCount(0, { timeout: 20_000 });

  // 3. Offline, then client-side into Home.
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await spaNavigate(page, `/circles/${circleId}`);
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`));
}

/** While offline on Home: enough mounted, offline samples, and not one first-run CTA on any card. */
async function expectNoCtaOffline(page: Page): Promise<void> {
  const samples = await sampleHome(page, (s) => s.mounted && !s.online, 3_000);
  expect(samples.length, 'enough samples with Home mounted and the browser offline').toBeGreaterThanOrEqual(10);
  const withCta = samples.filter((s) => s.ctas.length > 0).map((s) => s.ctas.join('+'));
  expect(withCta, 'first-run CTAs rendered while every deciding read was paused offline').toEqual([]);
}

test.describe('offline', () => {
  test('a circle with a completed task, opened client-side offline, shows no first-run CTA on any card; online shows the real state', async ({
    page,
    request,
    account,
    circleId: decoyCircleId,
  }) => {
    test.setTimeout(90_000);
    const { api, circleId, tz } = await freshCircle(request, account);
    try {
      await seedCompletedTask(api, circleId, tz);
      await openHomeOffline(page, decoyCircleId, circleId);
      await expectNoCtaOffline(page);

      await page.context().setOffline(false);
      const card = page.locator(TASKS_CARD);
      await expect(card.getByText(TASKS_CAUGHT_UP)).toBeVisible({ timeout: 20_000 });
      await expectNoCtaWhileSettled(page, TASKS_CARD, TASKS_CTA);
      // The real state of the rest of Home rendered too: no medication, so the checklist's step is legitimately pending.
      await expect(page.locator(CHECKLIST)).toBeVisible({ timeout: 20_000 });
      await expect.poll(() => checklistState(page), { timeout: 10_000 }).toBe('cta');
    } finally {
      await page.context().setOffline(false);
      await removeCircle(api, circleId);
    }
  });

  test('a circle with a medication, opened client-side offline, shows no first-run CTA on any card; online shows the real state', async ({
    page,
    request,
    account,
    circleId: decoyCircleId,
  }) => {
    test.setTimeout(90_000);
    const { api, circleId, tz } = await freshCircle(request, account);
    try {
      await seedFutureMedication(api, circleId, tz);
      await openHomeOffline(page, decoyCircleId, circleId);
      await expectNoCtaOffline(page);

      await page.context().setOffline(false);
      await expect(page.locator(MEDS_CARD).getByText(MEDS_NONE_TODAY)).toBeVisible({ timeout: 20_000 });
      await expectNoCtaWhileSettled(page, MEDS_CARD, MEDS_CTA);
      const checklist = page.locator(CHECKLIST);
      await expect(checklist).toBeVisible({ timeout: 20_000 });
      await expect(checklist.getByText('1 of 3 done')).toBeVisible();
      await expect.poll(() => checklistState(page), { timeout: 10_000 }).toBe('no-cta');
    } finally {
      await page.context().setOffline(false);
      await removeCircle(api, circleId);
    }
  });
});
