import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../../fixtures';
import { countRequests, failRequest, holdRequest } from '../../unhappy';
import {
  PARKED,
  archiveCircle,
  captureJson,
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  expireInvite,
  inviteStatus,
  membershipCount,
  ownerApi,
  rewriteJson,
  sessionItems,
  uniq,
} from './_helpers';

// INVITE LANDING unhappy paths (src/pages/InviteLandingPage.tsx, backend
// POST /api/invites/code/:code/preview + /accept). The worker account OWNS a
// fresh circle per test (never the cloned ones); invitees are run-scoped
// accounts; invite addresses are @example.com (the backend never mails them).
// The page starts logged OUT; invitee tests log the context in explicitly.

test.use({ storageState: { cookies: [], origins: [] } });

const PREVIEW = '/api/invites/code/:code/preview';
const ACCEPT = '/api/invites/code/:code/accept';

const COPY = {
  invalid: 'This invite has expired or is invalid',
  archived: 'This care circle is no longer active',
  acceptFailed:
    "We couldn't add you to the circle just now. Try again — and if it keeps not working, ask for a fresh invite.",
  acceptExpired: 'This invitation has expired. Ask whoever invited you to send a new one.',
  joined: 'You joined the circle.',
};

async function acceptButton(page: Page) {
  const btn = page.getByRole('button', { name: 'Accept invitation' });
  await expect(btn).toBeVisible({ timeout: 20_000 });
  return btn;
}

test('invalid code: not-found state from a real 404, no CTAs', async ({ page }) => {
  const previews = countRequests(page, 'POST', PREVIEW);
  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/invites\/code\/[^/]+\/preview$/.test(new URL(r.url()).pathname)),
    page.goto('/invite/ZZZQQ9', { waitUntil: 'domcontentloaded' }),
  ]);
  expect(res.status()).toBe(404);
  await expect(page.getByRole('heading', { name: COPY.invalid })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Create an account to join' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
  await previews.expectCount(1);
});

test('expired invite: preview 400 INVITE_EXPIRED → expired/invalid state; accept-time expiry → expired copy, no membership', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const api = await ownerApi(request, await createScopedAccount('invite-owner'));
  const circleId = await createCircle(api, uniq('expired'));
  const dead = await createInvite(api, circleId);
  expireInvite(dead.id);

  const previews = await captureJson(page, 'POST', PREVIEW);
  await page.goto(`/invite/${dead.code}`, { waitUntil: 'domcontentloaded' });
  const preview = await previews.next();
  expect(preview.status).toBe(400);
  expect(preview.json.error.code).toBe('INVITE_EXPIRED');
  await expect(page.getByRole('heading', { name: COPY.invalid })).toBeVisible({ timeout: 20_000 });
  await previews.dispose();

  // Expires WHILE the accept is in flight. The app refetches the preview on
  // every window focus (queryClient refetchOnWindowFocus: 'always'), so an
  // expiry written before the click can legitimately swap the card for the
  // preview error state; expiring while the accept is HELD pins it to accept.
  const invitee = await createScopedAccount('invitee-expiring');
  const live = await createInvite(api, circleId);
  await cookieLogin(context, invitee, baseURL);
  await page.goto(`/invite/${live.code}`, { waitUntil: 'domcontentloaded' });
  const accept = await acceptButton(page);
  const hold = await holdRequest(page, 'POST', ACCEPT);
  const accepts = countRequests(page, 'POST', ACCEPT);
  await accept.click();
  await hold.waitForHeld();
  expireInvite(live.id);
  await hold.release();
  await expect(page.getByRole('alert')).toHaveText(COPY.acceptExpired);
  await expect(page).toHaveURL(new RegExp(`/invite/${live.code}$`));
  await accepts.expectCount(1);
  expect(membershipCount(circleId, invitee.userId)).toBe(0);
  expect(inviteStatus(live.id)).toBe('pending');
});

test('invite to an ARCHIVED circle: CIRCLE_ARCHIVED copy', async ({ page, request }) => {
  const api = await ownerApi(request, await createScopedAccount('invite-owner'));
  const circleId = await createCircle(api, uniq('archived'));
  const invite = await createInvite(api, circleId);
  await archiveCircle(api, circleId);

  const previews = await captureJson(page, 'POST', PREVIEW);
  await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
  const preview = await previews.next();
  expect(preview.status).toBe(400);
  expect(preview.json.error.code).toBe('CIRCLE_ARCHIVED');
  await expect(page.getByRole('heading', { name: COPY.archived })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: COPY.invalid })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create an account to join' })).toHaveCount(0);
});

