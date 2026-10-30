import type { Page } from '@playwright/test';
import { expect } from './fixtures';

// THE NEXT-STEP CARD IS ROLE-AWARE (it replaced the Get-started checklist and its intro).
//
// Today (docs/plans/simple-ui-1-3-1.md) shows ONE coaching card: the next of three steps
// (add the first medication, invite someone, turn on reminders), each only while not done.
// Roles decide which steps exist: the OWNER can do all three ("Next step · 1 of 3"), a
// caregiver who JOINED cannot invite ("1 of 2"), and a view-only seat is shown no card at all
// (it could act on no step). Copy never assumes relatives.
//
// Roles come from the REAL backend (GET /circles/:id -> owner_id, can_edit, view_only, members)
// for each persona. Only the "does this circle have a medication yet?" read is answered empty,
// because every persona circle is a clone of the fully-populated demo circle, where step 1 is
// (correctly) done. The fake answer is what a brand-new circle returns.

export const CARD = '[data-testid="next-step-card"]';

/** Answer the presence read as an empty circle; return the circle's recipient name once Today is up. */
export async function openEmptyHome(page: Page, circleId: string): Promise<string> {
  await page.route(`**/api/circles/${circleId}/events/presence**`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: { success: true, data: { medication: false, appointment: false, task: false } },
        })
      : route.continue()
  );
  const detail = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/circles/${circleId}`,
    { timeout: 20_000 }
  );
  await page.goto(`/circles/${circleId}`);
  const res = await detail;
  expect(res.status(), `GET /api/circles/${circleId}`).toBe(200);
  const body = (await res.json()) as { data: { circle: { recipient_name: string } } };
  // Today is rendered (header + Quick access); the card, if any, decides on the same presence read.
  await expect(page.getByTestId('quick-access-grid')).toBeVisible({ timeout: 20_000 });
  return body.data.circle.recipient_name;
}
