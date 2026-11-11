import { expect, type BrowserContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { sqlExec, sqlStr } from './db';

// Shared crawl helpers: visit a route, prove it didn't error, prove it's not a
// white screen, and run an axe accessibility scan.

// Console messages / page exceptions that are environmental noise rather than
// app bugs. Keep this list TIGHT — every entry is a thing the crawl will no
// longer catch, so justify each one.
const CONSOLE_IGNORE: RegExp[] = [
  /favicon/i, // browser auto-requests /favicon; not an app error
  /Download the React DevTools/i, // dev-only advisory
  /React Router Future Flag/i, // router v7 migration notice (warn)
  /ResizeObserver loop/i, // benign, fires on layout thrash
  /\[vite\]/i, // HMR / dev-server chatter
  // Expected by design: cookie-mode auth keeps the access token in memory only,
  // so a fresh page load's first API call 401s, then the interceptor refreshes
  // from the httpOnly cookie and retries. The 401 resource-load is logged by the
  // browser but is not an app error. (A real auth failure surfaces as a redirect
  // to /login, which the "session is valid" test catches.)
  /Failed to load resource.*401/i,
];

// Axe rules to fail on, by impact. heading-order (the bug that prompted this
// suite) is "moderate", so we fail at moderate and above; "minor" is reported
// but not failed to avoid noise-driven flakiness.
const FAIL_IMPACTS = new Set(['moderate', 'serious', 'critical']);

export interface CrawlResult {
  route: string;
  consoleErrors: string[];
  pageErrors: string[];
}

/**
 * Navigate to `route` and assert the page rendered without runtime errors and
 * isn't a blank white screen. Returns collected errors for the caller to assert
 * on (so one route's failure names the route).
 */
export async function visitAndCheck(page: Page, route: string): Promise<CrawlResult> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  const onConsole = (msg: import('@playwright/test').ConsoleMessage): void => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_IGNORE.some((re) => re.test(text))) return;
    consoleErrors.push(text);
  };
  const onPageError = (err: Error): void => {
    pageErrors.push(err.message);
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  try {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    // Let React render + initial data settle. networkidle can hang on apps with
    // polling, so cap it and fall through.
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

    // White-screen guard: #root must render visible content. Poll (don't read
    // once) so we don't false-positive during the auth-bootstrap blank window
    // (401 → token refresh → retry) on a fresh page load.
    await expect
      .poll(async () => (await page.locator('#root').innerText().catch(() => '')).trim().length, {
        message: `Route ${route} rendered a blank #root (white screen)`,
        timeout: 10_000,
      })
      .toBeGreaterThan(0);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }

  return { route, consoleErrors, pageErrors };
}

/** Assert the crawl result had no runtime errors. */
export function expectNoRuntimeErrors(result: CrawlResult): void {
  expect(result.pageErrors, `Uncaught exceptions on ${result.route}`).toEqual([]);
  expect(result.consoleErrors, `Console errors on ${result.route}`).toEqual([]);
}

/**
 * Run an axe accessibility scan on the current page and fail on any violation
 * at moderate+ impact. Attaches the full violation list to the test report.
 */
