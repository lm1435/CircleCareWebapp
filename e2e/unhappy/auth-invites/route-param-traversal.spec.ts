import type { Page, Request } from '@playwright/test';
import { test, expect } from '../../fixtures';

// Web security audit 2026-10-01 (twin of the mobile deep-link finding).
//
// React Router DECODES `%2F` inside a path param, so `/circles/..%2F..%2Fx/notes`
// yields circleId `../../x`. The API modules interpolate circleId raw into
// `/circles/${circleId}/...`, and the browser resolves the dot segments, so the
// user's Bearer token went to a DIFFERENT backend path chosen by whoever wrote
// the link (client-side path traversal). A malformed id must stop at the route
// boundary: the "Circle not found" state, and no request built from it.

const PROBE = 'cspt-probe';

function apiPaths(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (req: Request) => {
    // The navigation itself carries the payload by definition; only requests
    // the APP built from the id matter.
    if (req.resourceType() === 'document') return;
    const bearer = req.headers()['authorization'] ? ' [Bearer]' : '';
    paths.push(`${new URL(req.url()).pathname}${bearer}`);
  });
  return paths;
}

const PAYLOADS = [
  // ../../cspt-probe -> https://api/<probe>/... (outside /api entirely)
  `/circles/..%2F..%2F${PROBE}/notes`,
  // ../<probe>?  -> the trailing route suffix is pushed into the query string
  `/circles/..%2F${PROBE}%3F/emergency`,
  // overview (index route)
  `/circles/..%2F..%2F${PROBE}`,
];

for (const path of PAYLOADS) {
  test(`a traversal circleId never leaves the route boundary: ${path}`, async ({ page }) => {
    const paths = apiPaths(page);
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('circle-access-lost')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Circle not found');
    // Give any effect-driven reads time to go out before asserting none did.
    await page.waitForTimeout(2_000);
    const escaped = paths.filter((p) => p.includes(PROBE));
    expect(escaped, `requests built from the traversal id: ${escaped.join(', ')}`).toEqual([]);
    expect(paths.filter((p) => p.includes('..'))).toEqual([]);
  });
}

test('a real circle id still loads normally (guard is not over-broad)', async ({ page, circleId }) => {
  await page.goto(`/circles/${circleId}/notes`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('circle-access-lost')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('circle-access-lost')).toHaveCount(0);
});
