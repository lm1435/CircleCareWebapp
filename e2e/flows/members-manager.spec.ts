import type { Browser, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { dbQuery, sqlStr, apiSession, errorCodeOf } from '../unhappy';
import {
  addMembership,
  createRunAccount,
  ensureManagerSwitchOn,
  membershipRole,
  waitForViewer,
  type RunAccount,
} from '../managerRole';
import { sqlExec } from '../db';

// ===========================================================================
// MANAGER ROLE, end to end (docs/plans/manager-role.md), EN + ES.
//
// The worker's premium owner makes a caregiver a Manager through the UI; that
// caregiver then signs in (their own browser context) and, as a manager:
//   - invites someone and sees the pending invite,
//   - cancels it,
//   - removes a plain caregiver,
//   - has no action on the owner's row (and the server refuses a removal of the
//     owner with 403 FORBIDDEN even when asked directly).
// Every step is confirmed on the SERVER (membership role, invite status,
// membership gone), not just on screen.
//
// The feature is behind app_settings `manager_role_enabled`; it is switched on
// for the run by e2e/managerRole.ts and restored by global-teardown.
// The two people the test adds to the worker's circle are removed at the end,
// so later specs on this worker see the roster they expect.
// ===========================================================================

interface Copy {
  locale: string;
  memberActions: (name: string) => string;
  inviteActions: (email: string) => string;
  makeManager: string;
  madeManager: (name: string) => string;
  managerBadge: string;
  inviteCta: string;
  emailLabel: string;
  send: string;
  sentTitle: string;
  pendingHeading: string;
  cancelInvite: string;
  remove: string;
  membersHeading: string;
}

const COPY: Record<'en' | 'es', Copy> = {
  en: {
    locale: 'en-US',
    memberActions: (n) => `Actions for ${n}`,
    inviteActions: (e) => `Actions for invite to ${e}`,
    makeManager: 'Make manager',
    madeManager: (n) => `${n} is now a manager.`,
    managerBadge: 'Manager',
    inviteCta: 'Invite member',
    emailLabel: 'Email address',
    send: 'Send invite',
    sentTitle: 'Invitation sent',
    pendingHeading: 'Pending invites',
    cancelInvite: 'Cancel invite',
    remove: 'Remove',
    membersHeading: 'Members',
  },
  es: {
    locale: 'es',
    memberActions: (n) => `Acciones para ${n}`,
    inviteActions: (e) => `Acciones para la invitación a ${e}`,
    makeManager: 'Dar rol de gestor',
    madeManager: (n) => `${n} ahora ayuda a administrar el círculo.`,
    managerBadge: 'Gestor',
    inviteCta: 'Invitar miembro',
    emailLabel: 'Correo electrónico',
    send: 'Enviar invitación',
    sentTitle: 'Invitación enviada',
    pendingHeading: 'Invitaciones pendientes',
    cancelInvite: 'Cancelar invitación',
    remove: 'Eliminar',
    membersHeading: 'Miembros',
  },
};

/** Report `language: 'es'` from GET /users/me (the app follows the account language). */
async function forceAccountLanguage(page: Page, language: 'en' | 'es'): Promise<void> {
  await page.route('**/api/users/me', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    try {
      const res = await route.fetch();
      const body = (await res.json()) as { data?: { user?: { language?: string } } };
      if (body?.data?.user) body.data.user.language = language;
      await route.fulfill({ status: res.status(), contentType: 'application/json', body: JSON.stringify(body) });
    } catch {
      await route.continue().catch(() => undefined);
    }
  });
}

/** A second, independent browser session signed in as `who` (cookie mode, like fixtures.ts). */
async function signedInPage(browser: Browser, baseURL: string, who: RunAccount, locale: string): Promise<Page> {
  const context = await browser.newContext({ baseURL, locale, viewport: { width: 1440, height: 900 } });
  const res = await context.request.post('/api/auth/login', {
    headers: { 'X-Session-Mode': 'cookie', Origin: new URL(baseURL).origin },
    data: { email: who.email, password: who.password },
  });
  expect(res.ok(), `login as ${who.email}: ${res.status()}`).toBeTruthy();
  return context.newPage();
}

/** The visible copy of a masthead action (it renders an icon-only and a labelled twin). */
function visibleButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
}

test.use({ viewport: { width: 1440, height: 900 } });

