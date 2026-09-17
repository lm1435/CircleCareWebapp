import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SUPABASE_URL, assertLocalDbTargets, sqlExec, sqlRows, sqlStr } from './db';
import { currentRunId, staleRunHours } from './runId';

// ===========================================================================
// PER-WORKER, PER-RUN TEST ISOLATION
// ===========================================================================
//
// THE PROBLEM THIS SOLVES. Every authenticated spec used to run as ONE shared
// account (demo@circlecare.app) out of ONE shared `storageState`. With
// `fullyParallel: true` and 4 workers that meant four browsers concurrently
// creating, renaming and DELETING circles, tasks, meds and members inside the
// same account, while `smoke.spec.ts` crawled that same account's circle list
// and `recurring-complete-proof.spec.ts` asserted on exact database rows. Two
// consecutive full runs produced NO stable failures and an almost entirely
// different flaky set each time — the signature of cross-test interference,
// not of a product bug.
//
// It was also an AUTH race. The web uses single-use refresh-token rotation:
// every fresh page load bootstraps an access token from the httpOnly refresh
// cookie and rotates it. Four workers replaying the SAME saved cookie from
// `e2e/.auth/user.json` reuse an already-rotated token, GoTrue treats that as
// reuse and revokes the family, and the next navigation lands on /login. That
// is exactly what "demo account has no (non-E2E) circle to crawl" was: not
// missing data, a dead session.
//
// THE FIX. Playwright's unit of parallelism is the WORKER, and a worker runs
// its tests one at a time. So per-worker isolation is total isolation: two
// tests that could ever run concurrently are, by construction, in different
// workers and therefore in different accounts.
//
//   * One account per parallel worker slot, keyed on `testInfo.parallelIndex`
//     (0 .. workers-1 — NOT `workerIndex`, which keeps climbing when a worker
//     is replaced after a crash and would hand the replacement an account that
//     does not exist).
//   * One EXTRA account, slot `ro`, used only by the read-only route crawl
//     (`smoke.spec.ts`). Nothing mutates it, ever — so the crawl has a target
//     that cannot move under it.
//   * Every account gets a private DEEP CLONE of the demo account's rich
//     seeded circles, so no assertion has to be relaxed to cope with thinner
//     data: the specs see the same shape of content they always saw.
//   * TWO circles per account, because a single-circle account is auto-
//     redirected out of the circle picker (CirclePickerPage's single-circle
//     effect) and `/circles` would then never render the grid that
//     `circle.spec.ts`, `circle-lifecycle.spec.ts`, `navigation.spec.ts` and
//     the crawl all drive.
//   * Sessions are minted per test with a plain API login (see fixtures.ts).
//     Each login is its own session family, so nothing rotates a cookie
//     another test is holding.
//   * Non-default PERSONAS (free owner, view-only member, …) are provisioned
//     lazily per worker slot by `e2e/personas.ts`, under the same run prefix.
//
// RUN SCOPING (two runs at once). Every address is
// `e2e-iso-<runId>-<slot…>@circlecare.test` (see e2e/runId.ts). A run purges
// only rows keyed on ITS run id, plus runs whose newest account is older than
// `staleRunHours()` (default 6h) by `created_at` — never a live run's. The
// manifest lives under `e2e/.auth/runs/<runId>/`, so concurrent runs do not
// overwrite each other's either.
//
// Circles are hard-deleted here (`delete from care_circles`), not archived like
// the UI's delete, so nothing accumulates. Storage objects under a purged
// circle's folder are removed through the Storage API first.
// ===========================================================================

// Defined in db.ts, next to DB_URL, so the one local-only guard sees both.
export { SUPABASE_URL };

// Local-development Supabase service key. This is the well-known key that
// `supabase start` generates for every local stack — it is not a secret, and
// `adminFetch` refuses to send it anywhere the local-only guard in db.ts does
// not accept. Overridable for a non-default local stack.
const SERVICE_KEY =
  process.env.PW_SUPABASE_SERVICE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

/** Shared password for every seeded local account, including these. */
export const ACCOUNT_PASSWORD = process.env.PW_DEMO_PASSWORD ?? 'DemoPass123!';

/** The account whose seeded circles are cloned into every isolated account. */
export const TEMPLATE_OWNER_EMAIL = process.env.PW_DEMO_EMAIL ?? 'demo@circlecare.app';

