import type { Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { sqlExec, sqlStr } from '../../db';

// ===========================================================================
// WEB CHECKOUT COUNTRY GATE — against the REAL backend and a REAL browser.
//
// The vitest suite proves `webCheckoutVerdict` in isolation. This proves the
// two signals it consumes actually arrive in a running app: the ACCOUNT zone
// from `GET /users/me`, and the BROWSER zone from the real Intl API (driven
// here by Playwright's `timezoneId`, which sets it at the context level the
// same way a user's machine would).
//
// Why it matters: on web we are merchant of record, so a single sale in an
// unregistered jurisdiction creates a VAT/GST obligation. The gate must refuse
// to render Subscribe unless BOTH zones are on the allowlist.
//
// Each test sets the persona's `users.timezone` directly and restores it
// afterwards, so the worker's persona is left exactly as it was found.
// ===========================================================================

test.use({ persona: 'freeOwner' });

const STORE_CARD = 'Subscribe in the CircleCare app';
const ERROR_CARD = "We couldn't load your account";

function setAccountZone(userId: string, zone: string): void {
  sqlExec(`update users set timezone = ${sqlStr(zone)} where id = ${sqlStr(userId)}::uuid`);
}

/** The gate let the user through: neither terminal card is on the page. */
async function expectGatePassed(page: Page): Promise<void> {
  // Either the paywall or RevenueCat's own "checkout unavailable" card is
  // acceptable here — whether the sandbox offering loads is not what this
  // spec is testing. What matters is that the GATE did not intervene.
  await expect(
    page.getByRole('heading', { name: /Unlock the full|Online checkout isn't available/ })
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(STORE_CARD)).toHaveCount(0);
  await expect(page.getByText(ERROR_CARD)).toHaveCount(0);
}

/** The gate blocked: store card, and no way to start a purchase. */
async function expectBlocked(page: Page): Promise<void> {
  await expect(page.getByText(STORE_CARD)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Subscribe', exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('Choose a plan')).toHaveCount(0);
}

test.describe('both zones allowlisted', () => {
  test.use({ timezoneId: 'America/Edmonton' });

  test('Calgary account on a Calgary machine reaches checkout', async ({
    page,
    personaHandle: h,
  }) => {
    // The real 2026-09-20 web sale came from Calgary. If the gate blocks this
    // zone it blocks the only paying web customer we have.
    setAccountZone(h.userId, 'America/Edmonton');
    await page.goto('/upgrade');
    await expectGatePassed(page);
  });
});

test.describe('allowlisted account, machine abroad', () => {
  test.use({ timezoneId: 'Europe/London' });

  test('US account used from London is sent to the app stores', async ({
    page,
    personaHandle: h,
  }) => {
    setAccountZone(h.userId, 'America/Denver');
    await page.goto('/upgrade');
    await expectBlocked(page);
    // The escape hatch must be reachable, not just the badges.
    await expect(page.getByRole('link', { name: /Email our support team/ })).toBeVisible();
  });
});

test.describe('account abroad, machine allowlisted', () => {
  test.use({ timezoneId: 'America/Denver' });

  test('Mexico City account on a Denver machine is still blocked', async ({
    page,
    personaHandle: h,
  }) => {
    setAccountZone(h.userId, 'America/Mexico_City');
    await page.goto('/upgrade');
    await expectBlocked(page);
  });

  test('an unenumerated zone blocks rather than falling through', async ({
    page,
    personaHandle: h,
  }) => {
    // Nobody listed Lagos anywhere. Under the old fail-open design this
    // rendered Subscribe; under the allowlist it must not.
    setAccountZone(h.userId, 'Africa/Lagos');
    await page.goto('/upgrade');
    await expectBlocked(page);
  });
});

test.describe('account details unreadable', () => {
  test.use({ timezoneId: 'America/Denver' });

  test('an account with no timezone shows retry, never the store card', async ({
    page,
    personaHandle: h,
  }) => {
    // NOT a network fault: aborting `/users/me` logs the user out, because it
    // is part of the auth bootstrap — the browser lands on the sign-in screen
    // and never reaches this page. The reachable "unreadable" state is a row
    // with no zone, which is a real production case: the column's
    // `America/New_York` default was dropped in 20260201100000, and mobile's
    // `syncDeviceSettings()` is best-effort and gives up quietly.
    sqlExec(`update users set timezone = null where id = ${sqlStr(h.userId)}::uuid`);

    await page.goto('/upgrade');

    await expect(page.getByText(ERROR_CARD)).toBeVisible({ timeout: 20_000 });
    // "We can't read it" must never be reported to the user as "you're
    // ineligible" — that would be telling them something false about their
    // account, and pushing a US customer to the app stores for a network blip.
    await expect(page.getByText(STORE_CARD)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

test.afterEach(async ({ personaHandle: h }) => {
  // Persona rows are worker-scoped and reused by later specs in the same slot.
  setAccountZone(h.userId, 'America/Denver');
});