export async function checkA11y(
  page: Page,
  route: string,
  testInfo: TestInfo,
  options: {
    /**
     * Scope the scan to one subtree — for an OPEN MENU (non-modal popover):
     * its panel paints over the page, and axe's target-size rule then reports
     * every page control under it as "partially obscured", which is the
     * popover doing its job, not a defect. Dialogs are aria-modal and are
     * scanned with the whole page.
     */
    include?: string;
    /**
     * Also gate on WCAG 2.2 AA (`wcag22aa` → 2.5.8 Target Size). OPT-IN, for
     * scans taken at a controlled state — a route just loaded at scroll 0, or
     * a dialog just opened (smoke.spec.ts, public-smoke.spec.ts,
     * a11y-wcag22*.spec.ts). A flow scanning mid-interaction is usually
     * scrolled, and axe then reports every control that has slid under the
     * sticky header's buttons as "partially obscured" — a scroll position, not
     * a target size.
     */
    wcag22?: boolean;
  } = {}
): Promise<void> {
  // Let entrance animations (e.g. `rise-in`) finish before scanning: mid-animation
  // opacity/transform blends a token's true color against the page behind it,
  // and axe reads that transient blended color as a color-contrast violation
  // that never exists once the element settles. Routes visited with
  // `waitUntil: 'domcontentloaded'` can still be mid-animation when `analyze()`
  // would otherwise run immediately. Infinite-iteration animations (the
  // `.cc-shimmer` skeleton pulse, Spinner's `animate-spin`) never fire
  // `finished` at all, so they're excluded up front, and the rest still race
  // a 3s cap — a page with something ELSE perpetually animating must not hang
  // the whole test to the 30s timeout.
  await page
    .evaluate(() => {
      const finite = document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity);
      const settled = Promise.all(finite.map((a) => a.finished.catch(() => {})));
      const capped = new Promise((resolve) => setTimeout(resolve, 3_000));
      return Promise.race([settled, capped]);
    })
    .catch(() => {});
  // networkidle can hang on apps with polling, so cap it and fall through
  // (same as visitAndCheck above).
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});

  // `wcag22aa` (a11y audit 2026-09-29, opt-in — see `wcag22`): adds 2.5.8
  // Target Size (Minimum), the 2.2 criterion axe can measure; the rest of 2.2
  // AA (2.4.11 focus not obscured, 3.3.7, 3.3.8, 3.2.6) is not
  // machine-checkable and lives in e2e/a11y-wcag22.spec.ts as explicit
  // keyboard/geometry assertions.
  let builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    ...(options.wcag22 ? ['wcag22aa'] : []),
    'best-practice',
  ]);
  if (options.include) builder = builder.include(options.include);
  const results = await builder.analyze();

  if (results.violations.length > 0) {
    await testInfo.attach(`axe-${route.replace(/\W+/g, '_')}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json',
    });
  }

  const failing = results.violations.filter((v) => FAIL_IMPACTS.has(v.impact ?? ''));
  const summary = failing
    .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))`)
    .join('\n');

  expect(failing, `a11y violations on ${route}:\n${summary}`).toEqual([]);
}

/**
 * Expand every "+N more all-day events" toggle currently collapsed in the
 * calendar's week view (WeekView.tsx caps each day's all-day row at
 * `MAX_ALL_DAY_VISIBLE` and hides the rest behind a per-day overflow button,
 * `aria-label` "N more all-day event(s) on <day>"). Months of repeated e2e runs
 * pile many synthetic all-day Task/Appointment events onto "today", so a
 * freshly-created chip can land past that cap — call this before searching
 * for a specific chip by title so it's actually in the accessibility tree.
 *
 * Re-queries `.first()` after every click rather than snapshotting a count
 * up front: each click flips that day's button to a "show fewer" toggle
 * (different accessible name), so the matching set shrinks as we go and a
 * cached index would skip entries. A no-op when nothing is collapsed.
 */
export async function expandAllDayOverflow(page: Page): Promise<void> {
  // `events?` — the label is PLURALISED by the product, so a day hiding exactly
  // one chip reads "1 more all-day event on <day>" (singular). The old
  // plural-only regex silently skipped those days, leaving a chip out of the
  // accessibility tree and, worse, leaving an unmatched "…more…" button on the
  // page for a later non-exact `getByRole('button', { name: 'More' })` to
  // collide with.
  const moreButton = page.getByRole('button', { name: /more all-day events?\b/i });
  // Bounded so a naming regression here fails fast instead of hanging the test.
  for (let guard = 0; guard < 10; guard++) {
    if ((await moreButton.count()) === 0) return;
    await moreButton.first().click();
  }
}

