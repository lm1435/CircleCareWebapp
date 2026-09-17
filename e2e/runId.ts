import { randomBytes } from 'node:crypto';

// ===========================================================================
// RUN ID — what makes two concurrent `playwright test` invocations safe.
// ===========================================================================
//
// Every account the harness creates carries the run id in its e-mail local part
// (`e2e-iso-<runId>-w0@circlecare.test`), and every destructive sweep is keyed
// on it: a run purges ITS OWN accounts, plus stale runs whose newest account is
// older than `staleRunHours()` by `created_at` in the database. Nothing ever
// deletes "all e2e accounts" any more, which is what used to make two runs
// (two terminals, two agents) delete each other's accounts mid-run.
//
// WHERE IT IS MINTED. `playwright.config.ts` calls `ensureRunId()` at load. The
// config is evaluated in the runner process BEFORE globalSetup and before any
// worker is spawned, and workers inherit the runner's environment — so setting
// `process.env.PW_RUN_ID` there gives globalSetup, every worker and
// globalTeardown the same id without any file handoff.
//
// OVERRIDE: `PW_RUN_ID=<id>` (lowercase letters/digits, 1-16 chars). It must be
// UNIQUE among runs that overlap in time — two live runs sharing an id share
// (and purge) the same accounts. Leave it unset unless you need a known id.

export const RUN_ID_ENV = 'PW_RUN_ID';
export const STALE_RUN_HOURS_ENV = 'PW_STALE_RUN_HOURS';

/** Lowercase only: GoTrue lower-cases e-mail addresses. */
const RUN_ID_RE = /^[a-z0-9]{1,16}$/;

/** Read (validating) or mint the run id, and publish it in `env`. */
export function ensureRunId(env: NodeJS.ProcessEnv = process.env): string {
  const existing = env[RUN_ID_ENV];
  if (existing !== undefined && existing !== '') {
    if (!RUN_ID_RE.test(existing)) {
      throw new Error(
        `[e2e run-id] ${RUN_ID_ENV}=${JSON.stringify(existing)} is invalid: use 1-16 lowercase ` +
          `letters or digits (it becomes part of an e-mail local part and a SQL LIKE key).`
      );
    }
    return existing;
  }
  // 4 chars of time (keeps ids roughly sortable in a listing) + 6 random hex.
  const id = `${Date.now().toString(36).slice(-4)}${randomBytes(3).toString('hex')}`;
  env[RUN_ID_ENV] = id;
  return id;
}

/** The current run's id. Throws when called outside a `playwright test` run. */
export function currentRunId(): string {
  const id = process.env[RUN_ID_ENV];
  if (!id || !RUN_ID_RE.test(id)) {
    throw new Error(
      `[e2e run-id] ${RUN_ID_ENV} is not set in this process. It is minted by ` +
        `playwright.config.ts — run through \`npx playwright test\`, not a bare import.`
    );
  }
  return id;
}

/**
 * Whether this invocation includes the `consent` project. Included when
 * PW_CONSENT_BASE_URL is set, or when `--project=consent` is on the command
 * line (then its guard FAILS loudly if the URL is missing). A bare full run
 * without the URL leaves it out, so the main suite's gate is not red for want
 * of a second server. The answer is published as PW_INCLUDE_CONSENT because
 * workers re-evaluate the config WITHOUT the runner's argv.
 */
export function includeConsentProject(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): boolean {
  const requested = argv.some(
    (arg, i) => arg === '--project=consent' || (arg === '--project' && argv[i + 1] === 'consent')
  );
  const include = Boolean(env.PW_CONSENT_BASE_URL) || env.PW_INCLUDE_CONSENT === '1' || requested;
  if (include) env.PW_INCLUDE_CONSENT = '1';
  return include;
}

/**
 * Accounts of a run whose NEWEST account is older than this are presumed dead
 * and purged by the next run's globalSetup. Default 6h; minimum 1h so a typo
 * cannot make one run sweep another that is merely slow.
 */
export function staleRunHours(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env[STALE_RUN_HOURS_ENV]);
  if (!Number.isFinite(raw) || raw <= 0) return 6;
  return Math.max(1, raw);
}
