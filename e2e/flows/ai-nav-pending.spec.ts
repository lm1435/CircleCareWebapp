import { test, expect } from '../fixtures';

// Desktop twin of e2e/mobile/nav-ai-pending.spec.ts: the sidebar's Assistant
// entry is disabled while the circle detail (and so AI access) is unresolved,
// then live. The detail response is held with route interception.

test('the sidebar Assistant entry is disabled while access resolves, then goes live', async ({
  page,
  circleId,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const detail = new RegExp(`/api/circles/${circleId}(\\?.*)?$`);
  await page.route(detail, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await gate;
    await route.fallback();
  });

  await page.goto(`/circles/${circleId}`, { waitUntil: 'domcontentloaded' });

  const entry = page.getByRole('button', { name: 'Assistant' }).first();
  await expect(entry).toBeVisible({ timeout: 15_000 });
  await expect(entry).toBeDisabled();
  await expect(entry).toHaveAttribute('aria-disabled', 'true');
  await entry.click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  release();

  await expect(entry).toBeEnabled({ timeout: 15_000 });
  await expect(entry).toHaveAttribute('aria-disabled', 'false');
});