/**
 * Explain WHY a click on `locator` cannot land — for overlap/clipping bugs.
 *
 * Playwright's actionability error ("<div …> intercepts pointer events") names
 * the element that won the hit test, which is usually mistaken for a selector
 * problem. It is often a real product defect, and the difference is decidable:
 * resolve the target's click point, ask the DOM what is actually painted there,
 * then walk UP from the target for the nearest ancestor that CLIPS
 * (`overflow` other than `visible`) and compare the two rects.
 *
 *   - target rect INSIDE the clip rect, another element on top  → stacking /
 *     z-index problem.
 *   - target rect OUTSIDE the clip rect                          → the target is
 *     not painted at all; whatever sits there answers the hit test. A z-index
 *     change cannot help. This is the shape that hid a dead "Cancel invite"
 *     control on the Members page: an inline-rendered `MoreMenu` flipped up out
 *     of a `Sheet`'s `overflow-hidden` box at a 720px-tall viewport, leaving 19
 *     of 53 panel pixels visible and the menu item 7.5px above the clip rect.
 *
 * Also re-measure at a second viewport HEIGHT: a bug that reproduces at
 * 1280x720 and not at 1440x900 is a flip/space-dependent one, which is exactly
 * why it presents as flake rather than as a stable failure.
 *
 * Returns a plain object; log it or attach it to the report. Read-only.
 */
