import type { Locator, Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures';
import { checkA11y } from '../helpers';
import { fulfillFault } from '../unhappy';
import { gotoWithRouterState } from '../unhappy/auth-invites/_helpers';

// A REJECTED EMAIL-VERIFICATION CODE (src/pages/VerifyEmailPage.tsx + the six-box
// field src/components/auth/OtpInput.tsx).
//
// The page submits on every report of a full 6-digit code. A rejected code used to
// stay in the boxes, so retyping it changed a FULL code on every keystroke and each
// half-corrected code went out on its own (123456 over 999999 sent 199999, 129999,
// 123999, 123499, 123459 and finally 123456); in production the first request
// disables the boxes, the rest of the typing is lost and the OTP limiter (10 per
// 15 minutes) is spent. A code the server DEFINITELY rejected is now emptied and
// focus goes back to box 1; a failure that says nothing about the code (no
// response, 5xx) keeps it.
//
//   (1) rejected -> boxes empty, box 1 focused, message still up (announced by its
//       role="alert", the group described by it, axe clean) -> the new code typed
//       from the focused box is sent ONCE and signs in
//   (2) the same, the way people actually do it: click box 1, type the new code
//   (3) rejected twice in a row: emptied and refocused both times
//   (4) a network failure / a 503 keeps the typed code; Verify sends the same code
//       again with nothing retyped
//   (5) a SUCCESSFUL Resend empties the boxes and focuses box 1 (the old code is dead, and a
//       full stale code would be typed over in halves exactly like a rejected one); the new
//       code, typed from the focused box or after clicking box 1, is sent ONCE
//   (6) a FAILED Resend (network, our 429) leaves the typed code in the boxes
//
// SELF-CONTAINED, NO MAIL, NO BACKEND CALLS: every /api request the page makes is answered
// here with page.route (verify-otp: reject / fail / accept; the session exchange; the profile
// and circle list the landing page asks for), and any other /api request made while the verify
// page is up FAILS the test; once signed in, the landing page's background reads are refused at
// the network layer. Nothing reaches a server: no account is created and nothing can send email
// (resend-otp, which mails a real code, and session-established, the backend's second
// welcome-email trigger, are answered here too), so,
// unlike unhappy/auth-invites/verify-email.spec.ts, this spec needs neither generate_link nor an
// unreachable :3001.
//
// FALSIFY: the falsifier is the app. With the pre-fix VerifyEmailPage.tsx put back, (1), (2) and (3)
// go red (the boxes keep the rejected code, focus is lost, and a retyped code goes out in halves)
// while (4), which pins the behaviour that did not change, stays green. With only the Resend fix
// taken out, (5) goes red (stale code stays, focus stays on the button, a retyped code goes out in
// halves) while (6) stays green.

test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = 'otp-rejected-code@example.com';
const BAD_CODE_COPY =
  "That code didn't work. It may have expired — tap Send a new code below to get a fresh one.";

type Reply = 'reject' | 'accept' | 'abort' | 'unavailable';
type ResendReply = 'ok' | 'abort' | 'rate';

interface Stubbed {
  /** The `otp` of every POST /api/auth/verify-otp the page sent, in order. */
  readonly codes: string[];
  /** How many times the session exchange was called. */
  exchanges: () => number;
  /** How many times POST /api/auth/resend-otp was called (it mails a real code; never reaches a server here). */
  resends: () => number;
  /** Every /api request nothing here expected BEFORE the sign-in (must stay empty). */
  readonly unexpected: string[];
}

const envelope = (data: unknown) => ({ success: true, data });

/**
 * Answer the page's whole API surface. `replies[i]` decides what the (i+1)-th verify-otp request
 * gets; once they run out the last one repeats.
 */
async function stubApi(page: Page, replies: Reply[], resendReplies: ResendReply[] = ['ok']): Promise<Stubbed> {
  const codes: string[] = [];
  const unexpected: string[] = [];
  let exchanges = 0;
  let resends = 0;

  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route: Route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const where = `${request.method()} ${pathname}`;

      if (where === 'POST /api/auth/verify-otp') {
        const body = request.postDataJSON() as { email: string; otp: string };
        codes.push(body.otp);
        const reply = replies[Math.min(codes.length, replies.length) - 1];
        if (reply === 'reject') {
          // What the backend sends for a wrong OR expired code (routes/auth.ts).
          await fulfillFault(route, {
            status: 400,
            code: 'VERIFICATION_FAILED',
            message: 'Invalid or expired verification code.',
          });
        } else if (reply === 'abort') {
          await fulfillFault(route, { abort: true });
        } else if (reply === 'unavailable') {
          await fulfillFault(route, { status: 503, code: 'SERVICE_UNAVAILABLE', message: 'Try again' });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(
              envelope({
                session: { access_token: 'stub-access', refresh_token: 'stub-refresh', expires_at: 4102444800 },
                user: { id: 'stub-user', email: body.email, first_name: 'Pat' },
              })
            ),
          });
        }
        return;
      }
      if (where === 'POST /api/auth/resend-otp') {
        resends += 1;
        const reply = resendReplies[Math.min(resends, resendReplies.length) - 1];
        if (reply === 'abort') {
          await fulfillFault(route, { abort: true });
        } else if (reply === 'rate') {
          // Our own limiter (middleware/rateLimit.ts).
          await fulfillFault(route, { status: 429, code: 'RATE_LIMIT', message: 'Too many requests' });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(envelope({ message: 'Verification code sent. Please check your email.' })),
          });
        }
        return;
      }
      if (where === 'POST /api/auth/oauth-session') {
        exchanges += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            envelope({
              session: { access_token: 'stub-cookie-session', expires_at: 4102444800 },
              user: { id: 'stub-user', email: EMAIL, first_name: 'Pat', last_name: 'Rivera' },
            })
          ),
        });
        return;
      }
      // The signed-out boot probe: no session cookie, so no session.
      if (where === 'POST /api/auth/refresh') {
        await fulfillFault(route, { status: 401, code: 'NO_SESSION', message: 'No session' });
        return;
      }
      // What the app asks for once the person is in. session-established is the backend's second
      // welcome-email trigger: it is answered here and must never reach a real server.
      if (where === 'GET /api/users/me') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(
            envelope({
              user: {
                id: 'stub-user',
                email: EMAIL,
                first_name: 'Pat',
                last_name: 'Rivera',
                timezone: 'America/Denver',
                language: 'en',
                notification_preferences: {},
                created_at: '2026-10-02T00:00:00Z',
                updated_at: '2026-10-02T00:00:00Z',
              },
            })
          ),
        });
        return;
      }
      if (where === 'POST /api/auth/session-established') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope({})) });
        return;
      }
      // The circle list the landing page (/circles) shows: none yet.
      if (where === 'GET /api/circles') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(envelope([])) });
        return;
      }
      // Before the session exists the page has no business calling anything else: that is a leak
      // and fails the test. Once the person is in, the landing page fans out a few background reads
      // (subscription status, pending invites, ...) at a pace nobody controls; they are refused at the
      // network layer, unrecorded, and never reach a server.
      if (exchanges === 0) unexpected.push(where);
      await route.abort('failed');
    }
  );

  return { codes, exchanges: () => exchanges, resends: () => resends, unexpected };
}

