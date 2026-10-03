import type { APIRequestContext } from '@playwright/test';
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
import { gotoActivitySettled } from '../notesFirstClassShared';

// F-1 + the web `memberJoined.*Unknown` keys + the Spanish feed sentences (10-02):
// after a member DELETES their account, the other members' Activity feed must
// name nobody, in English and in Spanish.
//
// Backend (accountDeletionFeedScrub.ts) rewrites the deleted person's rows to the
// no-name forms: member_joined -> "A member joined the circle" + key
// `entries.memberJoined.caregiverUnknown` ({} params); member_removed -> "A member
// was removed from the circle"; and the deletion itself writes member_left "A
// member left the circle (account deleted)". The web client must render them:
//   EN  "Someone joined the circle as caregiver" (the key; web had no such key
//       before, it printed the bare scrub sentence), the two key-less sentences
//       verbatim;
//   ES  "Alguien se unió al círculo como cuidador", "Un miembro salió del círculo
//       (cuenta eliminada)", "Se eliminó a un miembro del círculo" — before the
//       10-02 work a Spanish reader got these in English.
// Nothing in the rendered feed may carry either person's name or e-mail.
//
// Scenario (run-scoped accounts): Ofelia and Gilberto join the owner's circle;
// the owner removes Gilberto; both delete their accounts. The joins, the removal
// and the deletions are SEEDING through the public API (account deletion through
// the Profile UI is covered by write-persist-members-account.spec.ts); the
// behaviour under test is the owner's Activity page, read through the UI.
//
// FALSIFY: PW_FALSIFY=activity-deleted-member skips both deletions, so the named
// rows stay and the no-name assertions must go red. The app-level proof (the
// Unknown-key renderers and the sentence rules removed in a scratch copy of the
// web app) is logged in docs/plans/web-e2e-coverage-2026-10-02.md.

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

const FALSIFY = (process.env.PW_FALSIFY ?? '').split(',').includes('activity-deleted-member');

async function joinAs(
  request: APIRequestContext,
  ownerSession: Awaited<ReturnType<typeof ownerApi>>,
  circleId: string,
  firstName: string,
  lastName: string
) {
  const account = await createScopedAccount('delfeed');
  sqlExec(
    `update public.users set first_name = ${sqlStr(firstName)}, last_name = ${sqlStr(lastName)} ` +
      `where id = ${sqlStr(account.userId)}::uuid;`
  );
  const session = await ownerApi(request, account);
  const invite = await createInvite(ownerSession, circleId); // @example.com, never mailed
  const accept = await session.post(`/api/invites/code/${invite.code}/accept`);
  expect(accept.status(), await accept.text()).toBeLessThan(300);
  return { account, session, firstName, lastName, fullName: `${firstName} ${lastName}` };
}

const setLanguage = (account: ScopedAccount, lang: 'en' | 'es') =>
  sqlExec(
    `update public.users set language = ${sqlStr(lang)}, language_set_at = now() ` +
      `where id = ${sqlStr(account.userId)}::uuid;`
  );

interface FeedRow {
  action_type: string;
  description: string;
  description_key: string | null;
  params: string | null;
}

const membershipRows = (circleId: string): FeedRow[] =>
  dbQuery<FeedRow>(
    `select action_type, description, description_key, description_params::text as params
       from activity_feed
      where circle_id = ${sqlStr(circleId)}::uuid
        and action_type in ('member_joined','member_left','member_removed')
      order by created_at`
  );

test('a deleted member is named nowhere in the feed: EN "Someone joined…" / "A member left… (account deleted)", ES the same in Spanish', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const suffix = uniq('x').replace(/[^a-z0-9]/gi, '');
  const owner = await createScopedAccount('delfeed-owner');
  const ownerSession = await ownerApi(request, owner);
  const circleId = await createCircle(ownerSession, uniq('delfeed'));

  const ofelia = await joinAs(request, ownerSession, circleId, 'Ofelia', `Borrada${suffix}`);
  const gilberto = await joinAs(request, ownerSession, circleId, 'Gilberto', `Quitado${suffix}`);
  const kick = await ownerSession.delete(`/api/circles/${circleId}/members/${gilberto.account.userId}`);
  expect(kick.status(), await kick.text()).toBeLessThan(300);

  if (!FALSIFY) {
    for (const person of [ofelia, gilberto]) {
      const del = await person.session.delete('/api/users/me');
      expect(del.status(), `DELETE /api/users/me: ${await del.text()}`).toBe(200);
    }
  }

  // The wire contract the clients render (pins what the scrub leaves behind).
  const rows = membershipRows(circleId);
  const leaked = rows.filter((r) =>
    [ofelia.firstName, ofelia.lastName, gilberto.firstName, gilberto.lastName, ofelia.account.email, gilberto.account.email].some(
      (s) => r.description.includes(s) || (r.params ?? '').includes(s)
    )
  );
  expect(leaked, 'feed rows still naming a deleted member').toEqual([]);
  expect(rows.filter((r) => r.action_type === 'member_joined').map((r) => [r.description, r.description_key])).toEqual([
    ['A member joined the circle', 'entries.memberJoined.caregiverUnknown'],
    ['A member joined the circle', 'entries.memberJoined.caregiverUnknown'],
  ]);
  expect(rows.filter((r) => r.action_type !== 'member_joined').map((r) => r.description).sort()).toEqual([
    'A member left the circle (account deleted)',
    'A member was removed from the circle',
  ]);

  const noNames = async () => {
    const main = page.locator('main');
    for (const s of [ofelia.firstName, gilberto.firstName, ofelia.lastName, gilberto.lastName, ofelia.account.email, gilberto.account.email]) {
      await expect(main, `the feed shows "${s}"`).not.toContainText(s);
    }
  };

  // --- The owner reads the feed in ENGLISH ---
  setLanguage(owner, 'en');
  await cookieLogin(context, owner, baseURL);
  await gotoActivitySettled(page, circleId);
  await expect(page.getByRole('heading', { name: 'Activity', exact: true }).first()).toBeVisible({ timeout: 25_000 });
  const joinedEn = page.getByText('Someone joined the circle as caregiver', { exact: true });
  await expect(joinedEn.first()).toBeVisible({ timeout: 25_000 });
  await expect(joinedEn).toHaveCount(2);
  // `.first()`: the newest row is also mirrored into the "Latest" hero.
  await expect(page.getByText('A member left the circle (account deleted)', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('A member was removed from the circle', { exact: true }).first()).toBeVisible();
  // The bare scrub sentence is never shown when the key is there.
  await expect(page.getByText('A member joined the circle', { exact: true })).toHaveCount(0);
  await noNames();

  // --- The same feed in SPANISH ---
  setLanguage(owner, 'es');
  await gotoActivitySettled(page, circleId);
  await expect(page.getByRole('heading', { name: 'Actividad', exact: true }).first()).toBeVisible({ timeout: 25_000 });
  const joinedEs = page.getByText('Alguien se unió al círculo como cuidador', { exact: true });
  await expect(joinedEs.first()).toBeVisible({ timeout: 25_000 });
  await expect(joinedEs).toHaveCount(2);
  await expect(page.getByText('Un miembro salió del círculo (cuenta eliminada)', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Se eliminó a un miembro del círculo', { exact: true }).first()).toBeVisible();
  // No English left over on any of the membership rows.
  await expect(page.getByText(/A member (joined|left|was removed)|Someone joined/)).toHaveCount(0);
  await noNames();
});