test('proof: the archived copy keys on the CODE (same real response, code rewritten → generic copy)', async ({
  page,
  request,
}) => {
  const api = await ownerApi(request, await createScopedAccount('invite-owner'));
  const circleId = await createCircle(api, uniq('archived-proof'));
  const invite = await createInvite(api, circleId);
  await archiveCircle(api, circleId);
  const rewrite = await rewriteJson(page, 'POST', PREVIEW, (json) => ({
    ...json,
    error: { ...(json.error as Record<string, unknown>), code: 'INVITE_EXPIRED' },
  }));
  await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: COPY.invalid })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: COPY.archived })).toHaveCount(0);
  expect(rewrite.requests).toHaveLength(1);
});

test('already a member: ALREADY_MEMBER → sent to their circles, no error, no duplicate membership', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const api = await ownerApi(request, await createScopedAccount('invite-owner'));
  const circleId = await createCircle(api, uniq('member'));
  const invitee = await createScopedAccount('invitee-member');
  const first = await createInvite(api, circleId);
  const inviteeApi = await ownerApi(request, invitee);
  const joined = await inviteeApi.post(`/api/invites/code/${first.code}/accept`);
  expect(joined.ok(), await joined.text()).toBe(true);
  expect(membershipCount(circleId, invitee.userId)).toBe(1);

  const second = await createInvite(api, circleId);
  await cookieLogin(context, invitee, baseURL);
  await page.goto(`/invite/${second.code}`, { waitUntil: 'domcontentloaded' });
  const accept = await acceptButton(page);
  const accepts = countRequests(page, 'POST', ACCEPT);
  const acceptResponses = await captureJson(page, 'POST', ACCEPT);
  await accept.click();
  const res = await acceptResponses.next();
  expect(res.status).toBe(400);
  expect(res.json.error.code).toBe('ALREADY_MEMBER');

  // Single circle → the picker forwards into it.
  await expect(page).toHaveURL(new RegExp(`/circles(/${circleId})?`), { timeout: 20_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(COPY.joined)).toHaveCount(0);
  await accepts.expectCount(1);
  expect(membershipCount(circleId, invitee.userId)).toBe(1);
});

test('double-click Accept while held: one accept request, one membership', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const api = await ownerApi(request, await createScopedAccount('invite-owner'));
  const circleId = await createCircle(api, uniq('double'));
  const invite = await createInvite(api, circleId);
  const invitee = await createScopedAccount('invitee-double');
  await cookieLogin(context, invitee, baseURL);

  await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
  const accept = await acceptButton(page);
  const hold = await holdRequest(page, 'POST', ACCEPT);
  const accepts = countRequests(page, 'POST', ACCEPT);

  await accept.evaluate((b: HTMLButtonElement) => {
    b.click();
    b.click();
  });
  await hold.waitForHeld();
  const joining = page.getByRole('button', { name: 'Joining…' });
  await expect(joining).toBeDisabled();
  await joining.click({ force: true });
  await hold.release();

  await expect(page.getByText(COPY.joined)).toBeVisible({ timeout: 20_000 });
  await accepts.expectCount(1);
  expect(membershipCount(circleId, invitee.userId)).toBe(1);
  expect(inviteStatus(invite.id)).toBe('accepted');
});

/** Logged-out visitor → "I already have an account" → /login → signs in. Returns once the accept answered. */
async function signInHandoff(page: Page, request: APIRequestContext) {
  const api = await ownerApi(request, await createScopedAccount('invite-owner'));
  const circleId = await createCircle(api, uniq('handoff'));
  const invite = await createInvite(api, circleId);
  const invitee = await createScopedAccount('invitee-handoff');

  const accepts = countRequests(page, 'POST', ACCEPT);
  await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'I already have an account' }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  await accepts.expectCount(0, { settleMs: 300 });

  await page.locator('#login-email').fill(invitee.email);
  await page.locator('#login-password').fill(invitee.password);
  const [acceptRes] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === `/api/invites/code/${invite.code}/accept`, {
      timeout: 25_000,
    }),
    page.getByRole('button', { name: 'Sign in', exact: true }).click(),
  ]);
  return { circleId, invite, invitee, accepts, acceptRes };
}