/**
 * `.test` is a reserved TLD (RFC 2606) that can never resolve, so a stray
 * outbound e-mail to one of these addresses is undeliverable by construction.
 */
export const ACCOUNT_DOMAIN = 'circlecare.test';

/** Every isolated account's address starts with this. */
export const ACCOUNT_PREFIX = 'e2e-iso-';

/** Buckets whose object keys start with `<circleId>/` — purged with the circle. */
const CIRCLE_SCOPED_BUCKETS = ['circle-documents', 'circle-photos', 'medication-photos'] as const;

// Resolved from THIS FILE, not the working directory: globalSetup writes the
// manifest and the workers read it back in separate processes, and a run
// started from the repo root (`npx playwright test -c webapp/playwright.config.ts`)
// would otherwise write and read two different paths.
const AUTH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.auth');

/** `e2e/.auth/runs/` — one directory per run. */
export const RUNS_DIR = path.join(AUTH_DIR, 'runs');

/** This run's private directory (manifest, persona markers). */
export function runDir(runId: string = currentRunId()): string {
  return path.join(RUNS_DIR, runId);
}

/** This run's manifest. Run-scoped so concurrent runs never overwrite each other's. */
export function manifestPath(runId: string = currentRunId()): string {
  return path.join(runDir(runId), 'isolation.json');
}

/**
 * Projects that need an isolated account. The rest of `playwright.config.ts` is
 * backend-free and must keep running on a machine that has neither a local
 * Postgres nor the demo seed (that is the whole point of `npm run test:a11y`):
 *
 *   - `a11y-public` / `a11y-tablet` / `a11y-mobile` crawl the PUBLIC
 *     (logged-out) routes at three viewports, with no session.
 *   - `picker-geometry` / `picker-geometry-sheet` crawl no route at all (the
 *     second is the same spec on `devices['Pixel 5']`). They drive `e2e/harness/`, a page
 *     that is not part of the app and that mounts ONE field, because the picker's
 *     scroll arithmetic is a layout fact jsdom cannot express. Same reason it is
 *     listed separately from `chromium`: a spec needing neither a database nor a
 *     session must not be made to depend on both.
 *   - `coarse-pointer-webkit` / `coarse-pointer-chromium` /
 *     `coarse-pointer-control` drive the same harness plus a second one of four
 *     bare inputs, on `devices['iPhone 13']`, `devices['Pixel 5']` and Desktop
 *     Chrome. They pin the touch gate the pickers stand down behind, and the
 *     width measurement that gate rests on — `coarse-pointer-webkit` is the only
 *     project in the config that is not Chromium, so it needs
 *     `npx playwright install webkit`, and nothing else.
 *
 * `consent` is authenticated (it logs in against a SECOND Vite server built with
 * a fake PostHog key — see e2e/consent.ts), so it is listed here.
 *
 * globalSetup consults this and provisions nothing when the run contains none of
 * them. Add a project to the config and it lands in the backend-free half by
 * DEFAULT — which is the safe direction (it fails loudly on a missing session
 * rather than silently skipping provisioning it needed).
 */
export const PROJECTS_NEEDING_ISOLATION = new Set([
  'setup',
  'chromium',
  'tablet',
  'mobile-chrome',
  'consent',
]);

/** True when this run includes at least one project that needs an account. */
export function runNeedsIsolation(projectNames: string[]): boolean {
  return projectNames.some((name) => PROJECTS_NEEDING_ISOLATION.has(name));
}

/**
 * Which projects this invocation will actually run.
 *
 * `FullConfig.projects` handed to globalSetup is NOT filtered by `--project`
 * (re-verified against this Playwright version by instrumenting globalSetup: a
 * `--project=coarse-pointer-webkit` run still hands it EVERY configured
 * project),
 * so the `--project` flags are read off the CLI. Falls back to every configured
 * project when none was named, which is the correct answer for a bare
 * `npx playwright test`.
 */
export function selectedProjectNames(allProjectNames: string[]): string[] {
  const requested: string[] = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--project' && argv[i + 1]) requested.push(argv[i + 1]);
    else if (arg.startsWith('--project=')) requested.push(arg.slice('--project='.length));
  }
  return requested.length > 0 ? requested : allProjectNames;
}

export interface IsolatedAccount {
  /** `w0`..`wN` for worker slots, `ro` for the read-only crawl account. */
  slot: string;
  email: string;
  password: string;
  userId: string;
  /** Cloned circles, in a stable order. `circleIds[0]` is the primary one. */
  circleIds: string[];
}