const box = (page: Page, n: number): Locator => page.getByLabel(`Digit ${n} of 6`);

async function expectEmptyAndFocused(page: Page): Promise<void> {
  for (let n = 1; n <= 6; n += 1) await expect(box(page, n)).toHaveValue('');
  await expect(box(page, 1)).toBeFocused();
}

async function expectBoxes(page: Page, code: string): Promise<void> {
  for (let n = 1; n <= 6; n += 1) await expect(box(page, n)).toHaveValue(code[n - 1]);
}

async function openVerifyPage(page: Page): Promise<void> {
  await gotoWithRouterState(page, '/verify-email', { email: EMAIL });
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`We sent a 6-digit code to ${EMAIL}`)).toBeVisible();
  // The first box takes focus on its own when the email is already known.
  await expect(box(page, 1)).toBeFocused();
}

/** The page, while it is the verify page, called nothing outside the stubbed surface. */
function expectNothingUnexpected(stub: Stubbed): void {
  expect(stub.unexpected, 'no /api request outside the stubbed surface before sign-in').toEqual([]);
}

test('a rejected code empties the boxes and focuses box 1; the new code is sent once and signs in', async ({
  page,
}, testInfo) => {
  const stub = await stubApi(page, ['reject', 'accept']);
  await openVerifyPage(page);

  await page.keyboard.type('999999', { delay: 20 });
  await expect(page.getByRole('alert')).toHaveText(BAD_CODE_COPY);
  await expectEmptyAndFocused(page);
  expect(stub.codes).toEqual(['999999']);

  // Screen readers: the message is a live alert (above), every box is flagged invalid, the group
  // is described by that same alert, and the focused box still carries its own label.
  const alertId = await page.getByRole('alert').getAttribute('id');
  expect(alertId).toBeTruthy();
  await expect(page.getByRole('group', { name: '6-digit code' })).toHaveAttribute('aria-describedby', alertId!);
  await expect(page.getByRole('textbox', { name: 'Digit 1 of 6' })).toBeFocused();
  for (let n = 1; n <= 6; n += 1) await expect(box(page, n)).toHaveAttribute('aria-invalid', 'true');
  for (let n = 1; n <= 6; n += 1) await expect(box(page, n)).toBeEnabled();
  await checkA11y(page, '/verify-email (code rejected)', testInfo);

  // The message does not vanish while the new code is typed; the next attempt replaces it.
  await page.keyboard.type('123', { delay: 20 });
  await expect(page.getByRole('alert')).toHaveText(BAD_CODE_COPY);
  await expect(box(page, 1)).toHaveValue('1');
  await expect(box(page, 3)).toHaveValue('3');
  expect(stub.codes, 'an incomplete new code sends nothing').toEqual(['999999']);

  await page.keyboard.type('456', { delay: 20 });
  await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
  expect(stub.codes).toEqual(['999999', '123456']);
  expect(stub.exchanges()).toBe(1);
  expectNothingUnexpected(stub);
});