// The server side of the handoff. Where the joiner ends up (the join toast and
// /circles) is the next test's assertion, not this one's.
test('logged-out visitor: sign-in handoff returns to the invite and the join completes server-side', async ({
  page,
  request,
}) => {
  const { circleId, invite, invitee, accepts, acceptRes } = await signInHandoff(page, request);
  expect(acceptRes.status(), 'the auto-accept after sign-in succeeded').toBe(200);
  // The return path was preserved: the accept was issued FROM the invite page.
  const referer = (await acceptRes.request().allHeaders())['referer'] ?? '';
  expect(referer && new URL(referer).pathname, 'accept sent from the invite page').toBe(`/invite/${invite.code}`);
  await accepts.expectCount(1);
  expect(membershipCount(circleId, invitee.userId)).toBe(1);
  expect(inviteStatus(invite.id)).toBe('accepted');
  expect((await sessionItems(page, [PARKED.invite]))[PARKED.invite], 'parked code consumed').toBeNull();
});

// The auto-accept runs in InviteLandingPage's MOUNT effect. It used per-call
// `mutate(code, { onSuccess })` callbacks, which StrictMode's mount double-invoke
// detached from the in-flight mutation: the join landed but no toast and no
// navigation followed (reproduced 3/3). It now settles on `mutateAsync`'s promise,
// through the same handler as a direct accept.
test('sign-in handoff auto-accept confirms the join and takes the joiner to their circles, accepting once', async ({
  page,
  request,
}) => {
  const { acceptRes, accepts } = await signInHandoff(page, request);
  expect(acceptRes.status()).toBe(200);
  await expect(page.getByText(COPY.joined)).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/\/circles/);
  await accepts.expectCount(1);
});

test('accept failure (500): error copy, nothing joined; retry works', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const api = await ownerApi(request, await createScopedAccount('invite-owner'));
  const circleId = await createCircle(api, uniq('retry'));
  const invite = await createInvite(api, circleId);
  const invitee = await createScopedAccount('invitee-retry');
  await cookieLogin(context, invitee, baseURL);

  await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
  const accept = await acceptButton(page);
  const fault = await failRequest(page, 'POST', ACCEPT, { status: 500 });
  const accepts = countRequests(page, 'POST', ACCEPT);

  await accept.click();
  await expect(page.getByRole('alert')).toHaveText(COPY.acceptFailed);
  await expect(accept).toBeEnabled();
  await fault.expectHits(1);
  await accepts.expectCount(1);
  expect(membershipCount(circleId, invitee.userId)).toBe(0);

  await accept.click();
  await expect(page.getByText(COPY.joined)).toBeVisible({ timeout: 20_000 });
  await accepts.expectCount(2);
  expect(membershipCount(circleId, invitee.userId)).toBe(1);
});

test.describe('Spanish', () => {
  test.use({ locale: 'es-MX' });

  // The browser locale alone (no ?lang=es): that is all this proves. The
  // parameter is isolated in the known gap below, on an English browser.
  test('a Spanish browser (es-MX) gets Spanish invite copy', async ({ page, request }) => {
    const api = await ownerApi(request, await createScopedAccount('invite-owner'));
    const circleId = await createCircle(api, uniq('es'));
    const invite = await createInvite(api, circleId);
    await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /te invitó a ayudar a cuidar a E2E es-/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Crea una cuenta para unirte' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create an account to join' })).toHaveCount(0);
  });
});

test.describe('English browser', () => {
  // Pinned, so ONLY ?lang=es can make the page Spanish.
  test.use({ locale: 'en-US' });

  // PREVIEW-ONLY BY DESIGN (founder decision). `?lang=es` selects the Spanish
  // link-preview card — the prerendered index.es.html OG tags in production
  // (.htaccess) — and nothing else: the landing page itself follows the
  // browser (src/i18n/index.ts detects from `navigator` only).
  test('?lang=es is preview-only: an English browser still gets English invite copy', async ({
    page,
    request,
  }) => {
    const api = await ownerApi(request, await createScopedAccount('invite-owner'));
    const circleId = await createCircle(api, uniq('es-en'));
    const invite = await createInvite(api, circleId);
    await page.goto(`/invite/${invite.code}?lang=es`, { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => navigator.languages), 'setup: an English browser').toEqual(['en-US']);
    // Loaded signal first (either language), so the absence below is not vacuous.
    await expect(page.getByRole('button', { name: /Create an account to join|Crea una cuenta para unirte/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: 'Create an account to join' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Crea una cuenta para unirte' })).toHaveCount(0);
  });
});
