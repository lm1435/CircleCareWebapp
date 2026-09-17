import type { FullConfig } from '@playwright/test';
import {
  ALLOW_NONLOCAL_ENV,
  DB_URL,
  SUPABASE_URL,
  databaseIsReachable,
  nonLocalDbTargetReasons,
  nonLocalTargetAllowed,
} from './db';
import {
  TZ_FRAME_SEED,
  ensureCrossTimezoneSeed,
  runNeedsCrossTimezoneSeed,
  seedTargetsAreLocal,
} from './crossTimezoneSeed';
import {
  READ_ONLY_SLOT,
  provisionSlot,
  purgeRun,
  purgeStaleRuns,
  removeStaleRunDirs,
  resolveTemplate,
  runNeedsIsolation,
  selectedProjectNames,
  workerSlot,
  writeManifest,
  type IsolatedAccount,
} from './isolation';
import { currentRunId, staleRunHours } from './runId';

/**
 * Provision one isolated account per parallel worker slot, plus the read-only
 * account the route crawl uses — all under THIS run's id. See e2e/isolation.ts
 * for why, and e2e/runId.ts for how two concurrent runs stay out of each
 * other's way.
 *
 * Runs ONCE per `playwright test` invocation, before any worker starts. It is
 * deliberately loud: every failure here is an environment failure, and a
 * misreported environment failure is exactly how a suite stops being a gate.
 */
async function globalSetup(config: FullConfig): Promise<void> {
  const started = Date.now();
  const runId = currentRunId();

  // Most projects in `playwright.config.ts` are backend-free and must keep
  // running on a machine that has neither a local Postgres nor the demo seed —
  // `a11y-public` / `a11y-tablet` / `a11y-mobile` crawl the PUBLIC routes with
  // no session (that is what `npm run test:a11y` is), while `picker-geometry` /
  // `picker-geometry-sheet` and the three `coarse-pointer-*` projects crawl no
  // route at all: they drive `e2e/harness/`, pages that are not part of the app.
  // Provision nothing when the run contains none of `PROJECTS_NEEDING_ISOLATION`.
  const projects = selectedProjectNames(config.projects.map((p) => p.name));
  if (!runNeedsIsolation(projects)) {
    // eslint-disable-next-line no-console
    console.log(
      `[e2e isolation] skipped: no project in this run needs an account (${projects.join(', ')})`
    );
    return;
  }

  // LOCAL-ONLY GUARD, before ANY database or admin-API work — the purges and
  // the provisioning below hard-delete from `care_circles`, `public.users` and
  // `auth.users`. Checked here explicitly (not only inside psql/adminFetch)
  // so a non-local target is REFUSED with its own message instead of being
  // misreported as "no database" by `databaseIsReachable()` swallowing the
  // guard's throw. A throw on purpose: pointing a hard-deleting harness at a
  // non-local database is a misconfiguration to stop on, not to degrade around.
  // (Backend-free-only runs returned above and never reach this.)
  const nonLocal = nonLocalDbTargetReasons();
  if (nonLocal.length > 0) {
    if (!nonLocalTargetAllowed()) {
      throw new Error(
        `[e2e isolation] REFUSING to provision: the database / Supabase target is not local ` +
          `(${nonLocal.join('; ')}). PW_DB_URL=${DB_URL.replace(/\/\/[^@/]*@/, '//***@')} ` +
          `PW_SUPABASE_URL=${SUPABASE_URL}. globalSetup hard-deletes rows and creates auth ` +
          `users; set ${ALLOW_NONLOCAL_ENV}=1 only if that target is really meant to be wiped.`
      );
    }
    // eslint-disable-next-line no-console
    console.warn(
      `[e2e isolation] ${ALLOW_NONLOCAL_ENV}=1 — provisioning against a NON-LOCAL target: ` +
        nonLocal.join('; ')
    );
  }

  // Belt and braces for the same property: if the run *does* include an
  // authenticated project but there is no database, do NOT throw here. A
  // globalSetup throw aborts the whole run including any backend-free project
  // that would have passed. Leave the manifest absent instead — the `setup`
  // preflight then fails with one clear message naming the real problem
  // (readManifest's error), which is what a broken environment should look
  // like.
  if (!databaseIsReachable()) {
    // eslint-disable-next-line no-console
    console.warn(
      '[e2e isolation] NO DATABASE at PW_DB_URL — authenticated projects will fail their ' +
        'preflight. Start the local stack (`supabase start`) if you meant to run them.'
    );
    return;
  }

  const template = resolveTemplate();

  // Sweep what DEAD runs left behind — runs whose newest account is older than
  // the stale threshold by `created_at`. Never a live run's accounts: another
  // `playwright test` running right now has accounts minutes old. Then clear
  // anything this run id already owns (only possible with a reused PW_RUN_ID).
  const hours = staleRunHours();
  const stale = await purgeStaleRuns(runId, hours);
  const staleDirs = removeStaleRunDirs(runId, hours);
  if (stale.length > 0 || staleDirs.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[e2e isolation] swept stale runs older than ${hours}h: ` +
        (stale.map((s) => `${s.runId} (${s.accounts} account(s), newest ${s.newest})`).join(', ') ||
          'no accounts') +
        (staleDirs.length > 0 ? `; removed run dirs ${staleDirs.join(', ')}` : '')
    );
  }
  await purgeRun(runId);

  const slots = [
    READ_ONLY_SLOT,
    ...Array.from({ length: config.workers }, (_, i) => workerSlot(i)),
  ];

  const accounts: Record<string, IsolatedAccount> = {};
  for (const slot of slots) {
    accounts[slot] = await provisionSlot(slot, template);
  }

  writeManifest({
    runId,
    createdAt: new Date().toISOString(),
    workers: config.workers,
    accounts,
  });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(
    `[e2e isolation] run ${runId}: provisioned ${slots.length} account(s) ` +
      `(${slots.join(', ')}) x ${template.circles.length} cloned circle(s) ` +
      `from "${template.circles.map((c) => c.name).join('", "')}" in ${seconds}s`
  );

  // The cross-timezone circle timezone-frame.spec.ts logs in to (see
  // e2e/crossTimezoneSeed.ts). Never a throw: a seeding failure must not abort
  // the rest of the run. That spec checks the seed itself before logging in and
  // FAILS naming it, so a warning here is never the only signal.
  if (runNeedsCrossTimezoneSeed(projects)) {
    if (!seedTargetsAreLocal()) {
      // eslint-disable-next-line no-console
      console.warn(
        '[e2e tz-seed] NOT seeding: PW_DB_URL / PW_SUPABASE_URL is not local. ' +
          'timezone-frame.spec.ts will fail unless the cross-timezone seed already exists there.'
      );
    } else {
      try {
        const circleId = await ensureCrossTimezoneSeed();
        // eslint-disable-next-line no-console
        console.log(
          `[e2e tz-seed] ensured ${TZ_FRAME_SEED.ownerEmail} -> "${TZ_FRAME_SEED.circleName}" ` +
            `(recipient ${TZ_FRAME_SEED.recipientZone}, circle ${circleId})`
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          '[e2e tz-seed] FAILED — timezone-frame.spec.ts will fail its seed check:',
          err instanceof Error ? err.message : err
        );
      }
    }
  }
}

export default globalSetup;