test('clicking box 1 and typing a completely different code sends that code once', async ({ page }) => {
  const stub = await stubApi(page, ['reject', 'accept']);
  await openVerifyPage(page);

  await page.keyboard.type('999999', { delay: 20 });
  await expect(page.getByRole('alert')).toHaveText(BAD_CODE_COPY);
  await expectEmptyAndFocused(page);

  // The probe that found this typed 123456 over 999999 and sent six requests.
  await box(page, 1).click();
  await page.keyboard.type('123456', { delay: 20 });

  await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
  expect(stub.codes).toEqual(['999999', '123456']);
  expect(stub.exchanges()).toBe(1);
  expectNothingUnexpected(stub);
});

test('rejected twice in a row: emptied and refocused both times, then the third code signs in', async ({
  page,
}) => {
  const stub = await stubApi(page, ['reject', 'reject', 'accept']);
  await openVerifyPage(page);

  await page.keyboard.type('999999', { delay: 20 });
  await expect(page.getByRole('alert')).toHaveText(BAD_CODE_COPY);
  await expectEmptyAndFocused(page);

  await page.keyboard.type('888888', { delay: 20 });
  await expect.poll(() => stub.codes.length, { timeout: 10_000 }).toBe(2);
  await expect(page.getByRole('alert')).toHaveText(BAD_CODE_COPY);
  await expectEmptyAndFocused(page);

  await page.keyboard.type('123456', { delay: 20 });
  await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
  expect(stub.codes).toEqual(['999999', '888888', '123456']);
  expectNothingUnexpected(stub);
});

