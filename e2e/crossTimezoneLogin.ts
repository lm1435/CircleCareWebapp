import { expect, type Page } from '@playwright/test';
import { TZ_FRAME_SEED } from './crossTimezoneSeed';
import { sqlRows, sqlStr } from './db';

// ===========================================================================
// LOGGING IN AS THE CROSS-TIMEZONE CIRCLE OWNER
// ===========================================================================
//
// Shared by every spec that needs a circle whose CARE RECIPIENT lives in
// another zone — `flows/timezone-frame.spec.ts` (conversion disclosure) and
// `flows/midnight-straddle.spec.ts` (the recipient's day vs the viewer's).
//
// Extracted rather than copied. The suite already carries one lesson about
// duplicated helpers drifting apart (mobile's two step indicators: the same
// truncation defect was fixed in one copy and survived a release in the other),
// and the login sequence below is the fiddly part — the auto-redirect race in
// `openCircle` in particular.
//
// The seed itself is created by globalSetup (`crossTimezoneSeed.ts`); nothing
// here writes.
// ===========================================================================

export const PASSWORD = process.env.PW_DEMO_PASSWORD ?? 'DemoPass123!';

/** The account these helpers sign in as, and the zone its recipient lives in. */
export const CROSS_TZ = {
  ownerEmail: TZ_FRAME_SEED.ownerEmail,
  recipientZone: TZ_FRAME_SEED.recipientZone,
  circleName: TZ_FRAME_SEED.circleName,
} as const;

/**
 * Fail (never skip) unless the database holds the cross-timezone circle: the
 * owner must own exactly one live circle whose care recipient is in
 * `CROSS_TZ.recipientZone`. Called per test rather than from a `beforeAll`,
 * whose failure would mark the rest of the file "did not run" instead of
 * failed.
 */
export function requireCrossTimezoneSeed(): void {
  let zones: string[];
  try {
    zones = sqlRows<{ zone: string }>(
      `select r.timezone as zone
         from public.users o
         join care_circles c on c.owner_id = o.id and c.archived_at is null
         join circle_memberships m on m.circle_id = c.id and m.is_care_recipient
         join public.users r on r.id = m.user_id
        where o.email = ${sqlStr(CROSS_TZ.ownerEmail)}`
    ).map((row) => row.zone);
  } catch (err) {
    throw new Error(
      `cross-timezone seed: cannot read it from PW_DB_URL ` +
        `(${err instanceof Error ? err.message.split('\n')[0] : String(err)}). Start the local stack.`
    );
  }
  expect(
    zones,
    `cross-timezone seed missing or wrong: ${CROSS_TZ.ownerEmail} must own ONE live circle whose care ` +
      `recipient is in ${CROSS_TZ.recipientZone}. globalSetup creates it (e2e/crossTimezoneSeed.ts) when ` +
      `the run includes the chromium project and PW_DB_URL/PW_SUPABASE_URL are local — look for its ` +
      `"[e2e tz-seed]" line in the run output.`
  ).toEqual([CROSS_TZ.recipientZone]);
}

export async function loginAs(page: Page, email: string = CROSS_TZ.ownerEmail): Promise<void> {
  requireCrossTimezoneSeed();
  await page.goto('/login');
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(PASSWORD);
  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/auth/login'),
      { timeout: 15_000 }
    ),
    page.getByRole('button', { name: /sign in/i }).click(),
  ]);
  expect(
    loginResponse.status(),
    `login as ${email} failed (${loginResponse.status()}): the seed exists, so check its password ` +
      `(PW_DEMO_PASSWORD) and the backend`
  ).toBe(200);
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

export const CIRCLE_URL = /\/circles\/[0-9a-f-]{36}/;

/**
 * Land on the owner's only circle and return its id.
 *
 * A user with a single circle is auto-redirected straight into it
 * (CirclePickerPage.tsx's single-circle `useEffect`; CircleCard.tsx's own
 * comment confirms the picker grid "only ever renders when there are 2+
 * circles"). That redirect fires client-side after the circles query
 * resolves, so `waitForURL` past `/login` can land on the picker for a
 * moment before it navigates again — check for the circle URL first, give
 * the auto-redirect a beat to happen, and only then fall back to clicking a
 * card (for a seed that ever grows a second circle for this owner). The
 * card's `aria-label` composes role/med-status text around the circle name
 * (CircleCard.tsx `cardLabel`), so matching by `href` + the seeded circle's
 * name is more robust than depending on that composed sentence.
 */
export async function openCircle(page: Page): Promise<string> {
  const onCircle = (): boolean => CIRCLE_URL.test(page.url());

  if (!onCircle()) {
    await page.waitForURL(CIRCLE_URL, { timeout: 5_000 }).catch(() => {});
  }
  if (!onCircle()) {
    const card = page
      .locator('a[href^="/circles/"]')
      .filter({ hasText: new RegExp(CROSS_TZ.circleName.split(' ').pop() ?? '', 'i') });
    await expect(card.first()).toBeVisible({ timeout: 20_000 });
    await card.first().click();
    await page.waitForURL(CIRCLE_URL, { timeout: 20_000 });
  }
  return new URL(page.url()).pathname.split('/')[2];
}

/**
 * Load a circle-scoped path and wait until the app KNOWS the recipient's zone.
 *
 * `useCircle` resolves `timezone` from GET /circles/:id and reports `null`
 * until it lands. Every date-anchored read on the page is gated on that — so a
 * spec that asserted before this response arrived would be asserting about a
 * page that had not yet asked anything.
 */
export async function gotoCircleWithRecipientZone(
  page: Page,
  circleId: string,
  path = ''
): Promise<void> {
  const detail = page.waitForResponse(
    (r) =>
      r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/circles/${circleId}`,
    { timeout: 20_000 }
  );
  await page.goto(`/circles/${circleId}${path}`, { waitUntil: 'domcontentloaded' });
  const res = await detail;
  expect(res.status(), 'GET /circles/:id').toBe(200);
  expect(await res.text(), 'circle detail carries the recipient zone').toContain(
    `"care_recipient_timezone":"${CROSS_TZ.recipientZone}"`
  );
}
