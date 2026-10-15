import type { Locator, Page } from '@playwright/test';
import { test, expect, uniqueLabel } from '../../fixtures';
import { failRequest } from '../../unhappy';
import { errorToast } from './_helpers';

// A PAGE-LEVEL TOAST MUST NOT COVER THE PAGE'S CONTROLS — at the NATURAL scroll.
//
// The page placement used to be bottom-right, where pages keep their primary
// actions: at 1280x720 it covered 54% of EditCirclePage's "Save changes" at
// scroll 0, and a retry spec that scrolled the button to the centre before
// checking hid it. Nothing here scrolls for the check. Each case raises a REAL
// toast the way a user does and measures where the page is:
//   - EditCirclePage, ProfilePage and the Notes composer: the save itself fails
//     (the click is the only thing that may scroll, exactly as a user's would);
//   - Overview, Calendar, Tasks, Emergency, Members, Documents: the free-tier
//     AI entry raises the premium gate — a two-line toast carrying "Upgrade",
//     i.e. the tallest page toast — dispatched without scrolling anything, on a
//     page left at scroll 0.
// Then, with the entrance animation finished, the toast's FULL box is
// intersected with the full visible box of EVERY interactive element on the
// page: the app header (circle switcher, account menu), the sidebar or the nav
// pill, and everything in <main>. Any shared area fails.

test.setTimeout(60_000);

const VIEWPORTS = [
  { label: 'desktop 1280x720', width: 1280, height: 720 },
  { label: 'desktop 1440x900', width: 1440, height: 900 },
  { label: 'tablet 1024x768', width: 1024, height: 768 },
  { label: 'phone 390x844', width: 390, height: 844 },
  { label: 'phone 360x640', width: 360, height: 640 },
];

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ControlGeometry {
  label: string;
  zone: string;
  box: Box;
  overlap: number;
}

interface Geometry {
  viewport: { width: number; height: number };
  scrollY: number;
  toastCount: number;
  toast: Box;
  controls: ControlGeometry[];
}

async function settledToast(page: Page): Promise<Locator> {
  const toast = page.locator('[data-toast-region] > [data-toast]:not([data-leaving])');
  await expect(toast).toHaveCount(1);
  await expect
    .poll(
      () => toast.evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState !== 'finished').length),
      { message: 'the toast entrance animation has finished' }
    )
    .toBe(0);
  return toast;
}

/** Every painted interactive element on the page (outside the toast), intersected with the toast. */
async function measure(page: Page): Promise<Geometry> {
  return page.evaluate(() => {
    type B = { left: number; top: number; right: number; bottom: number };
    const box = (r: DOMRect): B => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    const clip = (a: B, b: B): B => ({
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    });
    const area = (b: B) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
    const inToast = (n: Element | null) => !!n?.closest('[data-toast-region]');
    const viewport: B = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };

    const toasts = Array.from(document.querySelectorAll('[data-toast-region] > [data-toast]'));
    if (toasts.length === 0) throw new Error('no toast on screen to measure');
    const toastBox = box(toasts[toasts.length - 1].getBoundingClientRect());

    const selector =
      'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="option"], [role="combobox"], [role="slider"], [role="gridcell"][tabindex], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
    const controls = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>(selector))) {
      if (inToast(el)) continue;
      if (el.getAttribute('role') === 'region') continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      let visible = clip(box(el.getBoundingClientRect()), viewport);
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if (/(auto|scroll|hidden|clip)/.test(`${ps.overflowX} ${ps.overflowY}`)) visible = clip(visible, box(p.getBoundingClientRect()));
      }
      if (area(visible) < 1) continue;
      let painted = false;
      for (const fx of [0.1, 0.5, 0.9])
        for (const fy of [0.2, 0.5, 0.8]) {
          const top = document
            .elementsFromPoint(visible.left + (visible.right - visible.left) * fx, visible.top + (visible.bottom - visible.top) * fy)
            .find((n) => !inToast(n));
          if (top && (top === el || el.contains(top))) painted = true;
        }
      if (!painted) continue;
      controls.push({
        label: (el.getAttribute('aria-label') || (el.textContent ?? '').trim().slice(0, 40) || el.id || el.tagName.toLowerCase()).trim(),
        zone: el.closest('header') && !el.closest('main') ? 'app-header' : el.closest('[data-testid="floating-nav"]') ? 'nav-pill' : el.closest('main') ? 'main' : 'chrome',
        box: visible,
        overlap: area(clip(visible, toastBox)),
      });
    }
    return {
      viewport: { width: innerWidth, height: innerHeight },
      scrollY: Math.round(scrollY),
      toastCount: toasts.length,
      toast: toastBox,
      controls,
    };
  });
}

