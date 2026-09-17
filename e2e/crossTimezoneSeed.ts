import { randomUUID } from 'node:crypto';
import { assertLocalDbTargets, dbTargetsAreLocal, sqlExec, sqlRows, sqlStr } from './db';
import { ACCOUNT_PASSWORD, adminFetch } from './isolation';

// ===========================================================================
// CROSS-TIMEZONE SEED for e2e/flows/timezone-frame.spec.ts
// ===========================================================================
//
// That spec logs in as the owner of a circle whose CARE RECIPIENT lives in
// another zone, because every circle the demo account (and therefore every
// isolated clone) carries is Denver -> Denver: the identity case, where a
// deleted conversion would still pass.
//
// It used to rely on `mobile/scripts/seed-cross-timezone.mjs` having been run by
// hand, and SKIPPED when it had not — which on a normal machine meant all seven
// tests skipped, silently, and the gate (which counts failed + flaky, not
// skipped) stayed green. globalSetup now calls `ensureCrossTimezoneSeed()` so the
// accounts are always there when the spec runs.
//
// This is a PORT of the one scenario the spec needs, not a call to that script:
// the script also rewrites a TRACKED manifest
// (`mobile/src/__tests__/integration/crossTimezoneCircles.json`), and the e2e
// suite must never dirty the tree. The rows it produces are the same shape the
// script produces for its `tokyo` scenario (same e-mails, names, zones and
// password), so running either one first leaves the other a no-op, and the
// circle id the mobile manifest recorded is reused rather than replaced.
//
// Differences from the script, both deliberate:
//   * Rows are written through the admin API + psql, not through the backend's
//     POST /circles, so seeding does not depend on which port the backend
//     under test is on. The circle row + two memberships are all the viewer
//     frame reads (`care_recipient_timezone` comes from the recipient
//     membership's user).
//   * LOCAL ONLY, enforced by the shared guard in db.ts (`assertLocalDbTargets`),
//     which also sees libpq's `host`/`hostaddr` params and PGHOST/PGHOSTADDR —
//     a plain hostname check on the URL did not.
//   * CONCURRENCY-SAFE. Two globalSetups racing (two terminals, two sessions)
//     used to both see "no circle" and both insert one — and the spec requires
//     EXACTLY ONE, so that state failed it on every run afterwards. See
//     `ensureCircle` for the lock, and for the self-heal of an existing
//     duplicate.
//
// NOT purged by globalTeardown: these are `@tz.test` accounts shared with the
// mobile integration suite, not `e2e-iso-*` ones.
// ===========================================================================

/** What timezone-frame.spec.ts logs in as and asserts against. */
export const TZ_FRAME_SEED = {
  ownerEmail: 'tz-owner-tokyo@tz.test',
  ownerZone: 'Pacific/Auckland',
  recipientEmail: 'tz-tokyo@tz.test',
  recipientZone: 'Asia/Tokyo',
  circleName: 'TZ tokyo',
} as const;

/**
 * Projects whose specs need the seed. `timezone-frame.spec.ts` runs only under
 * `chromium` (every other authenticated project has a `testMatch` that excludes
 * `flows/`), so seeding for a tablet- or mobile-only run would be wasted work.
 */
export const PROJECTS_NEEDING_TZ_SEED = new Set(['chromium']);

export function runNeedsCrossTimezoneSeed(projectNames: string[]): boolean {
  return projectNames.some((name) => PROJECTS_NEEDING_TZ_SEED.has(name));
}

/**
 * True when the database (URL host, libpq host/hostaddr params, PGHOST /
 * PGHOSTADDR) and the Supabase auth API are all local. See db.ts.
 */
export function seedTargetsAreLocal(): boolean {
  return dbTargetsAreLocal();
}

function publicUserId(email: string): string | null {
  return (
    sqlRows<{ id: string }>(`select id::text as id from public.users where email = ${sqlStr(email)}`)[0]
      ?.id ?? null
  );
}

async function ensureUser(args: {
  email: string;
  firstName: string;
  lastName: string;
  timezone: string;
  premium: boolean;
}): Promise<string> {
  let id = publicUserId(args.email);
  if (!id) {
    const authExists =
      sqlRows<{ id: string }>(`select id::text as id from auth.users where email = ${sqlStr(args.email)}`)
        .length > 0;
    if (!authExists) {
      const created = await adminFetch('POST', '/auth/v1/admin/users', {
        email: args.email,
        password: ACCOUNT_PASSWORD,
        email_confirm: true,
        user_metadata: { first_name: args.firstName, last_name: args.lastName },
      });
      // A concurrent globalSetup can create the same address between the
      // existence check above and this call; GoTrue then refuses the second
      // create. That is the outcome we wanted, so fall through to the poll —
      // but only when the row really is there now.
      const lostTheRace =
        created.status >= 300 &&
        sqlRows<{ id: string }>(
          `select id::text as id from auth.users where email = ${sqlStr(args.email)}`
        ).length > 0;
      if (created.status >= 300 && !lostTheRace) {
        throw new Error(
          `could not create ${args.email} (${created.status}): ${JSON.stringify(created.json).slice(0, 300)}`
        );
      }
    }
    // The on_auth_user_created trigger mirrors the row into public.users.
    for (let attempt = 0; attempt < 20 && !id; attempt += 1) {
      id = publicUserId(args.email);
      if (!id) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!id) throw new Error(`public.users row never appeared for ${args.email}`);
  }
  sqlExec(`
    update public.users
       set first_name = ${sqlStr(args.firstName)},
           last_name  = ${sqlStr(args.lastName)},
           timezone   = ${sqlStr(args.timezone)}
           ${args.premium ? ", plan_tier = 'premium'" : ''}
     where id = ${sqlStr(id)};
  `);
  return id;
}

