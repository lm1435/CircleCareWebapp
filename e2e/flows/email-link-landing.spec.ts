import { test, expect } from '../fixtures';

// 1.3.1 email deep links: a link to something that is gone shows ONE shared
// "This was removed" state (never a blank page, a silent default or a toast), and
// a login in the middle of the trip keeps the whole link (query string included).
//
// Backend seeds nothing here: an unknown event id / an unknown circle id ARE the
// gone cases (GET /events/:id and GET /circles/:id answer NOT_FOUND).

const GONE_EVENT = '00000000-0000-4000-8000-00000000dead';
const NO_CIRCLE = '00000000-0000-4000-8000-00000000c1c1';

test.describe('email link landing: removed state', () => {
  test('calendar: a deleted event shows "This was removed" with the email context and the linked date; OK dismisses', async ({
    page,
    circleId,
  }) => {
    await page.goto(
      `/circles/${circleId}/calendar?date=2026-06-12&eventId=${GONE_EVENT}&src=weekly_digest`,
      { waitUntil: 'domcontentloaded' }
    );
    const removed = page.getByTestId('removed-state');
    await expect(removed).toBeVisible({ timeout: 20_000 });
    await expect(removed.getByRole('heading', { name: 'This was removed' })).toBeVisible();
    await expect(removed.getByText('It was deleted or is no longer scheduled.')).toBeVisible();
    await expect(removed.getByTestId('removed-state-context')).toHaveText(
      /^From your email · .*2026$/
    );
    // The page itself is still there (this is not a dead end).
    await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();

    await removed.getByRole('button', { name: 'OK' }).click();
    await expect(removed).toBeHidden();
  });

  test('calendar: the state is the same without src, minus the email line', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}/calendar?date=2026-06-12&eventId=${GONE_EVENT}`, {
      waitUntil: 'domcontentloaded',
    });
    const removed = page.getByTestId('removed-state');
    await expect(removed.getByRole('heading', { name: 'This was removed' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(removed.getByTestId('removed-state-context')).toHaveCount(0);
  });

  test('meds: a deleted medication shows the same state', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}/meds?medication=${GONE_EVENT}&src=weekly_digest`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('removed-state').getByRole('heading', { name: 'This was removed' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('daily update: a day outside the 7-day window shows the same state', async ({ page, circleId }) => {
    await page.goto(`/circles/${circleId}/daily-update/2020-01-01?src=weekly_digest`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('removed-state').getByRole('heading', { name: 'This was removed' })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('a circle the user cannot open: "You no longer have access", "See your circles" goes to the list', async ({
    page,
  }) => {
    await page.goto(`/circles/${NO_CIRCLE}/calendar?src=weekly_digest`, {
      waitUntil: 'domcontentloaded',
    });
    const removed = page.getByTestId('removed-state');
    await expect(removed).toBeVisible({ timeout: 20_000 });
    await expect(removed.getByRole('heading', { level: 1, name: 'This was removed' })).toBeVisible();
    await expect(removed.getByText('You no longer have access to this circle.')).toBeVisible();
    await expect(removed.getByTestId('removed-state-context')).toHaveText('From your email');
    await expect(removed.getByRole('button', { name: 'OK' })).toHaveCount(0);

    await removed.getByRole('link', { name: 'See your circles' }).click();
    await expect(page).toHaveURL(/\/circles(\?.*)?$/);
  });
});

test.describe('email link landing: login keeps the whole link', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('signed out: /login, then back to the SAME path + query (and the removed state resolves from it)', async ({
    page,
    circleId,
    account,
  }) => {
    const target = `/circles/${circleId}/calendar?date=2026-06-12&eventId=${GONE_EVENT}&src=weekly_digest`;
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });

    await page.getByLabel(/^Email/).fill(account.email);
    await page.getByLabel(/^Password/).fill(account.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    // Back on the calendar with the email tag intact. (eventId/date are scrubbed
    // once the page has handled them, so the proof they survived the login is
    // that the removed state — built from them — is on screen.)
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}/calendar\\?.*src=weekly_digest`), {
      timeout: 30_000,
    });
    const removed = page.getByTestId('removed-state');
    await expect(removed).toBeVisible({ timeout: 20_000 });
    await expect(removed.getByTestId('removed-state-context')).toHaveText(/^From your email · .*2026$/);
  });
});