export async function diagnoseClickObstruction(
  locator: import('@playwright/test').Locator
): Promise<unknown> {
  const handle = await locator.first().elementHandle();
  if (!handle) return { error: 'locator resolved to no element' };
  return handle.evaluate((target: Element) => {
    const rect = target.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const atPoint = document.elementFromPoint(cx, cy) as HTMLElement | null;

    let node: HTMLElement | null = target.parentElement;
    let clip: Record<string, unknown> | null = null;
    while (node) {
      const cs = getComputedStyle(node);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const r = node.getBoundingClientRect();
        clip = {
          tag: node.tagName,
          className: node.className,
          overflow: `${cs.overflowX}/${cs.overflowY}`,
          rect: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
        };
        break;
      }
      node = node.parentElement;
    }

    return {
      targetRect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
      clickPoint: { x: cx, y: cy },
      elementAtClickPoint: atPoint && {
        tag: atPoint.tagName,
        className: atPoint.className,
        text: (atPoint.textContent ?? '').slice(0, 80),
        zIndex: getComputedStyle(atPoint).zIndex,
        position: getComputedStyle(atPoint).position,
      },
      hitTargetIsTheTarget: atPoint === target || target.contains(atPoint),
      nearestClippingAncestor: clip,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
}

/**
 * Pin the circle's care-recipient zone (and the account owner's) to the BROWSER's zone.
 *
 * The app renders and reads times in the RECIPIENT frame (useCircle takes the care-recipient
 * MEMBER's zone first, then the owner's), while a spec that types "12:00" or "8:00 AM" into the
 * editor and asserts it back is describing the VIEWER's wall clock. Those are the same thing only
 * when the browser happens to be in the seeded zone (Denver). Call this before the first
 * navigation of such a test so it holds from any browser zone: the test then stays meaningful
 * in Denver (a no-op there) and in a far zone (Pacific/Kiritimati, Pacific/Midway) alike.
 * A test that WANTS a cross-zone circle must not call it.
 */
export async function pinRecipientZoneToBrowser(
  page: Page,
  account: { userId: string },
  circleId: string
): Promise<string> {
  const viewerTz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  sqlExec(
    `update users set timezone = ${sqlStr(viewerTz)} where id = ${sqlStr(account.userId)}::uuid
        or id in (select user_id from circle_memberships where circle_id = ${sqlStr(circleId)}::uuid);`
  );
  return viewerTz;
}

/**
 * Refuse the session-start profile-zone write (1.4.0 DeviceTimezoneSync: the stored zone follows the BROWSER's).
 * For specs whose subject is an account / recipient zone that DIFFERS from the browser's: without this, signing in
 * rewrites the seeded zone to the browser's, and a circle with no care-recipient account (its frame is the owner's
 * zone) moves with it. Only the zone PATCH is refused; any other PATCH /users/me (language, units) goes through.
 */
export async function refuseZoneSync(target: Page | BrowserContext): Promise<void> {
  await target.route(/\/api\/users\/me$/, (route) =>
    route.request().method() === 'PATCH' && /"timezone"/.test(route.request().postData() ?? '')
      ? route.abort()
      : route.continue()
  );
}

/**
 * The Notes composer starts COLLAPSED into an "Add a note" button (owner 2026-11-07). Open it when it is
 * folded (it is already open when the page arrived from the New menu or restored a draft) and return the
 * textarea.
 */
export async function openNoteComposer(page: Page): Promise<Locator> {
  const field = page.getByRole('textbox', { name: /^Add a note/ });
  const trigger = page.getByTestId('note-composer-expand');
  await expect(trigger.or(field)).toBeVisible({ timeout: 20_000 });
  if (await trigger.isVisible()) await trigger.click();
  await expect(field).toBeVisible({ timeout: 10_000 });
  return field;
}

/**
 * Week chips: same-type items that start at the SAME minute collapse into ONE "N meds" / "N tasks" chip that
 * opens a list (owner 2026-11-07). Specs that need one specific item click it through this helper, which
 * clicks the item's own chip when it is on the grid and otherwise opens each collapsed slot chip in `scope`
 * until it finds the item in the list (list items carry the same accessible name the chip would have had).
 */
export async function clickWeekChip(page: Page, scope: Locator, name: RegExp, timeout = 20_000): Promise<void> {
  const chip = scope.getByRole('button', { name }).first();
  const slots = scope.locator('button[data-slot-count]');
  await expect(chip.or(slots.first()).first()).toBeVisible({ timeout });
  if (await chip.isVisible()) {
    await chip.click();
    return;
  }
  const n = await slots.count();
  for (let i = 0; i < n; i += 1) {
    await slots.nth(i).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    const item = dialog.getByRole('button', { name }).first();
    if ((await item.count()) > 0) {
      await item.click();
      return;
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  }
  throw new Error(`no Week chip matches ${String(name)} (looked inside ${n} collapsed slot chips)`);
}

/** The accessible names of every Week chip in `scope` matching `name`, including those folded into a same-slot chip's list. */
export async function weekChipLabels(page: Page, scope: Locator, name: RegExp): Promise<string[]> {
  const labels = await scope
    .getByRole('button', { name })
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  const slots = scope.locator('button[data-slot-count]');
  const n = await slots.count();
  for (let i = 0; i < n; i += 1) {
    await slots.nth(i).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    labels.push(
      ...(await dialog.getByRole('button', { name }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '')))
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
  }
  return labels;
}

/** How many Week chips in `scope` match `name`, counting the ones folded into a same-slot chip's list. */
export async function weekChipCount(page: Page, scope: Locator, name: RegExp): Promise<number> {
  return (await weekChipLabels(page, scope, name)).length;
}

export type CalendarNewKind = 'medication' | 'appointment' | 'task';
const NEW_MENU_ITEM: Record<CalendarNewKind, RegExp> = {
  // The short label normally, the full word at large text.
  medication: /^(Med|Medication)$/,
  appointment: /^(Appt|Appointment)$/,
  task: /^Task$/,
};
const NEW_FORM_TITLE: Record<CalendarNewKind, string> = {
  medication: 'New medication',
  appointment: 'New appointment',
  task: 'New task',
};
/** The simple form's save button for each type. */
export const SIMPLE_SAVE: Record<CalendarNewKind, string> = {
  medication: 'Add medication',
  appointment: 'Add appointment',
  task: 'Add task',
};

/**
 * The Calendar's header "+" ("Add event") opens the New menu (owner 2026-11-08, mobile parity), not the
 * full "New event" form: pick `kind` there and return its SIMPLE form ("New medication" / "New
 * appointment" / "New task"). `.first()`: the masthead renders the action twice (round control below
 * xl, labelled button at xl) and the in-page outline "Add event" shares the name; the masthead's come
 * first in the DOM.
 */
export async function openCalendarNew(
  page: Page,
  kind: CalendarNewKind,
  options: { timeout?: number } = {}
): Promise<Locator> {
  await page.getByRole('button', { name: 'Add event', exact: true }).first().click({ timeout: options.timeout });
  const menu = page.getByRole('menu', { name: 'New' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: NEW_MENU_ITEM[kind] }).click();
  const dialog = page.getByRole('dialog', { name: NEW_FORM_TITLE[kind] });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Set a simple form's time (build 11, owner 2026-11-10): the medication's "Other…", the appointment's From and
 * the task's At are value tiles that ARE the time picker, over a visually hidden `#scheduled_time` that still
 * carries the value (PickerTile). The appointment / task tiles show after "Pick a time"; then fill the hidden
 * input. Times on these forms are the CIRCLE's clock (as the medication chips always were).
 */
export async function fillSimpleTime(dialog: Locator, time: string): Promise<void> {
  const field = dialog.locator('#scheduled_time');
  if ((await field.count()) === 0) await dialog.getByRole('radio', { name: 'Pick a time' }).click();
  await field.fill(time);
}

/** A simple form's day tile ("Starts" / "Repeats until"): fill the hidden native input behind the tile. */
export async function fillSimpleDate(dialog: Locator, id: 'scheduled_date' | 'recurrence_end_date', day: string): Promise<void> {
  await dialog.locator(`#${id}`).fill(day);
}

/**
 * The simple forms' Reminders card is the summary row's accordion above More details (owner 2026-11-10):
 * expand it (a no-op once it is open).
 */
export async function expandReminders(dialog: Locator): Promise<void> {
  const row = dialog.getByTestId('reminders-summary-row');
  if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
}

/**
 * The end time: the simple appointment's / task's To tile (a hidden `#endTime` under the time picker, shown with
 * "Pick a time"; the task's To is optional), or the full layout's field (which may sit in a folded More details).
 * Returns the input.
 */
export async function unfoldSimpleEnd(dialog: Locator): Promise<Locator> {
  const field = dialog.locator('#endTime');
  // The task's field sits in the folded More details (mounted, hidden) until it is opened.
  if (!(await field.isVisible())) {
    const more = dialog.getByRole('button', { name: /^More details/ });
    if ((await more.count()) > 0 && (await more.getAttribute('aria-expanded')) !== 'true') await more.click();
  }
  return field;
}

/**
 * Below lg the calendar opens on DAY (intended); a spec that needs the Week grid
 * steps onto it. The tab is picked by position (Day | Week | Month) so it holds in
 * Spanish too, and it is a no-op where Week is already the default.
 */
export async function showWeekView(page: Page): Promise<void> {
  const weekTab = page.getByTestId('calendar-view-toggle-wrap').getByRole('tab').nth(1);
  await expect(weekTab).toBeVisible({ timeout: 25_000 });
  // A DOM click, not Playwright's: at 320x568 the tabs sit below the fold and Playwright's
  // scroll-into-view would move the page, which the "page left alone on open" specs measure.
  if ((await weekTab.getAttribute('aria-selected')) === 'true') return;
  await weekTab.evaluate((el) => (el as HTMLElement).click());
  await expect(weekTab).toHaveAttribute('aria-selected', 'true');
  // At 320x568 the tabs sit near the nav pill, and the tab's own focus ring makes the browser
  // scroll the page ~27px to clear its scroll-padding. That is setup noise, not the page
  // moving "by itself on open", so put the page back at the top before the spec measures.
  // The focus scroll is smooth (html scroll-behavior), so let it finish first.
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(100);
}