export interface IsolationManifest {
  runId: string;
  createdAt: string;
  workers: number;
  /** Keyed by slot. */
  accounts: Record<string, IsolatedAccount>;
}

export function workerSlot(parallelIndex: number): string {
  return `w${parallelIndex}`;
}

/** The slot used by the read-only route crawl. Nothing else may write to it. */
export const READ_ONLY_SLOT = 'ro';

const LABEL_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * A run-scoped address: `e2e-iso-<runId>-<label>@circlecare.test`. Anything
 * created under it is purged by THIS run's teardown (and by the stale sweep if
 * the run dies). Use it for any account a spec creates itself (signup flows).
 * `label` is lowercase letters/digits/hyphens.
 */
export function runScopedEmail(label: string, runId: string = currentRunId()): string {
  if (!LABEL_RE.test(label)) {
    throw new Error(`e2e isolation: label ${JSON.stringify(label)} must match ${LABEL_RE}`);
  }
  return `${ACCOUNT_PREFIX}${runId}-${label}@${ACCOUNT_DOMAIN}`;
}

function emailForSlot(slot: string): string {
  return runScopedEmail(slot);
}

// ---------------------------------------------------------------------------
// Supabase admin (auth user create / delete, storage)
// ---------------------------------------------------------------------------

export async function adminFetch(
  method: string,
  route: string,
  body?: unknown
): Promise<{ status: number; json: unknown }> {
  assertLocalDbTargets(`a Supabase admin call (${method} ${route})`);
  const res = await fetch(`${SUPABASE_URL}${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

/** Upload raw bytes to Storage with the service key. Local-only, like adminFetch. */
export async function adminUpload(
  bucket: string,
  objectName: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  assertLocalDbTargets(`a Supabase storage upload (${bucket}/${objectName})`);
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${objectName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: Buffer.from(bytes),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(
      `e2e isolation: storage upload ${bucket}/${objectName} failed (${res.status}): ${(await res.text()).slice(0, 300)}`
    );
  }
}

function publicUserIdFor(email: string): string | null {
  const rows = sqlRows<{ id: string }>(
    `select id::text as id from public.users where email = ${sqlStr(email)}`
  );
  return rows[0]?.id ?? null;
}

function uuidArray(ids: string[]): string {
  return `array[${ids.map((id) => sqlStr(id)).join(', ')}]::uuid[]`;
}

/** Remove every Storage object under `<circleId>/` in the circle-scoped buckets. */
async function removeCircleStorage(circleIds: string[]): Promise<void> {
  if (circleIds.length === 0) return;
  const objects = sqlRows<{ bucket_id: string; name: string }>(
    `select bucket_id, name from storage.objects
      where bucket_id in (${CIRCLE_SCOPED_BUCKETS.map((b) => sqlStr(b)).join(', ')})
        and lower(split_part(name, '/', 1)) in (${circleIds.map((id) => sqlStr(id.toLowerCase())).join(', ')})`
  );
  const byBucket = new Map<string, string[]>();
  for (const o of objects) byBucket.set(o.bucket_id, [...(byBucket.get(o.bucket_id) ?? []), o.name]);
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += 100) {
      const res = await adminFetch('DELETE', `/storage/v1/object/${bucket}`, {
        prefixes: names.slice(i, i + 100),
      });
      if (res.status >= 300) {
        // eslint-disable-next-line no-console
        console.warn(`[e2e isolation] storage purge of ${bucket} returned ${res.status}`);
      }
    }
  }
}

/**
 * Purge every account whose e-mail matches `emailPredicate` (a SQL boolean
 * expression over a column named `email`), and everything those accounts own.
 *
 * PHASED, in ONE transaction, across the whole matched set — not account by
 * account. A persona MEMBER can author rows inside its HOST's circle, and
 * `circle_documents.uploaded_by` / `calendar_events.created_by` point at users
 * with NO ACTION: deleting the member before the host's circle is gone would be
 * refused. So: storage objects of owned circles, then the circles (one hard
 * delete cascades memberships, events, notes, vitals, documents, feed), then
 * memberships elsewhere, then the user rows.
 *
 * Callers build the predicate from a run id or a persona prefix — never from a
 * bare `e2e-iso-%`. Behind the local-only guard (explicitly, and again inside
 * every psql / admin call).
 */
export async function purgeAccountsWhere(emailPredicate: string): Promise<number> {
  assertLocalDbTargets('a purge of isolated e2e accounts');
  const publicIds = sqlRows<{ id: string }>(
    `select id::text as id from public.users where ${emailPredicate}`
  ).map((r) => r.id);
  const authIds = sqlRows<{ id: string }>(
    `select id::text as id from auth.users where ${emailPredicate}`
  ).map((r) => r.id);
  if (publicIds.length === 0 && authIds.length === 0) return 0;

  if (publicIds.length > 0) {
    const circleIds = sqlRows<{ id: string }>(
      `select id::text as id from care_circles where owner_id = any(${uuidArray(publicIds)})`
    ).map((r) => r.id);
    await removeCircleStorage(circleIds);
  }

  const statements: string[] = [];
  if (publicIds.length > 0) {
    statements.push(`delete from care_circles where owner_id = any(${uuidArray(publicIds)});`);
    statements.push(`delete from circle_memberships where user_id = any(${uuidArray(publicIds)});`);
    statements.push(`delete from public.users where id = any(${uuidArray(publicIds)});`);
  }
  if (authIds.length > 0) {
    statements.push(`delete from auth.users where id = any(${uuidArray(authIds)});`);
  }
  sqlExec(statements.join('\n'));
  return new Set([...publicIds, ...authIds]).size;
}

/** SQL predicate: every address of one run. */
export function runEmailPredicate(runId: string): string {
  return `email like ${sqlStr(`${ACCOUNT_PREFIX}${runId}-%@${ACCOUNT_DOMAIN}`)}`;
}

/** Purge one isolated account (exact address). */
export async function purgeAccount(email: string): Promise<void> {
  await purgeAccountsWhere(`email = ${sqlStr(email)}`);
}

/** Purge every account of ONE run — this run's teardown. */
export async function purgeRun(runId: string): Promise<number> {
  return purgeAccountsWhere(runEmailPredicate(runId));
}

/**
 * Purge runs that are provably dead: runs other than `currentRun` whose NEWEST
 * account (`created_at`, in auth.users or public.users) is older than
 * `hours`. A live run's globalSetup — and every persona it provisions lazily —
 * stamps fresh `created_at`s, so a run is only swept once it has created
 * nothing for that long.
 *
 * Also sweeps LEGACY accounts from before run scoping (`e2e-iso-w0@…`,
 * `e2e-iso-ro@…`) under the same age rule.
 */
export async function purgeStaleRuns(
  currentRun: string,
  hours: number = staleRunHours()
): Promise<Array<{ runId: string; accounts: number; newest: string }>> {
  assertLocalDbTargets('a stale-run sweep of isolated e2e accounts');
  const LEGACY = '__legacy__';
  const like = sqlStr(`${ACCOUNT_PREFIX}%@${ACCOUNT_DOMAIN}`);
  const runs = sqlRows<{ run_id: string; newest: string }>(
    `select coalesce(substring(email from '^e2e-iso-([a-z0-9]+)-'), ${sqlStr(LEGACY)}) as run_id,
            max(created_at)::text as newest
       from (select email, created_at from auth.users where email like ${like}
             union all
             select email, created_at from public.users where email like ${like}) a
      group by 1
     having max(created_at) < now() - make_interval(hours => ${Math.floor(hours)})`
  );
  const purged: Array<{ runId: string; accounts: number; newest: string }> = [];
  for (const run of runs) {
    if (run.run_id === currentRun) continue;
    const predicate =
      run.run_id === LEGACY
        ? `email ~ ${sqlStr(`^e2e-iso-[a-z0-9]+@${ACCOUNT_DOMAIN.replace('.', '\\.')}$`)}`
        : runEmailPredicate(run.run_id);
    const accounts = await purgeAccountsWhere(predicate);
    purged.push({ runId: run.run_id, accounts, newest: run.newest });
  }
  return purged;
}

/** Remove run directories under e2e/.auth/runs older than `hours` (by mtime). */
export function removeStaleRunDirs(currentRun: string, hours: number = staleRunHours()): string[] {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const cutoff = Date.now() - hours * 3_600_000;
  const removed: string[] = [];
  for (const name of fs.readdirSync(RUNS_DIR)) {
    if (name === currentRun) continue;
    const dir = path.join(RUNS_DIR, name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) {
        fs.rmSync(dir, { recursive: true, force: true });
        removed.push(name);
      }
    } catch {
      /* best-effort */
    }
  }
  return removed;
}

export type PlanTier = 'free' | 'premium';

/**
 * Create a confirmed auth user (admin API) and normalize its public.users row.
 * `plan_tier` is the CACHED tier column the backend reads (tierService.ts
 * getUserTier) — the only tier input; RevenueCat is not consulted by access
 * derivation.
 */
export async function createAccount(email: string, tier: PlanTier = 'premium'): Promise<string> {
  const created = await adminFetch('POST', '/auth/v1/admin/users', {
    email,
    password: ACCOUNT_PASSWORD,
    email_confirm: true,
  });
  if (created.status >= 300) {
    throw new Error(
      `e2e isolation: could not create ${email} (${created.status}): ${JSON.stringify(created.json).slice(0, 400)}`
    );
  }

  // A trigger on auth.users mirrors the row into public.users. It fires in the
  // same transaction, so the row is there by the time the admin call returns —
  // but poll briefly rather than assume, because a provisioning race here would
  // surface much later as an unexplained login failure in an unrelated spec.
  let publicId = publicUserIdFor(email);
  for (let attempt = 0; attempt < 20 && !publicId; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    publicId = publicUserIdFor(email);
  }
  if (!publicId) {
    throw new Error(
      `e2e isolation: public.users row never appeared for ${email} after 2s — the ` +
        `on_auth_user_created trigger may be missing from this database.`
    );
  }
  sqlExec(`
    update public.users
       set first_name = 'E2E',
           last_name  = ${sqlStr(email.replace(/@.*$/, ''))},
           timezone   = 'America/Denver',
           language   = 'en',
           plan_tier  = ${sqlStr(tier)},
           terms_accepted_at = coalesce(terms_accepted_at, now()),
           welcome_email_sent = true,
           email_digest_enabled = false,
           marketing_email_opt_out = true
     where id = ${sqlStr(publicId)};
  `);
  return publicId;
}

// ---------------------------------------------------------------------------
// Circle deep clone
// ---------------------------------------------------------------------------

/**
 * Tables cloned alongside a circle, in insert order.
 *
 * `circle_documents` is deliberately ABSENT: its rows point at objects in
 * Supabase Storage that this clone does not copy, so a cloned row would be a
 * download that 404s. The demo template carries no documents anyway, and
 * `documents.spec.ts` uploads its own (personas seed one with a real object).
 */
const CHILD_TABLES = [
  'circle_memberships',
  'emergency_info',
  'activity_feed',
  'care_notes',
  'health_vitals',
] as const;

/** Child tables that additionally need a calendar_events id remapped. */
const EVENT_CHILD_TABLES: Array<{ table: string; fk: string }> = [
  { table: 'medication_confirmations', fk: 'event_id' },
  { table: 'medication_pause_periods', fk: 'root_event_id' },
  { table: 'event_notes', fk: 'event_id' },
];

/** Columns that hold a user id and must follow the owner remap. */
const USER_COLUMNS = new Set([
  'owner_id',
  'user_id',
  'actor_id',
  'author_id',
  'assigned_to',
  'created_by',
  'completed_by',
  'confirmed_by',
  'recorded_by',
  'updated_by',
  'uploaded_by',
]);

function columnsOf(table: string): string[] {
  return sqlRows<{ column_name: string }>(
    `select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${sqlStr(table)}
      order by ordinal_position`
  ).map((r) => r.column_name);
}

/**
 * Build `insert into <table> (cols) select <exprs> from ...`.
 *
 * Column lists are read from `information_schema` at run time rather than
 * hardcoded, so a migration that adds a column is carried into the clone
 * automatically instead of silently dropping it.
 */
function cloneInsert(args: {
  table: string;
  overrides: Record<string, string>;
  /** Columns to leave out entirely so their DEFAULT applies (e.g. a fresh id). */
  omit?: string[];
  from: string;
  where: string;
}): string {
  const omit = new Set(args.omit ?? []);
  const cols = columnsOf(args.table).filter((c) => !omit.has(c));
  const exprs = cols.map((c) => args.overrides[c] ?? `s.${c}`);
  return `insert into ${args.table} (${cols.join(', ')})
          select ${exprs.join(', ')} from ${args.from} where ${args.where};`;
}

/** `case when s.col = <oldOwner> then <newOwner> else s.col end` */
function remapOwner(column: string, oldOwner: string, newOwner: string): string {
  return `case when s.${column} = ${sqlStr(oldOwner)}::uuid then ${sqlStr(newOwner)}::uuid else s.${column} end`;
}

function userOverrides(
  table: string,
  oldOwner: string,
  newOwner: string
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of columnsOf(table)) {
    if (USER_COLUMNS.has(col)) out[col] = remapOwner(col, oldOwner, newOwner);
  }
  return out;
}

/**
 * Deep-clone `sourceCircleId` into a brand-new circle owned by `newOwnerId`.
 *
 * One psql invocation, one transaction, one session — which is what lets the
 * calendar_events id map live in a TEMP table. Returns the new circle id.
 */
export function cloneCircle(args: {
  sourceCircleId: string;
  sourceOwnerId: string;
  newOwnerId: string;
  newCircleId: string;
}): string {
  const { sourceCircleId: src, sourceOwnerId: oldOwner, newOwnerId: newOwner } = args;
  const newCircle = args.newCircleId;

  // No explicit BEGIN/COMMIT: psql's `-c` sends the whole string as ONE
  // simple query, which Postgres already runs in a single implicit transaction
  // (so a failure rolls the whole clone back, and the ON COMMIT DROP temp table
  // disappears with it). An explicit BEGIN here would only warn.
  const statements: string[] = [];

  // 1) The circle itself.
  statements.push(
    cloneInsert({
      table: 'care_circles',
      overrides: {
        id: `${sqlStr(newCircle)}::uuid`,
        owner_id: `${sqlStr(newOwner)}::uuid`,
        archived_at: 'NULL',
        archive_reason: 'NULL',
        // Never inherit a downgrade selection: it is a per-owner decision.
        selected_on_downgrade: 'false',
        // The Storage OBJECT is not cloned, and `assert_storage_path_matches_circle`
        // rightly refuses a path that names another circle. Drop the pointer.
        recipient_photo_url: 'NULL',
      },
      from: 'care_circles s',
      where: `s.id = ${sqlStr(src)}::uuid`,
    })
  );

  // 2) An id map for every event in the source circle, so parent/child links
  //    and every FK into calendar_events survive the copy.
  statements.push(
    `create temp table _evmap (old uuid primary key, new uuid not null default gen_random_uuid()) on commit drop;`
  );
  statements.push(
    `insert into _evmap (old) select id from calendar_events where circle_id = ${sqlStr(src)}::uuid;`
  );

  // Events go in as TWO statements, series roots first and materialized
  // children second. `calendar_events_pointers_match_circle` is a BEFORE INSERT
  // row trigger that looks the parent up in `calendar_events` and raises if it
  // is not already there in the same circle — so a single INSERT..SELECT fails
  // whenever the plan happens to emit a child before its parent (it did). Two
  // statements make the ordering a guarantee rather than a plan artifact.
  //
  // `related_event_id` / `refill_group_id` are populated in a third pass below
  // for the same reason, and `medication_photo_url` is dropped because the
  // Storage object behind it is not cloned.
  const eventOverrides = {
    ...userOverrides('calendar_events', oldOwner, newOwner),
    id: 'm.new',
    circle_id: `${sqlStr(newCircle)}::uuid`,
    related_event_id: 'NULL',
    refill_group_id: 'NULL',
    medication_photo_url: 'NULL',
  };
  statements.push(
    cloneInsert({
      table: 'calendar_events',
      overrides: { ...eventOverrides, parent_event_id: 'NULL' },
      from: `calendar_events s join _evmap m on m.old = s.id`,
      where: `s.circle_id = ${sqlStr(src)}::uuid and s.parent_event_id is null`,
    })
  );
  statements.push(
    cloneInsert({
      table: 'calendar_events',
      overrides: { ...eventOverrides, parent_event_id: 'pm.new' },
      from: `calendar_events s
             join _evmap m on m.old = s.id
             join _evmap pm on pm.old = s.parent_event_id`,
      where: `s.circle_id = ${sqlStr(src)}::uuid and s.parent_event_id is not null`,
    })
  );
  // Third pass: the two SET NULL self-pointers, now that every row exists.
  // A no-op on a template that uses neither (the demo seed does not), so it
  // does not bump `updated_at` on rows that had nothing to fix.
  statements.push(`
    update calendar_events t
       set related_event_id = rm.new,
           refill_group_id  = fm.new
      from calendar_events s
           join _evmap m  on m.old  = s.id
           left join _evmap rm on rm.old = s.related_event_id
           left join _evmap fm on fm.old = s.refill_group_id
     where t.id = m.new
       and s.circle_id = ${sqlStr(src)}::uuid
       and (s.related_event_id is not null or s.refill_group_id is not null);
  `);

  // 3) Plain circle children — fresh ids, remapped circle + user columns.
  for (const table of CHILD_TABLES) {
    statements.push(
      cloneInsert({
        table,
        omit: ['id'],
        overrides: {
          ...userOverrides(table, oldOwner, newOwner),
          circle_id: `${sqlStr(newCircle)}::uuid`,
        },
        from: `${table} s`,
        where: `s.circle_id = ${sqlStr(src)}::uuid`,
      })
    );
  }

  // 4) Children that also point at an event.
  for (const { table, fk } of EVENT_CHILD_TABLES) {
    statements.push(
      cloneInsert({
        table,
        omit: ['id'],
        overrides: {
          ...userOverrides(table, oldOwner, newOwner),
          circle_id: `${sqlStr(newCircle)}::uuid`,
          [fk]: 'm.new',
        },
        from: `${table} s join _evmap m on m.old = s.${fk}`,
        where: `s.circle_id = ${sqlStr(src)}::uuid`,
      })
    );
  }

  sqlExec(statements.join('\n'));
  return newCircle;
}

// ---------------------------------------------------------------------------
// Template resolution
// ---------------------------------------------------------------------------

export interface TemplateCircle {
  id: string;
  name: string;
}

export interface Template {
  ownerId: string;
  circles: TemplateCircle[];
}

/**
 * The demo account's live circles, oldest first — the shape every isolated
 * account is cloned from. Archived circles are excluded (the UI's delete only
 * archives, so the local demo account carries dozens of dead ones).
 */
export function resolveTemplate(): Template {
  const owner = sqlRows<{ id: string }>(
    `select id::text as id from public.users where email = ${sqlStr(TEMPLATE_OWNER_EMAIL)}`
  )[0];
  if (!owner) {
    throw new Error(
      `e2e isolation: template account ${TEMPLATE_OWNER_EMAIL} is not seeded in this database. ` +
        `Run \`node scripts/seed-demo-account.mjs\` from the repo root first.`
    );
  }
  const circles = sqlRows<TemplateCircle>(
    `select id::text as id, name from care_circles
      where owner_id = ${sqlStr(owner.id)}::uuid and archived_at is null
      order by created_at asc`
  );
  if (circles.length < 2) {
    throw new Error(
      `e2e isolation: template account ${TEMPLATE_OWNER_EMAIL} has ${circles.length} live circle(s); ` +
        `at least 2 are required (a single-circle account is auto-redirected past the circle picker). ` +
        `Re-run the demo seed.`
    );
  }
  return { ownerId: owner.id, circles: circles.slice(0, 2) };
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

