import type { Page } from '@playwright/test';
import { expect } from './fixtures';

// THE GET-STARTED CARD'S INTRO IS ROLE-AWARE.
//
// Mobile told a caregiver who JOINED someone else's circle "You've created a
// care circle for …". Only the owner created it. Web and mobile now share four
// sentences (owner / self-care owner / joined / joined-as-recipient), and a
// view-only seat is never shown the card at all (it could act on no step).
//
// Roles come from the REAL backend (GET /circles/:id → owner_id, can_edit,
// view_only, members) for each persona. Only the two "is this circle set up?"
// reads are answered empty, because every persona circle is a clone of the
// fully-populated demo circle, on which the card is (correctly) complete and
// hidden. The fake answers are what a brand-new circle returns.

export const CARD = '[role="region"][aria-label="Get started"]';
export const MEDS_CARD = 'section[aria-labelledby="todays-meds-heading"]';

/** Answer the presence + emergency reads as an empty circle; return the circle's recipient name. */
export async function openEmptyHome(page: Page, circleId: string): Promise<string> {
  await page.route(`**/api/circles/${circleId}/events/presence**`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: { success: true, data: { medication: false, appointment: false, task: false } },
        })
      : route.continue()
  );
  await page.route(`**/api/circles/${circleId}/emergency-info`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { success: true, data: { emergency_info: null, versions: null } } })
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
  await expect(page.locator(MEDS_CARD)).toBeVisible({ timeout: 20_000 });
  return body.data.circle.recipient_name;
}

