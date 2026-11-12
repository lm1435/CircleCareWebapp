import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { checkA11y, visitAndCheck } from './helpers';

// ===========================================================================
// One page title (owner 2026-11-11): every page's single <h1> is 32px / 600 and
// renders through PageMasthead; the second level (the Calendar day heading) is
// 24px / 600. jsdom has no layout, so the sizes are measured here, in Chromium.
// ===========================================================================

test.use({ contextOptions: { reducedMotion: 'reduce' } });

const ROUTES: Array<{ name: string; path: (c: string) => string }> = [
  { name: 'Today', path: (c) => `/circles/${c}` },
  { name: 'Calendar', path: (c) => `/circles/${c}/calendar` },
  { name: 'Meds', path: (c) => `/circles/${c}/meds` },
  { name: 'Tasks', path: (c) => `/circles/${c}/tasks` },
  { name: 'Notes', path: (c) => `/circles/${c}/notes` },
  { name: 'Activity', path: (c) => `/circles/${c}/activity` },
  { name: 'Emergency', path: (c) => `/circles/${c}/emergency` },
  { name: 'Documents', path: (c) => `/circles/${c}/documents` },
  { name: 'Vitals', path: (c) => `/circles/${c}/vitals` },
  { name: 'Members', path: (c) => `/circles/${c}/members` },
  { name: 'Settings sub-page', path: () => '/profile/quietHours' },
  { name: 'Help', path: () => '/help' },
];

async function measure(page: Page) {
  const h1 = page.getByRole('heading', { level: 1 });
  await expect(h1).toHaveCount(1, { timeout: 20_000 });
  return h1.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      size: parseFloat(cs.fontSize),
      weight: Number(cs.fontWeight),
      lineHeight: parseFloat(cs.lineHeight),
      oneLine: el.getBoundingClientRect().height <= parseFloat(cs.lineHeight) + 1,
    };
  });
}

test.describe('page titles are one style', () => {
  for (const route of ROUTES) {
    test(`${route.name}: one h1, 32/600/38`, async ({ page, circleId }, testInfo) => {
      const url = route.path(circleId);
      await visitAndCheck(page, url);
      const m = await measure(page);
      expect(m.size).toBe(32);
      expect(m.weight).toBe(600);
      expect(m.lineHeight).toBe(38);
      await checkA11y(page, `${url} (page title)`, testInfo);
    });
  }

  test('Calendar: the day heading is the 24/600 second level, h1 one line at 390px and the heading wraps without clipping', async ({
    page,
    circleId,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await visitAndCheck(page, `/circles/${circleId}/calendar`);
    const m = await measure(page);
    expect(m.size).toBe(32);
    expect(m.oneLine).toBe(true);
    const day = page.getByTestId('day-view-title');
    await expect(day).toBeVisible({ timeout: 20_000 });
    const d = await day.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        size: parseFloat(cs.fontSize),
        weight: Number(cs.fontWeight),
        tag: el.tagName,
        clipped: el.scrollWidth > el.clientWidth + 1,
      };
    });
    // The day heading shares its row with Today and the arrows, so on a phone it WRAPS (owner:
    // wrap, never truncate): it must not clip.
    expect(d).toMatchObject({ size: 24, weight: 600, tag: 'H2', clipped: false });
  });
});