export async function provisionSlot(slot: string, template: Template): Promise<IsolatedAccount> {
  const email = emailForSlot(slot);
  await purgeAccount(email);
  const userId = await createAccount(email, 'premium');

  const circleIds: string[] = [];
  for (const circle of template.circles) {
    circleIds.push(
      cloneCircle({
        sourceCircleId: circle.id,
        sourceOwnerId: template.ownerId,
        newOwnerId: userId,
        newCircleId: randomUUID(),
      })
    );
  }

  return { slot, email, password: ACCOUNT_PASSWORD, userId, circleIds };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export function writeManifest(manifest: IsolationManifest): void {
  const file = manifestPath(manifest.runId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2), 'utf8');
}

export function readManifest(): IsolationManifest {
  const file = manifestPath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `e2e isolation: ${file} is missing. It is written by globalSetup — ` +
        `run the suite through \`npx playwright test\` (not a bare spec import), with a ` +
        `local database reachable at PW_DB_URL.`
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as IsolationManifest;
}

export function accountFor(manifest: IsolationManifest, slot: string): IsolatedAccount {
  const account = manifest.accounts[slot];
  if (!account) {
    throw new Error(
      `e2e isolation: no account provisioned for slot "${slot}". ` +
        `The manifest holds: ${Object.keys(manifest.accounts).join(', ')}. ` +
        `This means the run has more worker slots than globalSetup provisioned.`
    );
  }
  return account;
}
