import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures';

// A PAGE-LEVEL TOAST MUST NOT COVER THE PAGE'S CONTROLS — the premium gate, on
// every page, at scroll 0.
//
// The companion toast-page-overlap.spec.ts raises real save failures on
// EditCirclePage, ProfilePage and the Notes composer. This file covers the rest
// of the app's pages with the TALLEST page toast there is: the free-tier AI
// entry raises the premium gate — a clamped two-line message plus an "Upgrade"
// action. The entry is DISPATCHED (sidebar "Assistant" from 1024px, the nav
// pill's "AI" below), so nothing scrolls on the way and the page stays exactly
// where it loaded. With the toast's entrance animation finished, its FULL box
// is intersected with the full visible box of every interactive element on the
// page — app header, sidebar or nav pill, and <main>. Any shared area fails.

test.use({ persona: 'freeOwner' });
test.setTimeout(60_000);

const VIEWPORTS = [
  { label: 'desktop 1280x720', width: 1280, height: 720 },
  { label: 'desktop 1440x900', width: 1440, height: 900 },
  { label: 'tablet 1024x768', width: 1024, height: 768 },
  { label: 'phone 390x844', width: 390, height: 844 },
  { label: 'phone 360x640', width: 360, height: 640 },
];

const GATE_PAGES = [
  { name: 'Overview', sub: '' },
  { name: 'Calendar', sub: 'calendar' },
  { name: 'Tasks', sub: 'tasks' },
  { name: 'Emergency', sub: 'emergency' },
  { name: 'Members', sub: 'members' },
  { name: 'Documents', sub: 'documents' },
];
const GATE_COPY = "That feature isn't included in the free plan. Upgrade to Premium to unlock it for your whole circle.";

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

async function pageSettled(page: Page): Promise<void> {
  await expect(page.locator('main h1').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);
  await expect.poll(() => page.locator('main .animate-pulse').count(), { timeout: 10_000 }).toBe(0);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.label, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const p of GATE_PAGES) {
      test(`${p.name}: the two-line "Upgrade" toast at scroll 0 covers no control`, async ({ page, circleId }) => {
        await page.goto(`/circles/${circleId}${p.sub ? `/${p.sub}` : ''}`, { waitUntil: 'domcontentloaded' });
        await pageSettled(page);
        expect(await page.evaluate(() => scrollY), 'the page is at its natural (load) scroll').toBe(0);

        const entry = page.getByRole('button', { name: vp.width >= 1024 ? 'Assistant' : 'AI', exact: true });
        await expect(entry).toHaveCount(1);
        await entry.dispatchEvent('click');

        const toast = page.getByRole('status').filter({ hasText: GATE_COPY });
        await expect(toast).toBeVisible({ timeout: 15_000 });
        await expect(toast.getByRole('button', { name: 'Upgrade', exact: true })).toBeVisible();
        await settledToast(page);
        const geo = await measure(page);

        const report = geo.controls
          .map((c) => `${c.zone.padEnd(10)} ${c.label.padEnd(34)} ${fmt(c.box)}${c.overlap > 0.5 ? `  OVERLAPS ${Math.round(c.overlap)}px²` : ''}`)
          .join('\n');
        console.log(`[${vp.label}] [${p.name} gate] scrollY=${geo.scrollY} toast ${fmt(geo.toast)}\n${report}`);

        expect(geo.scrollY, 'still at scroll 0').toBe(0);
        expect(geo.toastCount, 'exactly one toast').toBe(1);
        expect(geo.toast.top, 'toast inside viewport (top)').toBeGreaterThanOrEqual(0);
        expect(geo.toast.left, 'toast inside viewport (left)').toBeGreaterThanOrEqual(0);
        expect(geo.toast.right, 'toast inside viewport (right)').toBeLessThanOrEqual(geo.viewport.width);
        expect(geo.toast.bottom, 'toast inside viewport (bottom)').toBeLessThanOrEqual(geo.viewport.height);
        // The measurement saw the page's chrome and content, not an empty list.
        expect(geo.controls.filter((c) => c.zone === 'app-header').length, 'app header measured').toBeGreaterThan(0);
        expect(geo.controls.filter((c) => c.zone === 'main').length, 'page content measured').toBeGreaterThan(0);
        expect(
          geo.controls.filter((c) => c.overlap > 0.5).map((c) => `${c.zone} ${c.label} ${fmt(c.box)} ${Math.round(c.overlap)}px²`),
          `controls under the toast ${fmt(geo.toast)}\n${report}`
        ).toEqual([]);
      });
    }
  });
}