/**
 * Idempotently ensure the cross-timezone circle `timezone-frame.spec.ts` needs.
 * Returns the circle id. Throws on a non-local target.
 */
export async function ensureCrossTimezoneSeed(seed: SeedSpec = TZ_FRAME_SEED): Promise<string> {
  assertLocalDbTargets('to seed the cross-timezone circle');

  const ownerId = await ensureUser({
    email: seed.ownerEmail,
    firstName: 'Owner',
    lastName: seed.ownerEmail.replace(/^tz-owner-|@.*$/g, ''),
    timezone: seed.ownerZone,
    premium: true,
  });
  const recipientId = await ensureUser({
    email: seed.recipientEmail,
    firstName: seed.recipientEmail.replace(/^tz-|@.*$/g, '').slice(0, 4).replace(/^./, (c) => c.toUpperCase()),
    lastName: 'Recipient',
    timezone: seed.recipientZone,
    premium: false,
  });

  ensureCircle({ seed, ownerId, recipientId });

  const circleIds = liveCircleIds(seed, ownerId);
  if (circleIds.length !== 1) {
    throw new Error(
      `cross-timezone seed: expected exactly one live "${seed.circleName}" circle for ` +
        `${seed.ownerEmail} after seeding, found ${circleIds.length}`
    );
  }
  return circleIds[0];
}

type SeedSpec = {
  ownerEmail: string;
  ownerZone: string;
  recipientEmail: string;
  recipientZone: string;
  circleName: string;
};

/** Live circles of this name owned by this owner, oldest first. */
function liveCircleIds(seed: SeedSpec, ownerId: string): string[] {
  return sqlRows<{ id: string }>(
    `select id::text as id from care_circles
      where owner_id = ${sqlStr(ownerId)}::uuid
        and recipient_name = ${sqlStr(seed.circleName)}
        and archived_at is null
      order by created_at asc, id asc`
  ).map((row) => row.id);
}

/**
 * Check-and-insert the circle (and its two memberships) under a Postgres
 * ADVISORY LOCK, healing any duplicate an earlier unlocked race left behind.
 *
 * WHY `pg_advisory_xact_lock` IN ONE psql COMMAND, not a session lock around
 * the whole seed: this module has no persistent connection. Every `sqlExec` is
 * its own short-lived `psql -c` process, so a session-level
 * `pg_advisory_lock` would be released the moment that process exited — before
 * the next command even started. What `psql -c` DOES give us is one simple
 * query = one implicit transaction, so the lock, the dedupe, the
 * insert-if-absent and the memberships all go in ONE string: the lock is held
 * from the first statement to the implicit COMMIT, and a second setup blocks on
 * it until the first has committed its circle.
 *
 * That is enough under READ COMMITTED because each statement in the string
 * takes a FRESH snapshot: the `where not exists` below runs after the lock is
 * acquired, so it sees the circle the other setup just committed.
 *
 * The auth users are NOT under this lock — they are created through the admin
 * API, which cannot join a psql transaction — so `ensureUser` tolerates losing
 * that race instead.
 *
 * SELF-HEAL. Keeps the OLDEST live circle (so the id the mobile manifest
 * recorded survives) and hard-deletes newer live duplicates — only ones owned
 * by THIS `@tz.test` owner with this exact name. The caller has already passed
 * the local-only guard, and `sqlExec` re-checks it.
 */
function ensureCircle(args: { seed: SeedSpec; ownerId: string; recipientId: string }): void {
  const { seed, ownerId, recipientId } = args;
  if (!/@tz\.test$/.test(seed.ownerEmail)) {
    throw new Error(`cross-timezone seed: refusing to dedupe circles of non-@tz.test owner ${seed.ownerEmail}`);
  }
  const owner = `${sqlStr(ownerId)}::uuid`;
  const name = sqlStr(seed.circleName);
  const liveMatch = `owner_id = ${owner} and recipient_name = ${name} and archived_at is null`;
  // The one circle every later statement targets. Re-evaluated per statement,
  // which is fine: nothing else can change the set while the lock is held.
  const keeper = `(select id from care_circles where ${liveMatch} order by created_at asc, id asc limit 1)`;
  // Id minted here: `sqlRows` wraps its query in a subquery, where Postgres
  // does not allow INSERT ... RETURNING — and the id is re-read afterwards.
  const candidateId = randomUUID();

  sqlExec(`
    select pg_advisory_xact_lock(hashtext(${sqlStr(`circlecare-e2e:tz-seed:${seed.ownerEmail}:${seed.circleName}`)}));

    delete from care_circles c
     where ${liveMatch.replace(/\b(owner_id|recipient_name|archived_at)\b/g, 'c.$1')}
       and c.id <> ${keeper}
       and exists (select 1 from public.users u where u.id = c.owner_id and u.email like '%@tz.test');

    insert into care_circles (id, owner_id, name, recipient_name, recipient_dob)
    select ${sqlStr(candidateId)}::uuid, ${owner}, ${name}, ${name}, '1950-01-01'
     where not exists (select 1 from care_circles where ${liveMatch});

    -- Owner membership, then the membership that makes the recipient THE care
    -- recipient, which is where care_recipient_timezone is read from.
    insert into circle_memberships (circle_id, user_id, role, is_care_recipient)
    select k.id, ${owner}, 'owner', false from ${keeper} k
     where not exists (select 1 from circle_memberships m where m.circle_id = k.id and m.user_id = ${owner});
    insert into circle_memberships (circle_id, user_id, role, is_care_recipient)
    select k.id, ${sqlStr(recipientId)}::uuid, 'member', true from ${keeper} k
     where not exists (select 1 from circle_memberships m
                        where m.circle_id = k.id and m.user_id = ${sqlStr(recipientId)}::uuid);
  `);
}
