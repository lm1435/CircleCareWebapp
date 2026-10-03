import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { AUTH_ROUTES, circleRoutes } from './routes';
import { checkA11y, visitAndCheck } from './helpers';

// ===========================================================================
// WCAG 2.1 AA + 2.2 AA regression gate for the web companion
// (a11y audit 2026-09-29, docs/plans/a11y-audit-web-2026-09-29.md).
//
// smoke.spec.ts scans each route once, at the project's viewport, closed. That
// missed everything this file pins:
//   - the circle OVERVIEW route (`/circles/:id`) — not in `circleRoutes()`;
//   - every dialog and menu in its OPEN state;
//   - 320px (= 400% zoom of 1280, SC 1.4.10), where AppLayout laid out 14px
//     wider than the screen and clipped it, `/circles` hung Create circle off
//     the edge, and five overlapping 8 AM doses were ~21px targets (2.5.8);
//   - Spanish (`<html lang="es">`, translated titles, axe on ES copy);
//   - what axe cannot measure: focus trapped + Escape + focus returned to the
//     trigger, focus not obscured by the sticky header / floating nav
//     (2.4.11), the skip link on screen when focused, and focus not dropped
//     to <body> when Confirm is replaced by its Undo badge (2.4.3).
//
// Runs under the `chromium` project (picks up every e2e file by default) with
// each test setting its own viewport. `reducedMotion: 'reduce'` makes the
// page's smooth scrolling instant, so a geometry read after Tab is final.
// Uses the worker's own isolated account (`test`), because one check confirms
// a dose (then undoes it inside the 5s window).
// ===========================================================================

test.use({ contextOptions: { reducedMotion: 'reduce' } });

/** Every scan in this file gates on WCAG 2.2 AA too (e2e/helpers.ts `wcag22`). */
const WCAG22 = { wcag22: true } as const;

type RouteKey = string; // 'C' = the worker's circle
const CIRCLE_SUBS = circleRoutes('X').map((r) => r.split('/').pop() as string);
const ROUTES: RouteKey[] = [...AUTH_ROUTES, 'C', ...CIRCLE_SUBS.map((s) => `C/${s}`)];

function resolve(key: RouteKey, circleId: string): string {
  return key === 'C' ? `/circles/${circleId}` : key.startsWith('C/') ? `/circles/${circleId}/${key.slice(2)}` : key;
}

async function open(page: Page, route: string): Promise<void> {
  await visitAndCheck(page, route);
  // Authenticated chrome is up (AuthGuard resolved), so this is the route.
  await expect(
    page.getByRole('button', { name: 'Account', exact: true, includeHidden: true }).first()
  ).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
}

/**
 * SC 1.4.10 at 320 CSS px: no horizontal page scroll AND nothing painted past
 * the viewport edge. The second half matters: AppLayout's `overflow-x-clip`
 * hid the 14px overrun, so `scrollWidth` alone read as a pass while the
 * account menu and every card's right edge were cut off. Content inside its
 * own horizontal scroller (the week grid — 2D content, exempt) is skipped.
 */
async function expectReflow(page: Page, route: string): Promise<void> {
  const report = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) continue; // sr-only / collapsed
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      let a = el.parentElement;
      let inScroller = false;
      while (a && a !== document.body) {
        const ox = getComputedStyle(a).overflowX;
        if (ox === 'auto' || ox === 'scroll') {
          inScroller = true;
          break;
        }
        a = a.parentElement;
      }
      if (inScroller) continue;
      offenders.push(
        `<${el.tagName.toLowerCase()} class="${el.className.toString().slice(0, 60)}"> ${Math.round(r.left)}..${Math.round(r.right)} "${(el.innerText ?? '').slice(0, 30).replace(/\s+/g, ' ')}"`
      );
    }
    return { vw, scrollWidth: document.documentElement.scrollWidth, offenders: offenders.slice(0, 8) };
  });
  expect(report.scrollWidth, `${route}: page scrolls sideways at ${report.vw}px`).toBeLessThanOrEqual(report.vw);
  expect(report.offenders, `${route}: content painted past the ${report.vw}px viewport`).toEqual([]);
}

