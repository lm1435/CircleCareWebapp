import { test, expect } from '../fixtures';
import { sqlExec, sqlStr } from '../db';
import { dbQuery } from '../unhappy';
import {
  cookieLogin,
  createCircle,
  createInvite,
  createScopedAccount,
  ownerApi,
  uniq,
  type ScopedAccount,
} from '../unhappy/auth-invites/_helpers';
import { escapeRegExp, gotoActivitySettled } from '../notesFirstClassShared';
import type { APIRequestContext } from '@playwright/test';

// Activity feed, Spanish reader: membership rows used to stay in ENGLISH.
//
// `member_left` ("<Name> left the circle") and `member_removed` ("<Name> was
// removed from the circle") are written by the backend as plain English with no
// `description_key`, and no client had a sentence for them, so a Spanish reader
// saw English in the feed. The clients now recognise them by action_type + the
// exact stored sentence (activityTranslation.ts `translateSentenceRow`).
//
// Scenario, all through the PUBLIC API: one caregiver leaves the circle, the
// owner removes another. The owner then reads the Activity page with the app in
// Spanish and in English.
//
// People are located by NAME, never by position: the member list is not sorted
// and the feed interleaves their join rows with the two rows under test.
//
// The stored `description` is asserted to be the unchanged English sentence in
// the database, which pins that the fix is client-only (nothing was reworded and
// no key was added).
//
// Run-scoped accounts only: the worker account's circles are never touched.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

async function joinAs(
  request: APIRequestContext,
  ownerSession: Awaited<ReturnType<typeof ownerApi>>,
  circleId: string,
  firstName: string,
  lastName: string
) {
  const account = await createScopedAccount('mi18n');
  // A real, recognisable name (the harness default is "E2E <email-local-part>").
  sqlExec(
    `update public.users set first_name = ${sqlStr(firstName)}, last_name = ${sqlStr(lastName)} ` +
      `where id = ${sqlStr(account.userId)}::uuid;`
  );
  const session = await ownerApi(request, account);
  const invite = await createInvite(ownerSession, circleId);
  const accept = await session.post(`/api/invites/code/${invite.code}/accept`);
  expect(accept.status(), await accept.text()).toBeLessThan(300);
  return { account, session, fullName: `${firstName} ${lastName}` };
}

// `language_set_at` is stamped: with a NULL stamp the backend treats the language as "never decided" and
// overwrites it with the device's on the next sign-in (routes/auth.ts), which would undo this.
const setLanguage = (account: ScopedAccount, lang: 'en' | 'es') =>
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() ` +
      `where id = ${sqlStr(account.userId)}::uuid;`
  );

test('Spanish feed: a member who left and a member who was removed read in Spanish', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const suffix = uniq('x').replace(/[^a-z0-9]/gi, '');
  const owner = await createScopedAccount('mi18n-owner');
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq('mi18n'));

  // Two caregivers with distinct names. Names carry no English word, so "no
  // English left over" can be asserted on the whole row.
  const leaver = await joinAs(request, ownerSession, circleId, 'Marisol', `Salida${suffix}`);
  const removed = await joinAs(request, ownerSession, circleId, 'Teodoro', `Retirado${suffix}`);

  // The leaver leaves; the owner removes the other one.
  const leave = await leaver.session.post(`/api/circles/${circleId}/leave`);
  expect(leave.status(), await leave.text()).toBeLessThan(300);
  const kick = await ownerSession.delete(`/api/circles/${circleId}/members/${removed.account.userId}`);
  expect(kick.status(), await kick.text()).toBeLessThan(300);

  // The writer's contract is untouched: English prose, no key, no params.
  const stored = dbQuery<{ action_type: string; description: string; description_key: string | null }>(
    `select action_type, description, description_key from activity_feed
      where circle_id = ${sqlStr(circleId)}::uuid and action_type in ('member_left','member_removed')
      order by action_type`
  );
  expect(stored).toEqual([
    { action_type: 'member_left', description: `${leaver.fullName} left the circle`, description_key: null },
    { action_type: 'member_removed', description: `${removed.fullName} was removed from the circle`, description_key: null },
  ]);

  // --- The owner reads the feed in SPANISH ---
  setLanguage(owner, 'es');
  await cookieLogin(context, owner, baseURL);
  await gotoActivitySettled(page, circleId);
  // The feed has finished loading in Spanish (loading copy is Spanish too).
  await expect(page.getByRole('heading', { name: 'Actividad', exact: true }).first()).toBeVisible({
    timeout: 25_000,
  });

  // `.first()`: the newest row is mirrored into the "Latest" hero as well.
  const leftEs = page.getByText(`${leaver.fullName} salió del círculo`, { exact: true }).first();
  const removedEs = page.getByText(`Se eliminó a ${removed.fullName} del círculo`, { exact: true }).first();
  await expect(leftEs).toBeVisible({ timeout: 25_000 });
  await expect(removedEs).toBeVisible({ timeout: 25_000 });

  // ...and no English version of either sentence is on the page.
  await expect(page.getByText(new RegExp(`${escapeRegExp(leaver.fullName)} left the circle`))).toHaveCount(0);
  await expect(page.getByText(new RegExp(`${escapeRegExp(removed.fullName)} was removed from the circle`))).toHaveCount(0);
  await expect(page.getByText(/left the circle|was removed from the circle/)).toHaveCount(0);

  // The join rows were already Spanish and still are (regression guard).
  await expect(
    page.getByText(`${leaver.fullName} se unió al círculo como cuidador`, { exact: true }).first()
  ).toBeVisible();

  // --- The same two rows in ENGLISH are byte-identical to what is stored ---
  setLanguage(owner, 'en');
  await gotoActivitySettled(page, circleId);
  await expect(page.getByRole('heading', { name: 'Activity', exact: true }).first()).toBeVisible({
    timeout: 25_000,
  });
  await expect(page.getByText(`${leaver.fullName} left the circle`, { exact: true }).first()).toBeVisible({
    timeout: 25_000,
  });
  await expect(
    page.getByText(`${removed.fullName} was removed from the circle`, { exact: true }).first()
  ).toBeVisible();
  await expect(page.getByText(/salió del círculo|Se eliminó a/)).toHaveCount(0);
});
