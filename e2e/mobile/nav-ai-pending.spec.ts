import { test, expect } from '../fixtures';

// AI nav cell while access is RESOLVING (mobile 'reserve' parity): rendered,
// dimmed and inert, then live once the circle detail answers. Runs under the
// `mobile-chrome` project (the pill is below-xl only). The detail response is
// HELD with route interception, so the pending state is observable for as long
// as the test wants.

test('the AI pill cell is disabled while access resolves, then goes live', async ({
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

  const ai = page.getByTestId('floating-nav').getByRole('button', { name: 'AI', exact: true });
  await expect(ai).toBeVisible({ timeout: 15_000 });
  await expect(ai).toBeDisabled();
  await expect(ai).toHaveAttribute('aria-disabled', 'true');
  await expect(ai).toHaveAttribute('data-ai-state', 'pending');
  const pendingBox = await ai.boundingBox();

  // Inert: a forced click must neither open the assistant nor raise a prompt.
  await ai.click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  release();

  // The demo account's circles are premium-owned, so the cell resolves live.
  await expect(ai).toBeEnabled({ timeout: 15_000 });
  await expect(ai).toHaveAttribute('aria-disabled', 'false');
  await expect(ai).toHaveAttribute('data-ai-state', 'allowed');

  // No layout shift when it resolves.
  const liveBox = await ai.boundingBox();
  expect(liveBox?.width).toBeCloseTo(pendingBox?.width ?? -1, 0);
  expect(liveBox?.height).toBeCloseTo(pendingBox?.height ?? -1, 0);
  expect(liveBox?.x).toBeCloseTo(pendingBox?.x ?? -1, 0);
});
