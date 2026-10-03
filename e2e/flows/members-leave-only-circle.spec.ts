import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { dbQuery, holdRequest } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  membershipCount,
  ownerApi,
  uniq,
} from '../unhappy/auth-invites/_helpers';
import { successToast } from '../unhappy/writes/_helpers';

// X13 / PK16: leaving your ONLY circle must land on the (empty) circle picker and
// never forward you straight back into the circle you just left.
//
// The bug: `useLeaveCircle` only INVALIDATED the cached circle list, so when the
// Members page navigated to /circles the picker mounted on the stale list (still
// one circle) and its single-circle auto-skip sent the ex-member to
// /circles/<left> ("Access removed"). The fix removes the circle from the cached
// list synchronously (hooks/useCircleMembers.ts). flows/members-leave.spec.ts
// deliberately asserted only the `/circles` prefix because the race showed up in
// about half the runs.
//
// Made deterministic here: every GET /api/circles after the leave is HELD, so the
// picker can only render from the cache, exactly the window the bug lived in. The
// path history (pushState/replaceState) is recorded in the page, so even a
// forward-then-back bounce is caught. EN and ES (the leave copy is Spanish too).
//
// Falsified against a scratch copy of the web app with the synchronous cache
// removal deleted: red in EN and ES, the picker forwards the ex-member back into
// /circles/<left> (log in docs/plans/web-e2e-coverage-2026-10-02.md).
//
// Run-scoped accounts only; the worker account is never touched.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(90_000);

interface Copy {
  leave: string;
  dialogTitle: string;
  toast: string;
  createCircle: string;
  joinWithCode: string;
  lostHeading: RegExp;
}

const COPY: Record<'en' | 'es', Copy> = {
  en: {
    leave: 'Leave circle',
    dialogTitle: 'Leave this circle?',
    toast: 'You left the circle.',
    createCircle: 'Create circle',
    joinWithCode: 'Join with an invite code',
    lostHeading: /Access removed|Circle not found/,
  },
  es: {
    leave: 'Salir del círculo',
    dialogTitle: '¿Salir de este círculo?',
    toast: 'Saliste del círculo.',
    createCircle: 'Crear círculo',
    joinWithCode: 'Unirte con un código de invitación',
    lostHeading: /Acceso eliminado|Círculo no encontrado/,
  },
};

/** An owner's circle with ONE caregiver whose only circle it is. */
async function onlyCircleMember(request: APIRequestContext, label: string, lang: 'en' | 'es') {
  const owner = await createScopedAccount(`${label}-owner`);
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq(label));
  const member = await createScopedAccount(`${label}-member`);
  // language_set_at stamped, or the next sign-in overwrites the language.
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() where id = ${sqlStr(member.userId)}::uuid;`
  );
  const memberSession = await ownerApi(request, member);
  const invite = await createInvite(ownerSession, circleId); // @example.com, never mailed
  const acc = await memberSession.post(`/api/invites/code/${invite.code}/accept`);
  expect(acc.status(), await acc.text()).toBeLessThan(300);
  const memberships = dbQuery<{ circle_id: string }>(
    `select circle_id::text as circle_id from circle_memberships where user_id = ${sqlStr(member.userId)}::uuid`
  );
  expect(memberships.map((m) => m.circle_id), "the circle is the member's ONLY circle").toEqual([circleId]);
  return { member, circleId };
}

/** Records every SPA path change (push AND replace) in the page, from the first document on. */
async function recordPaths(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __ccPaths?: string[] };
    w.__ccPaths = [location.pathname];
    for (const fn of ['pushState', 'replaceState'] as const) {
      const original = history[fn].bind(history);
      history[fn] = (...args: Parameters<History['pushState']>) => {
        const result = original(...args);
        w.__ccPaths!.push(location.pathname);
        return result;
      };
    }
    addEventListener('popstate', () => w.__ccPaths!.push(location.pathname));
  });
  return () => page.evaluate(() => (window as unknown as { __ccPaths?: string[] }).__ccPaths ?? []);
}

for (const lang of ['en', 'es'] as const) {
  const c = COPY[lang];
  test(`${lang.toUpperCase()}: leaving your ONLY circle lands on the empty picker and never re-enters the circle (PK16)`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const { member, circleId } = await onlyCircleMember(request, `pk16${lang}`, lang);
    const paths = await recordPaths(page);
    await cookieLogin(context, member, baseURL);
    await page.goto(`/circles/${circleId}/members`, { waitUntil: 'domcontentloaded' });
    const leaveButton = page.getByRole('button', { name: c.leave, exact: true });
    await expect(leaveButton).toBeVisible({ timeout: 25_000 });
    const before = (await paths()).length;

    // From here on the circle list can only come from the CACHE.
    const hold = await holdRequest(page, 'GET', '/api/circles');
    try {
      await leaveButton.click();
      const dialog = page.getByRole('dialog', { name: c.dialogTitle });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: c.leave, exact: true }).click();

      await expect(successToast(page, c.toast)).toBeVisible({ timeout: 15_000 });
      // The list refetch the leave triggered is being held: the race window is open.
      await hold.waitForHeld(1, { timeoutMs: 15_000 });
      expect(membershipCount(circleId, member.userId)).toBe(0);

      await expect(page).toHaveURL(/\/circles$/, { timeout: 15_000 });
      // The empty picker, rendered from the cache that no longer lists the circle.
      await expect(page.getByRole('button', { name: c.createCircle, exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: c.joinWithCode, exact: true })).toBeVisible();
      // Give a stale auto-skip every chance to fire.
      await page.waitForTimeout(2_000);
      const afterLeave = (await paths()).slice(before);
      expect(afterLeave, 'path history after the leave').not.toContain(`/circles/${circleId}`);
      expect(afterLeave.some((p) => p.startsWith(`/circles/${circleId}`)), afterLeave.join(' -> ')).toBe(false);
      await expect(page.getByRole('heading', { name: c.lostHeading })).toHaveCount(0);
    } finally {
      await hold.release();
      await hold.dispose();
    }

    // The real list lands (still nothing): the picker stays put.
    await page.waitForTimeout(1_500);
    expect(new URL(page.url()).pathname).toBe('/circles');
    await expect(page.getByRole('button', { name: c.createCircle, exact: true })).toBeVisible();
    expect((await paths()).slice(before).some((p) => p.startsWith(`/circles/${circleId}`))).toBe(false);
  });
}