for (const lang of ['en', 'es'] as const) {
  const S = COPY[lang];

  test.describe(`manager role (${lang.toUpperCase()})`, () => {
    test.use({ locale: S.locale });

    test('owner makes a member manager; the manager invites, cancels, removes, and cannot touch the owner', async ({
      page,
      browser,
      request,
      circleId,
      account,
      baseURL,
    }) => {
      test.setTimeout(240_000);
      const origin = baseURL ?? 'http://localhost:5173';

      ensureManagerSwitchOn();
      await waitForViewer(request, account, circleId, (v) =>
        Boolean(v.viewer_permissions?.includes('assign_manager'))
      );

      const tag = `${lang}-${Date.now().toString(36)}`;
      const [mgrFirst, mgrLast, plainFirst, plainLast] =
        lang === 'en' ? ['Mara', `Lead${tag.slice(-4)}`, 'Tom', `Plain${tag.slice(-4)}`] : ['Lucía', `Gestora${tag.slice(-4)}`, 'Pablo', `Simple${tag.slice(-4)}`];
      const mgr = await createRunAccount(`mm-mgr-${tag}`, mgrFirst, mgrLast, lang);
      const plain = await createRunAccount(`mm-plain-${tag}`, plainFirst, plainLast, lang);
      addMembership(circleId, mgr.userId, 'member');
      addMembership(circleId, plain.userId, 'member');
      const inviteEmail = `mm-${tag}@example.com`;

      try {
        // ---- OWNER: make the caregiver a manager -------------------------------
        if (lang === 'es') await forceAccountLanguage(page, 'es');
        await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: S.membersHeading, level: 1 })).toBeVisible({ timeout: 20_000 });
        await page.getByRole('button', { name: S.memberActions(mgr.name) }).click();
        await page.getByRole('menuitem', { name: S.makeManager, exact: true }).click();
        const confirm = page.getByRole('dialog');
        await confirm.getByRole('button', { name: S.makeManager, exact: true }).click();
        await expect(page.getByText(S.madeManager(mgr.name))).toBeVisible({ timeout: 15_000 });
        await expect.poll(() => membershipRole(circleId, mgr.userId), { timeout: 10_000 }).toBe('manager');
        const mgrRow = page.getByRole('listitem').filter({ hasText: mgr.name });
        await expect(mgrRow.getByText(S.managerBadge, { exact: true })).toBeVisible({ timeout: 15_000 });

        // ---- MANAGER: a separate session ----------------------------------------
        await waitForViewer(request, mgr, circleId, (v) => v.viewer_role === 'manager');
        const mp = await signedInPage(browser, origin, mgr, S.locale);
        try {
          await mp.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
          await expect(mp.getByRole('heading', { name: S.membersHeading, level: 1 })).toBeVisible({ timeout: 20_000 });
          await expect(mp.getByRole('listitem').filter({ hasText: plain.name })).toBeVisible({ timeout: 20_000 });

          // The owner's row offers the manager nothing.
          const [owner] = dbQuery<{ name: string }>(
            `select concat_ws(' ', first_name, last_name) as name from users where id = ${sqlStr(account.userId)}::uuid`
          );
          await expect(mp.getByRole('listitem').filter({ hasText: owner.name })).toBeVisible();
          await expect(mp.getByRole('button', { name: S.memberActions(owner.name) })).toHaveCount(0);

          // Invite.
          await visibleButton(mp, S.inviteCta).click();
          const modal = mp.getByRole('dialog');
          await modal.getByLabel(S.emailLabel).fill(inviteEmail);
          await modal.getByRole('button', { name: S.send }).click();
          await expect(modal.getByRole('heading', { name: S.sentTitle })).toBeVisible({ timeout: 20_000 });
          await mp.keyboard.press('Escape');
          await expect(modal).toBeHidden();
          await expect.poll(
            () =>
              dbQuery<{ n: number }>(
                `select count(*)::int as n from invites where circle_id = ${sqlStr(circleId)}::uuid
                   and invited_email = ${sqlStr(inviteEmail)} and status = 'pending'
                   and invited_by = ${sqlStr(mgr.userId)}::uuid`
              )[0].n,
            { timeout: 10_000 }
          ).toBe(1);

          // Pending list (managers see it) -> cancel.
          await expect(mp.getByRole('heading', { name: S.pendingHeading })).toBeVisible({ timeout: 15_000 });
          await mp.getByRole('button', { name: S.inviteActions(inviteEmail) }).click();
          await mp.getByRole('menuitem', { name: S.cancelInvite, exact: true }).click();
          await mp.getByRole('dialog').getByRole('button', { name: S.cancelInvite, exact: true }).click();
          await expect(mp.getByRole('button', { name: S.inviteActions(inviteEmail) })).toHaveCount(0, { timeout: 15_000 });
          await expect.poll(
            () =>
              dbQuery<{ status: string }>(
                `select status from invites where circle_id = ${sqlStr(circleId)}::uuid and invited_email = ${sqlStr(inviteEmail)}`
              )[0]?.status,
            { timeout: 10_000 }
          ).toBe('cancelled');

          // Remove a plain caregiver: Remove is the ONLY item a manager gets.
          await mp.getByRole('button', { name: S.memberActions(plain.name) }).click();
          await expect(mp.getByRole('menuitem')).toHaveText([S.remove]);
          await mp.getByRole('menuitem', { name: S.remove, exact: true }).click();
          await mp.getByRole('dialog').getByRole('button', { name: S.remove, exact: true }).click();
          await expect(mp.getByRole('listitem').filter({ hasText: plain.name })).toHaveCount(0, { timeout: 15_000 });
          await expect.poll(() => membershipRole(circleId, plain.userId), { timeout: 10_000 }).toBeNull();
        } finally {
          await mp.context().close();
        }

        // ---- SERVER: the owner cannot be removed by a manager ---------------------
        const api = await apiSession(request, mgr);
        const res = await api.delete(`/api/circles/${circleId}/members/${account.userId}`);
        expect(res.status()).toBe(403);
        expect(await errorCodeOf(res)).toBe('FORBIDDEN');
        expect(membershipRole(circleId, account.userId)).toBe('owner');
      } finally {
        sqlExec(`
          delete from circle_memberships
           where circle_id = ${sqlStr(circleId)}::uuid
             and user_id in (${sqlStr(mgr.userId)}::uuid, ${sqlStr(plain.userId)}::uuid);
          delete from invites where circle_id = ${sqlStr(circleId)}::uuid and invited_email = ${sqlStr(inviteEmail)};
        `);
      }
    });
  });
}