// ---------------------------------------------------------------------------
// 1) Every route, desktop and 320px: axe (2.0/2.1/2.2 A+AA + best practice),
//    a per-route <title>, and reflow at 320.
// ---------------------------------------------------------------------------
for (const width of [1280, 320]) {
  test.describe(`routes at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });
    for (const key of ROUTES) {
      test(`${key} — axe${width === 320 ? ' + reflow' : ''} + title`, async ({ page, circleId }, testInfo) => {
        const route = resolve(key, circleId);
        await open(page, route);
        await expect(page).toHaveTitle(/ · CircleCare$/);
        await checkA11y(page, `${route}@${width}`, testInfo, WCAG22);
        if (width === 320) await expectReflow(page, route);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// 2) Every dialog and menu, opened FROM THE KEYBOARD: axe on the open state,
//    role/modality/name, Tab stays inside a modal, Escape closes, and focus
//    goes back to the control that opened it (2.1.1, 2.1.2, 2.4.3, 4.1.2).
// ---------------------------------------------------------------------------
interface Opener {
  route: RouteKey;
  /** Accessible name of the trigger. */
  name: RegExp;
  kind: 'dialog' | 'menu';
  /** Viewport width (default 1280). 390 reaches the floating-nav chrome. */
  width?: number;
}

const OPENERS: Opener[] = [
  { route: '/circles', name: /^Create circle$/, kind: 'dialog' },
  { route: '/circles', name: /^Join a circle$/, kind: 'dialog' },
  { route: 'C', name: /^Account$/, kind: 'menu' },
  { route: 'C', name: /^Switch circle/, kind: 'menu' },
  { route: 'C/calendar', name: /^Add event$/, kind: 'dialog' },
  { route: 'C/meds', name: /^Add medication$/, kind: 'dialog' },
  { route: 'C/meds', name: /^View details for /, kind: 'dialog' },
  { route: 'C/meds', name: /^More actions for /, kind: 'menu' },
  { route: 'C/tasks', name: /^Add task$/, kind: 'dialog' },
  { route: 'C/tasks', name: /^Status: /, kind: 'menu' },
  { route: 'C/tasks', name: /^Sort: /, kind: 'menu' },
  { route: 'C/emergency', name: /^Share$/, kind: 'dialog' },
  { route: 'C/emergency', name: /^Edit medical information$/, kind: 'dialog' },
  { route: 'C/emergency', name: /^Add doctor$/, kind: 'dialog' },
  { route: 'C/emergency', name: /^Add contact$/, kind: 'dialog' },
  { route: 'C/emergency', name: /^Add insurance$/, kind: 'dialog' },
  { route: 'C/documents', name: /^Upload document$/, kind: 'dialog' },
  { route: 'C/vitals', name: /^Add reading$/, kind: 'dialog' },
  { route: 'C/members', name: /^Invite member$/, kind: 'dialog' },
  // The create menu: the sidebar's at desktop, the floating pill's AddMenu
  // (80%-white labels on its scrim) below xl.
  { route: 'C', name: /^New$/, kind: 'menu' },
  { route: 'C', name: /^New$/, kind: 'menu', width: 390 },
];

test.describe('dialogs and menus (keyboard)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  for (const opener of OPENERS) {
    test(`${opener.route} :: ${opener.name.source}${opener.width ? ` @${opener.width}` : ''}`, async ({ page, circleId }, testInfo) => {
      if (opener.width) await page.setViewportSize({ width: opener.width, height: 800 });
      const route = resolve(opener.route, circleId);
      await open(page, route);
      const trigger = page.getByRole('button', { name: opener.name }).first();
      await expect(trigger, `trigger ${opener.name} not found on ${route}`).toBeVisible();
      await trigger.focus();
      await page.keyboard.press('Enter');

      if (opener.kind === 'dialog') {
        const dialog = page.getByRole('dialog').last();
        await expect(dialog).toBeVisible();
        await expect(dialog).toHaveAttribute('aria-modal', 'true');
        await expect(dialog).toHaveAccessibleName(/\S/);
        await expect
          .poll(() => dialog.evaluate((d) => d.contains(document.activeElement)))
          .toBe(true);
        await checkA11y(page, `${route} [${opener.name.source} open]`, testInfo, WCAG22);
        // Focus trap: 30 Tabs never leave the dialog (a toast is the only
        // sanctioned exit — Modal.tsx routes Tab into it and back).
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press('Tab');
          const inside = await page.evaluate(() => {
            const modals = document.querySelectorAll('[aria-modal="true"]');
            const top = modals[modals.length - 1];
            const a = document.activeElement;
            return !!a && (top.contains(a) || !!a.closest('[data-toast-region]'));
          });
          expect(inside, `Tab #${i + 1} escaped the ${opener.name.source} dialog`).toBe(true);
        }
      } else {
        const menu = page.getByRole('menu').last();
        await expect(menu).toBeVisible();
        // Named by the control that opened it (not a generic "More actions").
        await expect(menu).toHaveAccessibleName(opener.name);
        await expect(page.getByRole('menuitem').first()).toBeFocused();
        await checkA11y(page, `${route} [${opener.name.source} open]`, testInfo, {
          ...WCAG22,
          include: '[role="menu"]',
        });
      }

      await page.keyboard.press('Escape');
      await expect(page.getByRole(opener.kind)).toHaveCount(0);
      await expect(trigger, 'focus did not return to the trigger').toBeFocused();
    });
  }
});

