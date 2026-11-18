import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { runScopedEmail } from '../isolation';
import { dbCount, dbQuery, generateSignupOtp, sqlStr } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createScopedAccount,
  ownerApi,
  stubJson,
  typeOtp,
  uniq,
} from '../unhappy/auth-invites/_helpers';

// FIRST RUN v2 (1.4.3, docs/mocks-144/first-run-v2/plan.md), web, end to end against the real
// backend. Positive and negative cases, named:
//
//   EMAIL PATH   /signup -> "Who are you caring for?" -> Create account (no Confirm password) -> the
//                code (auto-submits on the sixth digit) -> the circle forms by itself -> the first
//                item (the real form, type switch, Medication at 8:00 AM) -> All set -> Go to Today
//   APPOINTMENT / TASK first: opens on 9:00 AM, TOMORROW once 9:00 has passed on the circle's clock
//   SELF-CARE    "It's for me"
//   ALL SET      Copy invite link (one link invite, no email) and Go to Today
//   INVITED      an invite link never shows the question and never makes a circle
//   REDUCED MOTION + axe on the new screens
//
// Needs a backend started with EMAIL_BLOCKED_DOMAINS=circlecare.test (e2e/README.md): the signup
// answers a fake 200 and `generateSignupOtp` creates the account and its code, so nothing is emailed.

test.use({ storageState: { cookies: [], origins: [] } });

const PASSWORD = 'Str0ng!Passw0rd';

async function stubDrugs(page: Page): Promise<void> {
  await stubJson(page, 'GET', '/api/drugs/search', { body: { success: true, data: { drugs: [] } } });
}

function userIdOf(email: string): string {
  const rows = dbQuery<{ id: string }>(`select id from public.users where email = ${sqlStr(email.toLowerCase())}`);
  expect(rows, `public.users row for ${email}`).toHaveLength(1);
  return rows[0].id;
}

function ownedCircles(userId: string): Array<{ id: string; recipient_name: string; is_self_care: boolean }> {
  return dbQuery(
    `select id, recipient_name, is_self_care from care_circles where owner_id = ${sqlStr(userId)}::uuid`
  );
}

/** The one question, answered with a name. */
async function answerWho(page: Page, name: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Who are you caring for?' })).toBeVisible({
    timeout: 20_000,
  });
  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true });
  // NEGATIVE: an empty name blocks.
  await expect(continueBtn).toBeDisabled();
  await page.getByLabel(/^Their name or what you call them/).fill('   ');
  await expect(continueBtn).toBeDisabled();
  await page.getByLabel(/^Their name or what you call them/).fill(name);
  await expect(page.getByTestId('first-run-who-preview')).toContainText(`${name}'s circle`);
  await continueBtn.click();
}

/** /signup (the email path) through to the circle forming. Returns the new account's email. */
async function signUpByEmail(
  page: Page,
  answer: (page: Page) => Promise<void>,
  recipientNames: string[] = []
): Promise<string> {
  const email = runScopedEmail(uniq('fr2-owner'));
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await answer(page);
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 20_000 });
  // Owner, locked: no "Confirm password".
  await expect(page.locator('#confirmPassword')).toHaveCount(0);
  await page.locator('#first_name').fill('Maria');
  await page.locator('#last_name').fill('Lopez');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#termsAccepted').check({ force: true });
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 20_000 });
  // NEGATIVE: waiting for the code, the answer lives in memory only, never in web storage.
  const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
  for (const name of recipientNames) expect(stored).not.toContain(name);
  const otp = await generateSignupOtp(email, PASSWORD);
  await typeOtp(page, otp); // auto-submits on the sixth digit: no Verify press
  return email;
}

async function waitForFirstItemForm(page: Page): Promise<void> {
  await expect(page.getByTestId('first-run-circle-moment')).toBeVisible({ timeout: 30_000 });
  await page.waitForURL(/\/circles\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole('tablist')).toBeVisible({ timeout: 30_000 });
}