for (const [name, firstReply] of [
  ['a network failure', 'abort'],
  ['a 503 from the server', 'unavailable'],
] as const) {
  test(`${name} keeps the typed code; Verify sends the same code again, nothing retyped`, async ({ page }) => {
    const stub = await stubApi(page, [firstReply, 'accept']);
    await openVerifyPage(page);

    await page.keyboard.type('123456', { delay: 20 });
    // The page words every failure after a code the same way (only a 429 differs); what differs is
    // that the server never said the CODE was wrong, so the digits stay.
    await expect(page.getByRole('alert')).toHaveText(BAD_CODE_COPY);
    await expectBoxes(page, '123456');
    for (let n = 1; n <= 6; n += 1) await expect(box(page, n)).toBeEnabled();
    expect(stub.codes).toEqual(['123456']);

    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
    expect(stub.codes).toEqual(['123456', '123456']);
    expect(stub.exchanges()).toBe(1);
    expectNothingUnexpected(stub);
  });
}

const SENT_COPY = 'A new verification code has been sent to your email.';

/** A full code the page kept (the network dropped the verify request), then the Resend click. */
async function keptCodeThenResend(page: Page, stub: Stubbed): Promise<void> {
  await openVerifyPage(page);
  await page.keyboard.type('123456', { delay: 20 });
  await expect(page.getByRole('alert')).toHaveText(BAD_CODE_COPY);
  await expectBoxes(page, '123456');
  for (let n = 1; n <= 6; n += 1) await expect(box(page, n)).toBeEnabled();
  expect(stub.codes).toEqual(['123456']);
  await page.getByRole('button', { name: 'Send a new code' }).click();
}

test('a successful Resend empties the boxes and focuses box 1; the new code typed from there is sent once', async ({
  page,
}) => {
  const stub = await stubApi(page, ['abort', 'accept'], ['ok']);
  await keptCodeThenResend(page, stub);

  await expect(page.getByRole('status')).toHaveText(SENT_COPY);
  await expectEmptyAndFocused(page);
  await expect(page.getByRole('button', { name: /^Send a new code in \d+s$/ })).toBeDisabled();
  expect(stub.resends()).toBe(1);
  expect(stub.codes, 'a resend submits nothing').toEqual(['123456']);

  await page.keyboard.type('654321', { delay: 20 });
  await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
  expect(stub.codes).toEqual(['123456', '654321']);
  expect(stub.exchanges()).toBe(1);
  expect(stub.resends()).toBe(1);
  expectNothingUnexpected(stub);
});

test('after a Resend, clicking box 1 and typing a completely different code sends that code once', async ({
  page,
}) => {
  const stub = await stubApi(page, ['abort', 'accept'], ['ok']);
  await keptCodeThenResend(page, stub);
  await expect(page.getByRole('status')).toHaveText(SENT_COPY);
  await expectEmptyAndFocused(page);

  // Typed over the stale 123456 this sent 623456, 653456 ... one request per keystroke.
  await box(page, 1).click();
  await page.keyboard.type('654321', { delay: 20 });

  await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
  expect(stub.codes).toEqual(['123456', '654321']);
  expect(stub.resends()).toBe(1);
  expectNothingUnexpected(stub);
});

for (const [name, reply, copy] of [
  ['a network failure', 'abort', "We couldn't resend the code. Please try again."],
  ['our own rate limit (429)', 'rate', 'Too many attempts. Please wait a few minutes before trying again.'],
] as const) {
  test(`a Resend that fails (${name}) leaves the typed code in the boxes`, async ({ page }) => {
    const stub = await stubApi(page, ['abort', 'accept'], [reply]);
    await keptCodeThenResend(page, stub);

    await expect(page.getByRole('alert')).toHaveText(copy);
    await expectBoxes(page, '123456');
    // No cooldown was armed: Resend is still there to press again.
    await expect(page.getByRole('button', { name: 'Send a new code' })).toBeEnabled();
    expect(stub.resends()).toBe(1);

    // And the kept code still goes through with nothing retyped.
    await page.getByRole('button', { name: 'Verify email' }).click();
    await expect(page).toHaveURL(/\/circles$/, { timeout: 20_000 });
    expect(stub.codes).toEqual(['123456', '123456']);
    expectNothingUnexpected(stub);
  });
}
