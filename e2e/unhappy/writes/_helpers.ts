import { expect, type Locator, type Page, type Request, type Route } from '@playwright/test';
import { sqlExec } from '../../db';
import { expandAllDayOverflow } from '../../helpers';
import {
  countRequests,
  fulfillFault,
  holdRequest,
  pathMatcher,
  sqlStr,
  type ApiSession,
  type FaultOptions,
  type HttpMethod,
  type PathPattern,
  type RequestCounter,
} from '../../unhappy';

// ===========================================================================
// Shared helpers for e2e/unhappy/writes/*.spec.ts ONLY.
//
// Nothing here relaxes an assertion: every helper either drives the UI, seeds
// through the real API, or asserts. Cleanup helpers delete rows these specs
// created (by run-unique title/body) so a worker slot's seeded data is left as
// found; globalTeardown purges the run's accounts and circles regardless.
// ===========================================================================

export const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runner-local date + `offsetDays`, YYYY-MM-DD — the VIEWER's wall clock the form fields hold. */
export function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Calendar date in `timeZone`, shifted by whole days (UTC-noon anchored, DST-proof). */
export function dateInZone(timeZone: string, offsetDays = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** The care recipient's timezone the calendar renders in (GET /api/circles/:id). */
export async function recipientTimezone(api: ApiSession, circleId: string): Promise<string> {
  const res = await api.get(`/api/circles/${circleId}`);
  expect(res.status(), await res.text()).toBe(200);
  const tz = ((await res.json()) as { data: { circle: { care_recipient_timezone?: string } } }).data.circle
    .care_recipient_timezone;
  expect(typeof tz, 'circle detail carries care_recipient_timezone').toBe('string');
  return tz as string;
}

/** POST an event through the real API; returns the created row. */
export async function apiCreateEvent(
  api: ApiSession,
  circleId: string,
  body: Record<string, unknown>
): Promise<{ id: string; scheduled_date: string }> {
  const res = await api.post(`/api/circles/${circleId}/events`, body);
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { data: { event: { id: string; scheduled_date: string } } }).data.event;
}

/** POST a care note through the real API; returns its id. */
export async function apiCreateCareNote(api: ApiSession, circleId: string, body: string): Promise<string> {
  const res = await api.post(`/api/circles/${circleId}/care-notes`, { body });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { data: { note: { id: string } } }).data.note.id;
}

/** Hard-delete every event (and its notes/confirmations) titled `title` in `circleId`. */
export function purgeEventsTitled(circleId: string, title: string): void {
  const c = `${sqlStr(circleId)}::uuid`;
  const t = sqlStr(title);
  const ids = `select id from calendar_events where circle_id = ${c} and (title = ${t} or medication_name = ${t})`;
  sqlExec(`
    delete from event_notes where event_id in (${ids});
    delete from medication_confirmations where event_id in (${ids});
    delete from calendar_events where circle_id = ${c} and parent_event_id is not null
      and (title = ${t} or medication_name = ${t});
    delete from calendar_events where circle_id = ${c} and (title = ${t} or medication_name = ${t});
  `);
}

/** An error toast (`role="alert"`) carrying exactly `text`. */
export function errorToast(page: Page, text: string): Locator {
  return page.getByRole('alert').filter({ hasText: new RegExp(`^\\s*${escapeRe(text)}`) });
}

/** A success toast (`role="status"`) carrying `text`. */
export function successToast(page: Page, text: string): Locator {
  return page.getByRole('status').filter({ hasText: new RegExp(`^\\s*${escapeRe(text)}`) });
}

/**
 * Two activations of `target` dispatched in ONE JavaScript task.
 *
 * Nothing React or React Query schedules (the pending render, the mutation's
 * `isPending` notification) can run between them, so the second call reaches
 * the handler with every piece of STATE still saying "idle" and the button
 * still enabled in the DOM. Only a synchronous guard (the `useSubmitGuard` /
 * `useGuardedSubmit` ref) can refuse it. This is what makes removing a guard's
 * `claim()` observable; a second click after a render commit is also refused by
 * `isPending`/`disabled` and could not tell the difference.
 */
export async function burstClick(target: Locator): Promise<void> {
  await expect(target).toBeEnabled();
  await target.evaluate((el) => {
    (el as HTMLElement).click();
    (el as HTMLElement).click();
  });
}

export interface DoubleSubmitOptions {
  method: HttpMethod;
  path: PathPattern;
  /** The Save/Confirm control. */
  submit: Locator;
  /**
   * The form it submits, when there is one. While the request is held the test
   * also calls `form.requestSubmit()`, which reaches `onSubmit` without
   * consulting the (now disabled) button — the in-handler guard must refuse it
   * for the WHOLE request, not just for a tick.
   */
  form?: Locator;
}