test.describe('first run v2 (web)', () => {
  test('POSITIVE email path, medication first: one question, no confirm, code auto-submits, circle forms, 8:00 AM, All set, Go to Today', async ({
    page,
  }, testInfo) => {
    test.slow();
    await stubDrugs(page);
    const recipient = uniq('Rosa').slice(0, 30);
    const email = await signUpByEmail(page, (p) => answerWho(p, recipient), [recipient]);

    await expect(page.getByText(`${recipient}'s circle is ready.`)).toBeVisible({ timeout: 30_000 });
    await waitForFirstItemForm(page);
    // The form opens on Medication with 8:00 AM Morning picked.
    await expect(page.getByRole('tab', { name: 'Medication' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('checkbox', { name: /Morning/ })).toBeChecked();
    await expect(page.getByRole('tab', { name: /Shift/ })).toHaveCount(0);
    await page.getByRole('combobox', { name: /^Medication name/ }).fill('Metformin');
    await page.getByTestId('add-event-save').click();

    const allSet = page.getByTestId('first-run-all-set');
    await expect(allSet).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('first-run-all-set-title')).toHaveText(`${recipient}'s 8:00 AM reminder is set.`);
    await expect(page.getByTestId('first-run-all-set-row-reminders')).toContainText('Reminders arrive on your phone');
    await checkA11y(page, 'first-run all set', testInfo);

    const userId = userIdOf(email);
    const circles = ownedCircles(userId);
    expect(circles, 'exactly ONE circle, named from the question').toHaveLength(1);
    expect(circles[0].recipient_name).toBe(recipient);
    const meds = dbQuery<{ scheduled_time: string }>(
      `select scheduled_time::text from calendar_events where circle_id = ${sqlStr(circles[0].id)}::uuid and event_type = 'medication' and parent_event_id is null`
    );
    expect(meds.map((m) => m.scheduled_time)).toEqual(['08:00:00']);

    await page.getByTestId('first-run-go-to-today').click();
    // A new free owner: the onboarding paywall shows once, then Today. Either is the way out.
    await expect(page).toHaveURL(/\/(upgrade|circles\/[0-9a-f-]{36})$/, { timeout: 20_000 });
    // NEGATIVE: after the circle exists and through the paywall hand-off, still never in web storage.
    const stored = await page.evaluate(() => JSON.stringify({ ...sessionStorage }) + JSON.stringify({ ...localStorage }));
    expect(stored).not.toContain(recipient);
  });

  for (const kind of ['Appointment', 'Task'] as const) {
    test(`POSITIVE ${kind.toLowerCase()} first: opens on 9:00 AM (tomorrow once 9:00 has passed), saves, All set names it`, async ({
      page,
      context,
      baseURL,
    }) => {
      test.slow();
      const account = await createScopedAccount(`fr2-${kind.toLowerCase()}`);
      await cookieLogin(context, account, baseURL);
      // An existing account with no circle: "Start a care circle" -> the one question.
      await page.goto('/circles', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Start a care circle', exact: true }).click();
      const recipient = uniq('Ana').slice(0, 30);
      await answerWho(page, recipient);
      await waitForFirstItemForm(page);

      await page.getByRole('tab', { name: kind }).click();
      const prefix = kind === 'Appointment' ? 'appt' : 'task';
      await expect(page.getByRole('radio', { name: 'Pick a time' })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId(`${prefix}-from-tile`)).toContainText('9:00 AM');
      await page.locator('#title').fill(kind === 'Appointment' ? 'Doctor visit' : 'Call pharmacy');
      await page.getByTestId('add-event-save').click();

      await expect(page.getByTestId('first-run-all-set-title')).toHaveText(
        `${recipient}'s ${kind.toLowerCase()} is saved.`,
        { timeout: 20_000 }
      );
      const circleId = ownedCircles(account.userId)[0].id;
      const rows = dbQuery<{ scheduled_time: string; future: boolean }>(
        `select ce.scheduled_time::text as scheduled_time,
                ((ce.scheduled_date + ce.scheduled_time)
                   at time zone coalesce(cc.timezone, u.timezone, 'America/New_York')) > now() as future
           from calendar_events ce
           join care_circles cc on cc.id = ce.circle_id
           join users u on u.id = cc.owner_id
          where ce.circle_id = ${sqlStr(circleId)}::uuid and ce.event_type = ${sqlStr(kind.toLowerCase())}
            and ce.parent_event_id is null`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].scheduled_time).toBe('09:00:00');
      // NEGATIVE: never a 9:00 AM that is already late the moment it is saved.
      expect(rows[0].future, '9:00 AM today if still ahead, else 9:00 AM tomorrow').toBe(true);
    });
  }

  test('POSITIVE self-care: "It\'s for me" makes a self-care circle and speaks as "you"', async ({ page }) => {
    test.slow();
    await stubDrugs(page);
    const email = await signUpByEmail(page, async (p) => {
      await expect(p.getByRole('heading', { level: 1, name: 'Who are you caring for?' })).toBeVisible({
        timeout: 20_000,
      });
      await p.getByRole('button', { name: "It's for me" }).click();
      await expect(p.getByText('This saves your circle to your account.')).toBeVisible();
    });
    await expect(page.getByText('Your circle is ready.')).toBeVisible({ timeout: 30_000 });
    await waitForFirstItemForm(page);
    await expect(page.getByTestId('first-run-form-heading')).toContainText('YOUR FIRST MED');
    const circles = ownedCircles(userIdOf(email));
    expect(circles).toHaveLength(1);
    expect(circles[0].is_self_care).toBe(true);
  });

  test('POSITIVE All set -> Copy invite link makes ONE link invite (no email), the seat fills; NEGATIVE a second press reuses it', async ({
    page,
    context,
    baseURL,
  }) => {
    test.slow();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    // Desktop Chrome in Playwright has no navigator.share: the button is "Copy invite link".
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
    await stubDrugs(page);
    const account = await createScopedAccount('fr2-invite');
    await cookieLogin(context, account, baseURL);
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Start a care circle', exact: true }).click();
    await answerWho(page, uniq('Rosa').slice(0, 30));
    await waitForFirstItemForm(page);
    await page.getByRole('combobox', { name: /^Medication name/ }).fill('Metformin');
    await page.getByTestId('add-event-save').click();
    await expect(page.getByTestId('first-run-all-set')).toBeVisible({ timeout: 20_000 });

    const circleId = ownedCircles(account.userId)[0].id;
    const linkInvites = () =>
      dbCount(`select 1 from invites where circle_id = ${sqlStr(circleId)}::uuid and invited_email is null and status = 'pending'`);
    // NEGATIVE: opening All set holds no seat.
    expect(linkInvites()).toBe(0);

    const copy = page.getByTestId('first-run-invite-link');
    await expect(copy).toHaveText(/Copy invite link/);
    await copy.click();
    await expect(page.getByTestId('first-run-all-set-row-circle')).toContainText(
      'Invite link shared. Waiting for them to join.',
      { timeout: 20_000 }
    );
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toMatch(/\/invite\/[A-Z0-9]{6,8}/);
    await copy.click();
    await expect.poll(linkInvites).toBe(1);

    await page.getByTestId('first-run-go-to-today').click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}$`), { timeout: 20_000 });
    await expect(page.getByTestId('first-run-all-set')).toHaveCount(0);
  });

  test('NEGATIVE invited member: an invite link never shows the question and never makes a circle', async ({
    page,
    request,
  }) => {
    test.slow();
    const api = await ownerApi(request, await createScopedAccount('fr2-inviter'));
    const circleId = await createCircle(api, uniq('fr2-invited'));
    const created = await api.post(`/api/circles/${circleId}/invites`, { member_type: 'caregiver' });
    expect(created.status(), `create link invite: ${await created.text()}`).toBeLessThan(300);
    const code = ((await created.json()) as { data: { invite: { invite_code: string } } }).data.invite.invite_code;

    await page.goto(`/invite/${code}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Create an account to join' }).click();
    await expect(page).toHaveURL(/\/signup$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Who are you caring for?' })).toHaveCount(0);
    await expect(page.getByRole('progressbar')).toHaveCount(0);

    const email = runScopedEmail(uniq('fr2-invitee'));
    await page.locator('#first_name').fill('Ada');
    await page.locator('#last_name').fill('Invitee');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(PASSWORD);
    await page.locator('#termsAccepted').check({ force: true });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 20_000 });
    await typeOtp(page, await generateSignupOtp(email, PASSWORD));
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}(/welcome)?$`), { timeout: 30_000 });
    await expect(page.getByTestId('first-run-circle-moment')).toHaveCount(0);
    expect(ownedCircles(userIdOf(email)), 'NO circle of their own').toHaveLength(0);
  });

  test('NEGATIVE reduced motion: every moment renders its end frame, no first-run animation runs; axe clean on the question', async ({
    page,
    context,
    baseURL,
  }, testInfo) => {
    test.slow();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubDrugs(page);
    const account = await createScopedAccount('fr2-motion');
    await cookieLogin(context, account, baseURL);
    await page.goto('/circles', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Start a care circle', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Who are you caring for?' })).toBeVisible();
    await checkA11y(page, 'first-run who', testInfo);
    await page.getByLabel(/^Their name or what you call them/).fill('Rosa');
    await expect(page.locator('[data-testid="first-run-who-preview"].cc-fr-rise')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    const emblem = page.getByTestId('circle-emblem');
    await expect(emblem).toHaveAttribute('data-reduced-motion', 'true', { timeout: 20_000 });
    await expect(page.locator('.cc-fr-ring, .cc-fr-pop')).toHaveCount(0);
    await waitForFirstItemForm(page);
    await page.getByRole('combobox', { name: /^Medication name/ }).fill('Metformin');
    await page.getByTestId('add-event-save').click();
    await expect(page.getByTestId('first-run-all-set')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="first-run-all-set"] .cc-fr-rise, [data-testid="first-run-all-set"] .cc-fr-pop')).toHaveCount(0);
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .map((a) => (a as CSSAnimation).animationName ?? '')
        .filter((n) => n.startsWith('cc-fr-'))
    );
    expect(running).toEqual([]);
  });
});