const fmt = (b: Box) => `[${Math.round(b.left)},${Math.round(b.top)} → ${Math.round(b.right)},${Math.round(b.bottom)}]`;

function assertClear(geo: Geometry, tag: string, mustMeasure: string[]): void {
  const report = geo.controls
    .map((c) => `${c.zone.padEnd(10)} ${c.label.padEnd(34)} ${fmt(c.box)}${c.overlap > 0.5 ? `  OVERLAPS ${Math.round(c.overlap)}px²` : ''}`)
    .join('\n');
  console.log(`[${tag}] scrollY=${geo.scrollY} toast ${fmt(geo.toast)}\n${report}`);
  expect(geo.toastCount, 'exactly one toast').toBe(1);
  expect(geo.toast.top, 'toast inside viewport (top)').toBeGreaterThanOrEqual(0);
  expect(geo.toast.left, 'toast inside viewport (left)').toBeGreaterThanOrEqual(0);
  expect(geo.toast.right, 'toast inside viewport (right)').toBeLessThanOrEqual(geo.viewport.width);
  expect(geo.toast.bottom, 'toast inside viewport (bottom)').toBeLessThanOrEqual(geo.viewport.height);
  const labels = geo.controls.map((c) => c.label);
  for (const name of mustMeasure) expect(labels, `"${name}" was measured`).toContain(name);
  expect(geo.controls.filter((c) => c.zone === 'main').length, 'page content was measured').toBeGreaterThan(1);
  expect(
    geo.controls.filter((c) => c.overlap > 0.5).map((c) => `${c.zone} ${c.label} ${fmt(c.box)} ${Math.round(c.overlap)}px²`),
    `controls under the toast ${fmt(geo.toast)}\n${report}`
  ).toEqual([]);
}

/**
 * Scroll the way a USER does to reach a control that is off screen or under
 * the nav pill: just far enough that it sits fully in view — its bottom 8px
 * above the pill (or the viewport floor), its top 8px below the sticky header —
 * and no further. Not `scrollIntoView({ block: 'center' })`, and not
 * Playwright's own click-time scrolling, which centres a control it finds
 * obscured and so parks the form far higher than any user would. A control
 * already in view is not scrolled at all. Returns the resulting scrollY so the
 * action that follows can be proven not to have scrolled again.
 */
async function revealLikeAUser(page: Page, control: Locator): Promise<number> {
  await control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const pill = document.querySelector('[data-testid="floating-nav"]');
    const pillTop = pill && getComputedStyle(pill).display !== 'none' ? pill.getBoundingClientRect().top : innerHeight;
    const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
    // The app's `scroll-padding` (globals.css, WCAG 2.4.11 — a11y audit
    // 2026-09-29) makes the browser scroll a FOCUSED control until it is clear
    // of the sticky header / nav pill by that padding, so a control revealed
    // any less clear would be nudged by the click's own focus — the page's
    // doing, not the action under test. Honour it (it is 0 → the old 8px rule).
    const root = getComputedStyle(document.documentElement);
    const padTop = parseFloat(root.scrollPaddingTop) || 0;
    const padBottom = parseFloat(root.scrollPaddingBottom) || 0;
    const floor = Math.min(Math.min(pillTop, innerHeight) - 8, innerHeight - padBottom);
    const ceiling = Math.max(headerBottom + 8, padTop);
    let delta = 0;
    if (r.bottom > floor) delta = r.bottom - floor;
    else if (r.top < ceiling) delta = r.top - ceiling;
    if (delta !== 0) window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
  });
  return page.evaluate(() => Math.round(scrollY));
}