/**
 * The double-submit-while-pending protocol, in order:
 *   1. two same-tick activations (the synchronous guard),
 *   2. wait until the first request is HELD at the network layer,
 *   3. a real pointer click on the control while the request is still pending
 *      (plus `requestSubmit()` on the form, when there is one),
 *   4. release, then assert exactly ONE request was ever sent.
 * Returns after the request count settled at 1 (the write has reached the
 * backend by then); callers assert the database.
 */
export async function doubleSubmitWhileHeld(page: Page, opts: DoubleSubmitOptions): Promise<RequestCounter> {
  // Pin the exact element: several controls swap their label while pending
  // ("Delete" → "Deleting…", "Send invite" → "Sending…"), so a by-name locator
  // could not find the control again during step 3.
  const token = `ds-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await expect(opts.submit).toBeVisible();
  await opts.submit.evaluate((el, t) => el.setAttribute('data-e2e-double-submit', t), token);
  const control = page.locator(`[data-e2e-double-submit="${token}"]`);
  const hold = await holdRequest(page, opts.method, opts.path);
  const sent = countRequests(page, opts.method, opts.path);
  try {
    await burstClick(control);
    await hold.waitForHeld(1);
    // Stay held well past any plausible cooldown before re-activating. Without
    // this the "while pending" activation landed ~17ms after the claim — inside
    // a 50ms cooldown guard (falsified: a guard that released on a 50ms timer
    // instead of on settle passed). Only an activation this late proves the
    // guard is held for the WHOLE request.
    await page.waitForTimeout(1_000);
    expect(sent.count, 'still exactly one request, still held').toBe(1);
    // Real pointer input while the first request is still pending. `force`
    // because the control is expected to be disabled/loading now — the click
    // must still be DELIVERED so a guard that already let go would be caught.
    await control.click({ force: true });
    if (opts.form) {
      await opts.form.evaluate((f) => (f as HTMLFormElement).requestSubmit());
    }
    // Give a re-entered handler time to reach the network before releasing.
    await page.waitForTimeout(500);
    expect(sent.count, 'requests sent while the first one was held').toBe(1);
    await hold.release();
    await sent.expectCount(1);
    return sent;
  } finally {
    await hold.dispose();
    sent.dispose();
  }
}

/**
 * Open the calendar on the week containing `date` (recipient frame) and open
 * the detail dialog of the chip titled `title` on that day.
 */
export async function openCalendarEvent(
  page: Page,
  circleId: string,
  date: string,
  title: string
): Promise<Locator> {
  await page.goto(`/circles/${circleId}/calendar`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('grid')).toBeVisible({ timeout: 20_000 });
  const cells = page.locator('[data-date]');
  await expect(cells.first()).toBeAttached({ timeout: 20_000 });
  for (let step = 0; step < 3; step += 1) {
    const last = await cells.last().getAttribute('data-date');
    if (last && date <= last) break;
    const first = await cells.first().getAttribute('data-date');
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(cells.first()).not.toHaveAttribute('data-date', first ?? '', { timeout: 10_000 });
  }
  const cell = page.locator(`[data-date="${date}"]`).first();
  await expect(cell).toBeAttached({ timeout: 10_000 });
  await expandAllDayOverflow(page);
  const single = cell.getByRole('button', { name: /more all-day event/i });
  if ((await single.count()) > 0) await single.first().click();
  const titleRe = new RegExp(escapeRe(title));
  const chip = cell.getByRole('button', { name: titleRe }).first();
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();
  const dialog = page.getByRole('dialog', { name: titleRe });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

export interface WhereFault {
  readonly hits: Request[];
  dispose(): Promise<void>;
}

/**
 * `failRequest` with a QUERY predicate — the foundation helper matches the
 * pathname only, and the presence probes this suite targets share their path
 * with sibling reads (`/events` for today's doses vs the 211-day window;
 * `/tasks?status=open` vs `?status=all&limit=1`). Faults the next `times`
 * matches (default: every match).
 */
export async function failRequestWhere(
  page: Page,
  method: HttpMethod,
  pattern: PathPattern,
  where: (url: URL) => boolean,
  opts: FaultOptions & { times?: number } = {}
): Promise<WhereFault> {
  const match = pathMatcher(pattern);
  let remaining = opts.times ?? Number.POSITIVE_INFINITY;
  const hits: Request[] = [];
  const handler = async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (
      remaining <= 0 ||
      req.resourceType() === 'document' ||
      (method !== '*' && req.method() !== method) ||
      !where(url)
    ) {
      await route.fallback();
      return;
    }
    remaining -= 1;
    hits.push(req);
    await fulfillFault(route, opts);
  };
  const urlFilter = (url: URL) => match(url.pathname);
  await page.route(urlFilter, handler);
  return {
    hits,
    async dispose() {
      await page.unroute(urlFilter, handler);
    },
  };
}
