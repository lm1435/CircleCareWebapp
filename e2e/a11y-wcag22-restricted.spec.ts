import { test, expect } from './fixtures';
import { checkA11y, visitAndCheck } from './helpers';

// a11y audit 2026-09-29: the RESTRICTED circle card (frozen after a downgrade)
// dimmed its whole body with `opacity-70` — caption 3.94:1, "Read-only" badge
// 2.96:1 (SC 1.4.3). The main crawl runs as a premium owner, whose cards are
// never restricted, so only this persona renders that card. One persona per
// file (e2e/personas.ts: `persona` is a worker option).
test.use({ persona: 'frozenCircleOwner', contextOptions: { reducedMotion: 'reduce' } });

for (const width of [1280, 320]) {
  test(`/circles with a restricted card — axe @${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await visitAndCheck(page, '/circles');
    await expect(page.locator('a[data-restricted="true"]').first()).toBeVisible({ timeout: 20_000 });
    await checkA11y(page, `/circles (restricted)@${width}`, testInfo, { wcag22: true });
  });
}

// A frozen owner is back on the FREE plan, so these render the free-state
// upgrade surfaces the premium crawl never sees (Profile's upgrade card, the
// Upgrade page's plan picker).
for (const route of ['/profile', '/upgrade']) {
  for (const width of [1280, 320]) {
    test(`${route} (free state) — axe @${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      await visitAndCheck(page, route);
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
      await checkA11y(page, `${route} (free)@${width}`, testInfo, { wcag22: true });
    });
  }
}
