import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { countRequests, dbQuery } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  inviteStatus,
  membershipCount,
  ownerApi,
  settle,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';

// THE INVITER'S OWN LINK (2026-10-17).
//
// Field incident: a paid owner sent an invite, copied the link, opened it, was
// offered "Accept", confirmed — and the backend, answering ALREADY_MEMBER, ALSO
// marked the invite 'accepted'. The family member it was for later got "This
// invite has already been used"; nobody ever joined; the owner cancelled.
//
// Covered here against the real backend + DB:
//   (1) the owner opens their OWN /invite/:code signed in -> the page says "This is
//       your own invite link", offers NO Accept, "Go to circle" opens the circle;
//       no accept request is ever sent; the invite stays 'pending'; and the real
//       invitee can still join with it afterwards (EN and ES copy).
//   (2) the backend half: the owner POSTing accept directly answers ALREADY_MEMBER
//       and leaves the invite 'pending'.
//   (3) an existing (non-owner) member opening someone else's link -> "You're
//       already in this circle", no Accept.
//   (4) the owner typing their own code into the picker's Join modal -> the note
//       and "Go to circle", no "Join circle".
//
// FALSIFY: PW_FALSIFY=own-link makes the "owner" a stranger (a fresh account),
// so the note must NOT appear and every own-link assertion goes red.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(150_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').filter(Boolean).includes('own-link');

const COPY = {
  en: {
    ownTitle: 'This is your own invite link',
    ownMessage: "Share it with the person you're inviting. When they open it, they can join your circle.",
    memberTitle: "You're already in this circle",
    goTo: 'Go to circle',
    accept: 'Accept invitation',
  },
  es: {
    ownTitle: 'Este es tu propio enlace de invitación',
    ownMessage:
      'Compártelo con la persona que estás invitando. Cuando lo abra, podrá unirse a tu círculo.',
    memberTitle: 'Ya estás en este círculo',
    goTo: 'Ir al círculo',
    accept: 'Aceptar invitación',
  },
} as const;

const setLanguage = (account: ScopedAccount, lang: 'en' | 'es') =>
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() ` +
      `where id = ${sqlStr(account.userId)}::uuid;`
  );

async function ownerWithInvite(request: APIRequestContext, label: string) {
  const owner = await createScopedAccount(`${label}-owner`);
  const session = await ownerApi(request, owner);
  const circleId = await createCircle(session, uniq(label));
  const invite = await createInvite(session, circleId);
  return { owner, session, circleId, invite };
}

for (const lang of ['en', 'es'] as const) {
  test(`own invite link (${lang.toUpperCase()}): the sender is told it is their own link, never offered Accept, and the invite survives for the real invitee`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const c = COPY[lang];
    const { owner, circleId, invite } = await ownerWithInvite(request, `own-${lang}`);
    const viewer = FALSIFY ? await createScopedAccount(`own-${lang}-stranger`) : owner;
    setLanguage(viewer, lang);
    await cookieLogin(context, viewer, baseURL);

    const accepts = countRequests(page, 'POST', '/api/invites/code/:code/accept');
    await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { level: 1, name: c.ownTitle })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(c.ownMessage, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: c.accept, exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: c.goTo, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/circles/${circleId}(/|\\?|$)`), { timeout: 25_000 });
    await settle();
    await accepts.expectCount(0);
    expect(inviteStatus(invite.id), 'opening your own link never consumes it').toBe('pending');

    // The person it was actually for can still use it.
    const invitee = await createScopedAccount(`own-${lang}-invitee`);
    const inviteeApi = await ownerApi(request, invitee);
    const res = await inviteeApi.post(`/api/invites/code/${invite.code}/accept`, {});
    expect(res.status(), await res.text()).toBe(200);
    expect(membershipCount(circleId, invitee.userId)).toBe(1);
    expect(inviteStatus(invite.id)).toBe('accepted');
  });
}

test('backend: the owner accepting their own code answers ALREADY_MEMBER and leaves the invite pending', async ({
  request,
}) => {
  const { session, circleId, invite } = await ownerWithInvite(request, 'own-api');
  const res = await session.post(`/api/invites/code/${invite.code}/accept`, {});
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error: { code: string; details?: { circle_id: string } } };
  expect(body.error.code).toBe('ALREADY_MEMBER');
  expect(body.error.details?.circle_id).toBe(circleId);
  expect(inviteStatus(invite.id), 'THE BUG: this used to flip to accepted').toBe('pending');
});

test('an existing member opening someone else\'s invite link is told they are already in, never offered Accept', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { session, circleId, invite } = await ownerWithInvite(request, 'own-member');
  // A second person joins through a separate invite first.
  const member = await createScopedAccount('own-member-m');
  const firstInvite = await createInvite(session, circleId);
  const memberApi = await ownerApi(request, member);
  const join = await memberApi.post(`/api/invites/code/${firstInvite.code}/accept`, {});
  expect(join.status(), await join.text()).toBe(200);
  setLanguage(member, 'en');
  await cookieLogin(context, member, baseURL);

  const accepts = countRequests(page, 'POST', '/api/invites/code/:code/accept');
  await page.goto(`/invite/${invite.code}`, { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByRole('heading', { level: 1, name: COPY.en.memberTitle })
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: COPY.en.accept, exact: true })).toHaveCount(0);
  await settle();
  await accepts.expectCount(0);
  expect(inviteStatus(invite.id)).toBe('pending');
});

test('the owner typing their own code into the Join modal sees the note and "Go to circle", not "Join circle"', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const { owner, session, circleId, invite } = await ownerWithInvite(request, 'own-modal');
  // A second circle so the picker stays (no single-circle redirect).
  await createCircle(session, uniq('own-modal-b'));
  setLanguage(owner, 'en');
  await cookieLogin(context, owner, baseURL);

  const accepts = countRequests(page, 'POST', '/api/invites/code/:code/accept');
  await page.goto('/circles', { waitUntil: 'domcontentloaded' });
  const open = page.getByRole('button', { name: 'Join a circle', exact: true });
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Join a circle', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Character 1 of 6', { exact: true }).click();
  await page.keyboard.type(invite.code.toLowerCase(), { delay: 15 });
  await dialog.getByRole('button', { name: 'Find circle', exact: true }).click();

  await expect(dialog.getByText(COPY.en.ownTitle, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('button', { name: 'Join circle', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: COPY.en.goTo, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/circles/${circleId}(/|\\?|$)`), { timeout: 25_000 });
  await settle();
  await accepts.expectCount(0);
  expect(inviteStatus(invite.id)).toBe('pending');
  // The owner's membership is unchanged (exactly one row).
  expect(
    dbQuery<{ n: number }>(
      `select count(*)::int as n from circle_memberships where circle_id = ${sqlStr(circleId)}::uuid and user_id = ${sqlStr(owner.userId)}::uuid`
    )[0].n
  ).toBe(1);
});