/**
 * Reveal like a user, then act — and fail if the action itself scrolled the page.
 *
 * What this guards against is the harness, not the app: Playwright's click-time
 * scrolling centres a control it finds obscured, a jump of tens to hundreds of
 * px that would park the form somewhere no user puts it and make every
 * measurement after it meaningless. So the page may not move at all.
 *
 * Zero holds for the Notes composer: its STICKY submit row sits 12 px above
 * the nav pill with 4 px bottom padding, so Post's bottom edge is exactly 16 px
 * clear — the root `scroll-padding` band (globals.css, WCAG 2.4.11) the
 * browser enforces on focus — and focusing it scrolls nothing. (It used to
 * rest 12 px clear, and every focus nudged the page 4 px that a sticky row can
 * never satisfy.) Not "the control stayed put": a failed save inserts its
 * inline alert above the Save button, which moves it without any scrolling.
 *
 * ProfilePage keeps a separate allowance (PROFILE_FOCUS_NUDGE_PX): at 360x640
 * focusing "Edit name" / the first-name field after the name form expands is
 * scrolled 1-4 px by the browser (measured 2026-10-14 over 12 repeats; varies
 * run to run, sub-pixel compact header, 681f53c). That is the page's own focus
 * scroll, not a harness jump, and it is not a sticky row.
 */
const SCROLL_NUDGE_PX = 0;
const PROFILE_FOCUS_NUDGE_PX = 4;
async function actInPlace(
  page: Page,
  control: Locator,
  act: () => Promise<void>,
  allowedPx: number = SCROLL_NUDGE_PX
): Promise<void> {
  const before = await revealLikeAUser(page, control);
  await act();
  const after = await page.evaluate(() => Math.round(scrollY));
  expect(
    Math.abs(after - before),
    `the action did not scroll the page (scrollY ${before} -> ${after}; allowed ${allowedPx}px)`
  ).toBeLessThanOrEqual(allowedPx);
}

/**
 * A form's own submit failure, reported INLINE: the `role="alert"` carrying the
 * copy is NOT a toast, sits in the same form as `fieldSelector`, is fully on
 * screen at the scroll the click left (below the sticky header, above the nav
 * pill or viewport floor), and does not hold focus — and no toast is on screen.
 */
async function assertInlineError(page: Page, alert: Locator, fieldSelector: string, tag: string): Promise<void> {
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(alert).toHaveCount(1);
  const geo = await alert.evaluate((el, sel) => {
    const r = el.getBoundingClientRect();
    const pill = document.querySelector('[data-testid="floating-nav"]');
    const pillTop = pill && getComputedStyle(pill).display !== 'none' ? pill.getBoundingClientRect().top : innerHeight;
    let form: Element | null = el.parentElement;
    while (form && !form.querySelector(sel)) form = form.parentElement;
    return {
      inToast: !!el.closest('[data-toast-region]'),
      withField: !!form && form !== document.body && !!form.closest('main'),
      sameFormDepth: form ? form.contains(el) && form.querySelectorAll('[role="alert"]').length === 1 : false,
      top: r.top,
      bottom: r.bottom,
      ceiling: document.querySelector('header')?.getBoundingClientRect().bottom ?? 0,
      floor: Math.min(pillTop, innerHeight),
      focused: el.contains(document.activeElement),
      scrollY: Math.round(scrollY),
    };
  }, fieldSelector);
  console.log(`[${tag}] inline alert ${JSON.stringify(geo)}`);
  expect(geo.inToast, 'the error is inline, not a toast').toBe(false);
  expect(geo.withField, `the error sits in the form holding ${fieldSelector}`).toBe(true);
  expect(geo.sameFormDepth, 'exactly one alert in that form').toBe(true);
  expect(geo.top, 'the error is below the header').toBeGreaterThanOrEqual(geo.ceiling);
  expect(geo.bottom, 'the error is above the nav pill / viewport floor').toBeLessThanOrEqual(geo.floor);
  expect(geo.focused, 'focus was not moved to the error').toBe(false);
  await expect(page.locator('[data-toast-region] > [data-toast]'), 'no toast over the page').toHaveCount(0);
}