// ---------------------------------------------------------------------------
// 3) Spanish: <html lang="es"> (3.1.1), translated titles (2.4.2), axe on the
//    Spanish copy (longer strings are where contrast/overflow regress).
// ---------------------------------------------------------------------------
test.describe('Spanish', () => {
  test.use({ locale: 'es', viewport: { width: 1280, height: 800 } });
  test.beforeEach(async ({ page }) => {
    // Keep LanguageSync from flipping back to the account's saved language.
    await page.route('**/api/users/me', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      try {
        const res = await route.fetch();
        const body = await res.json();
        if (body?.data?.user) body.data.user.language = 'es';
        await route.fulfill({ response: res, json: body });
      } catch {
        await route.continue().catch(() => {});
      }
    });
  });
  for (const key of ROUTES) {
    test(`${key} — lang=es + axe`, async ({ page, circleId }, testInfo) => {
      const route = resolve(key, circleId);
      await visitAndCheck(page, route);
      await expect(page.locator('html')).toHaveAttribute('lang', /^es/, { timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Cuenta', exact: true, includeHidden: true }).first()).toBeAttached({ timeout: 20_000 });
      await expect(page).toHaveTitle(/ · CircleCare$/);
      await checkA11y(page, `${route} (es)`, testInfo, WCAG22);
    });
  }
});

// ---------------------------------------------------------------------------
// 4) What axe cannot see.
// ---------------------------------------------------------------------------
test.describe('keyboard', () => {
  // 2.4.11 Focus Not Obscured (Minimum): Tab through a long page at phone and
  // desktop size; every focused control must have some part on screen, not
  // under the sticky header or the floating nav pill.
  for (const viewport of [
    { width: 390, height: 700 },
    { width: 1280, height: 720 },
  ]) {
    for (const key of ['C', 'C/meds', 'C/emergency', 'C/notes', 'C/vitals', '/profile']) {
      test(`focus not obscured — ${key} @${viewport.width}`, async ({ page, circleId }) => {
        await page.setViewportSize(viewport);
        const route = resolve(key, circleId);
        await open(page, route);
        await page.locator('main').focus();
        const hidden: string[] = [];
        for (let i = 0; i < 40; i++) {
          await page.keyboard.press('Tab');
          const res = await page.evaluate(() => {
            const a = document.activeElement as HTMLElement | null;
            if (!a || a === document.body) return null;
            const b = a.getBoundingClientRect();
            const pts: Array<[number, number]> = [
              [b.left + 2, b.top + 2],
              [b.right - 2, b.top + 2],
              [b.left + 2, b.bottom - 2],
              [b.right - 2, b.bottom - 2],
              [(b.left + b.right) / 2, (b.top + b.bottom) / 2],
            ];
            const seen = pts.some(([x, y]) => {
              const e = document.elementFromPoint(x, y);
              return !!e && (e === a || a.contains(e) || e.contains(a));
            });
            return seen ? null : `${a.getAttribute('aria-label') ?? a.innerText?.slice(0, 30) ?? a.tagName} @y${Math.round(b.top)}`;
          });
          if (res) hidden.push(res);
        }
        expect(hidden, `${route}: focused controls fully hidden`).toEqual([]);
      });
    }
  }

  test('skip link is on screen when focused from a scrolled page, and lands in <main>', async ({ page, circleId }) => {
    await page.setViewportSize({ width: 390, height: 700 });
    await open(page, `/circles/${circleId}`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await skip.focus();
    const box = await skip.boundingBox();
    expect(box, 'focused skip link has no box').not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(700);
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main')).toBeFocused();
  });

  // 2.4.3: Confirm is replaced by its Undo badge; focus must not fall to
  // <body>. Undo is pressed inside the 5s window, so nothing is recorded.
  test('focus moves to Undo after Confirm, and back to the row after Undo', async ({ page, circleId }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, `/circles/${circleId}`);
    const confirm = page.getByRole('button', { name: /^Confirm / }).first();
    await expect(confirm, 'the seeded circle has a dose to confirm').toBeVisible();
    const med = ((await confirm.getAttribute('aria-label')) ?? '').replace(/^Confirm /, '');
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: `Undo ${med}` }).first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''))
      .toMatch(new RegExp(`${med.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  });

  // 2.5.8 in its worst case: the busiest 8 AM slot at 320px.
  test('calendar week chips are >= 24px apart at 320px', async ({ page, circleId }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await open(page, `/circles/${circleId}/calendar`);
    const widths = await page
      .locator('[role="gridcell"] button[data-event-type]')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(0);
    // Lane width + 2% gutter; a lane of >= 23px keeps centres >= 24px apart.
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(22);
  });
});