async function pageSettled(page: Page): Promise<void> {
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await expect.poll(() => page.locator('main .animate-pulse').count(), { timeout: 10_000 }).toBe(0);
}

// --- real save failures (premium owner) ---------------------------------------
// The premium-gate half (free owner, every other page) is
// toast-page-gate-overlap.spec.ts: a persona forces its own worker, so it
// cannot share this file.
test.use({ persona: 'premiumOwner' });

test.describe('save failures', () => {
  for (const vp of VIEWPORTS) {
    test.describe(vp.label, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test('EditCirclePage: the failed "Save changes" toast covers no control', async ({ page, circleId }) => {
        await page.goto(`/circles/${circleId}/settings`, { waitUntil: 'domcontentloaded' });
        const field = page.locator('#recipient_name');
        await expect(field).not.toHaveValue('', { timeout: 20_000 });
        await pageSettled(page);
        await actInPlace(page, field, () => field.fill(uniqueLabel('TPO')));
        const save = page.getByRole('button', { name: 'Save changes', exact: true });
        const injected = await failRequest(page, 'PATCH', '/api/circles/:id', { status: 500, times: 1 });
        await actInPlace(page, save, () => save.click());
        await injected.expectHits(1);
        await expect(errorToast(page, "Couldn't save your changes. Please try again.")).toBeVisible({ timeout: 15_000 });
        await settledToast(page);
        assertClear(await measure(page), `${vp.label}] [EditCirclePage`, ['Save changes', 'Cancel']);
      });

      // These two forms report their OWN submit failure inline, not as a toast.
      // Measured at 360x640, no fixed toast band could clear them: scrolled just
      // far enough to reach the name form's Save, "Manage subscription" sat in
      // the 120-186px band; the Notes composer is 423px tall with only 371px
      // between the band and the nav pill, so the textarea was always covered.
      // So these prove, at every viewport, that the failure is announced
      // (role="alert") inside the form, on screen at the natural scroll, with
      // focus left alone — and that no toast is raised over the page at all.
      test('ProfilePage: the failed name save is reported inline in its form, never as a toast over the page', async ({ page }) => {
        await page.goto('/profile', { waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        const edit = page.getByRole('button', { name: 'Edit name', exact: true }).first();
        await actInPlace(page, edit, () => edit.click(), PROFILE_FOCUS_NUDGE_PX);
        const first = page.locator('#profile-first-name');
        await actInPlace(page, first, () => first.fill(uniqueLabel('TPO').slice(0, 40)), PROFILE_FOCUS_NUDGE_PX);
        const injected = await failRequest(page, 'PATCH', '/api/users/me', { status: 500, times: 1 });
        const save = page.getByRole('button', { name: 'Save', exact: true }).first();
        await actInPlace(page, save, () => save.click(), PROFILE_FOCUS_NUDGE_PX);
        await injected.expectHits(1);
        await assertInlineError(page, errorToast(page, "Couldn't save your changes. Please try again."), '#profile-first-name', `${vp.label}] [ProfilePage`);
      });

      test('NotesPage: the failed "Post" is reported inline in the composer, never as a toast over the page', async ({ page, circleId }) => {
        await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        const composer = page.getByLabel(/^Add a note/);
        await actInPlace(page, composer, () => composer.fill(uniqueLabel('TPO')));
        const injected = await failRequest(page, 'POST', '/api/circles/:id/care-notes', { status: 500, times: 1 });
        const post = page.getByRole('button', { name: 'Post', exact: true });
        await actInPlace(page, post, () => post.click());
        await injected.expectHits(1);
        await assertInlineError(page, errorToast(page, "Couldn't post your note. Your note is still here — try again."), 'textarea', `${vp.label}] [NotesPage`);
      });
    });
  }
});


// The Notes composer's failed-Post alert lives INSIDE its sticky submit row, so
// it is on screen whenever Post is. Narrowest phone and 200% text (WCAG 1.4.4):
// the alert must wrap inside the viewport, be painted (nothing on top of it —
// not the sticky row's own ground, not the nav pill), and describe Post.
test.describe('Notes composer failed-Post alert at 320px and 200% text', () => {
  for (const vp of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
  ]) {
    test(`${vp.width}x${vp.height}: the alert wraps, stays on screen and unobscured above Post`, async ({ page, circleId }) => {
      await page.setViewportSize(vp);
      await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
      await pageSettled(page);
      // Text-only 200% resize: the type scale is px tokens (globals.css), so
      // a root font-size change would not move them — double the tokens.
      await page.addStyleTag({
        content:
          ':root { --text-xs: 24px !important; --text-sm: 28px !important; --text-base: 36px !important; --text-lg: 48px !important; --text-xl: 64px !important; }',
      });
      const composer = page.getByLabel(/^Add a note/);
      await composer.fill(uniqueLabel('TPO'));
      const injected = await failRequest(page, 'POST', '/api/circles/:id/care-notes', { status: 500, times: 1 });
      const post = page.getByRole('button', { name: 'Post', exact: true });
      await post.click();
      await injected.expectHits(1);
      const alert = page.getByTestId('note-composer-footer').getByRole('alert');
      await expect(alert).toBeVisible({ timeout: 15_000 });
      await expect(post).toHaveAttribute('aria-describedby', (await alert.getAttribute('id')) ?? 'missing');
      // A failed post brings the alert into view if the sticky row was pinned
      // to the form's top edge with the alert hanging below the floor (the
      // page scrolls smoothly, so wait for it to settle).
      await expect
        .poll(() => alert.evaluate((el) => {
          const pill = document.querySelector('[data-testid="floating-nav"]');
          const floor = pill && getComputedStyle(pill).display !== 'none' ? pill.getBoundingClientRect().top : innerHeight;
          return el.getBoundingClientRect().bottom <= floor;
        }), { timeout: 5_000 })
        .toBe(true);
      const geo = await alert.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const pill = document.querySelector('[data-testid="floating-nav"]');
        const pillTop = pill && getComputedStyle(pill).display !== 'none' ? pill.getBoundingClientRect().top : innerHeight;
        const painted = [0.1, 0.5, 0.9].every((fx) =>
          [0.25, 0.75].every((fy) => {
            const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
            return !!hit && (hit === el || el.contains(hit));
          })
        );
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          lineCount: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight)),
          ceiling: document.querySelector('header')?.getBoundingClientRect().bottom ?? 0,
          floor: Math.min(pillTop, innerHeight),
          vw: document.documentElement.clientWidth,
          painted,
        };
      });
      console.log(`[notes alert ${vp.width}x${vp.height} @200%] ${JSON.stringify(geo)}`);
      expect(geo.left, 'alert inside the viewport (left)').toBeGreaterThanOrEqual(0);
      expect(geo.right, 'alert wraps inside the viewport (right)').toBeLessThanOrEqual(geo.vw);
      expect(geo.top, 'alert below the header').toBeGreaterThanOrEqual(geo.ceiling);
      expect(geo.bottom, 'alert above the nav pill / viewport floor').toBeLessThanOrEqual(geo.floor);
      expect(geo.painted, 'nothing is painted over the alert').toBe(true);
      const p = await post.boundingBox();
      expect(p && p.y >= geo.bottom, 'the alert sits above Post').toBe(true);
    });
  }
});
