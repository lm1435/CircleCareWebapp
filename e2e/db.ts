import { execFileSync } from 'node:child_process';

// Thin `psql` wrapper shared by the e2e isolation layer and the DB-level proof
// spec. `psql` rather than a driver on purpose: the webapp has no database
// dependency and the e2e suite must not add one to package.json.

export const DB_URL =
  process.env.PW_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

/**
 * The Supabase API the isolation layer calls with the SERVICE key (auth user
 * create/delete). Lives here, next to DB_URL, so the one locality check below
 * can see both targets; `isolation.ts` re-exports it.
 */
export const SUPABASE_URL = process.env.PW_SUPABASE_URL ?? 'http://127.0.0.1:55321';

// ===========================================================================
// LOCAL-ONLY GUARD
// ===========================================================================
//
// The e2e harness HARD-DELETES rows (`care_circles`, `public.users`,
// `auth.users`) and creates auth users with the service key. Pointed at
// anything but a disposable local stack that is data loss, so every psql
// invocation and every admin-API call goes through `assertLocalDbTargets()`.
//
// Checking `new URL(DB_URL).hostname` alone is NOT enough — libpq has other
// ways to be told where to connect, and each of these used to pass the check
// while psql connected somewhere else:
//
//   postgresql://127.0.0.1:55322/postgres?host=remote.example     (host param)
//   postgresql://127.0.0.1:55322/postgres?hostaddr=203.0.113.9    (hostaddr wins over host)
//   postgresql://127.0.0.1:55322/postgres?service=prod            (pg_service.conf can set host/hostaddr)
//   PGHOST=remote.example / PGHOSTADDR=203.0.113.9 in the environment
//
// So the check is an ALLOWLIST, deliberately conservative: loopback names and
// addresses, plus absolute unix-socket paths for `host`. Anything it cannot
// parse is non-local. And the psql child is launched with those env vars
// REMOVED (see `psqlChildEnv`), so even a value the check never saw cannot
// redirect it.
//
// Deliberate non-local target: set PW_ALLOW_NONLOCAL_DB=1 (documented in
// e2e/README.md). There is no other way past this.

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOCAL_HOSTADDRS = new Set(['127.0.0.1', '::1', '[::1]']);

/** libpq env vars that can change WHERE psql connects. Stripped from the child. */
const CONNECTION_ROUTING_ENV = [
  'PGHOST',
  'PGHOSTADDR',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGSYSCONFDIR',
] as const;

export const ALLOW_NONLOCAL_ENV = 'PW_ALLOW_NONLOCAL_DB';

/**
 * `name`: a hostname (URL host) — loopback names/addresses only.
 * `host`: libpq `host` — the same, or an absolute unix-socket directory.
 * `addr`: libpq `hostaddr` — numeric loopback addresses only.
 */
type HostKind = 'name' | 'host' | 'addr';

function isLocalHostValue(value: string, kind: HostKind): boolean {
  // libpq accepts a comma-separated host list and tries each — every entry
  // must be local, and an empty entry (libpq's "use the default") is refused.
  const entries = value.split(',').map((entry) => entry.trim().toLowerCase());
  return entries.every((entry) => {
    if (entry === '') return false;
    if (kind === 'host' && entry.startsWith('/')) return true;
    return (kind === 'addr' ? LOCAL_HOSTADDRS : LOCAL_HOSTNAMES).has(entry);
  });
}

/**
 * Every reason the given targets are NOT local. Empty array = local.
 * Pure (all inputs are parameters) so it can be unit-checked against bypass
 * strings without touching process.env.
 */
export function nonLocalDbTargetReasons(
  dbUrl: string = DB_URL,
  supabaseUrl: string = SUPABASE_URL,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const reasons: string[] = [];

  let db: URL | null = null;
  try {
    db = new URL(dbUrl);
  } catch {
    reasons.push('PW_DB_URL is not a parseable postgresql:// URL');
  }
  if (db) {
    if (db.protocol !== 'postgresql:' && db.protocol !== 'postgres:') {
      reasons.push(`PW_DB_URL scheme ${db.protocol} is not postgresql:`);
    }
    // An EMPTY hostname (`postgresql:///db`) makes libpq fall back to PGHOST or
    // the default socket. Refused rather than reasoned about.
    if (!isLocalHostValue(db.hostname, 'name')) {
      reasons.push(`PW_DB_URL host "${db.hostname}" is not local`);
    }
    // Duplicate keys are all checked: which one libpq honours is its business,
    // so every value has to be acceptable.
    for (const key of new Set(db.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (lower === 'host' || lower === 'hostaddr') {
        for (const v of db.searchParams.getAll(key)) {
          if (!isLocalHostValue(v, lower === 'host' ? 'host' : 'addr')) {
            reasons.push(`PW_DB_URL ?${key}=${v} is not local`);
          }
        }
      } else if (lower === 'service') {
        reasons.push(`PW_DB_URL ?${key}= names a pg_service entry, which can set any host`);
      }
    }
  }

  // Set-but-empty counts as unset (libpq ignores an empty PGHOST).
  if (env.PGHOST && !isLocalHostValue(env.PGHOST, 'host')) {
    reasons.push(`PGHOST=${env.PGHOST} is not local`);
  }
  if (env.PGHOSTADDR && !isLocalHostValue(env.PGHOSTADDR, 'addr')) {
    reasons.push(`PGHOSTADDR=${env.PGHOSTADDR} is not local`);
  }
  if (env.PGSERVICE) {
    reasons.push(`PGSERVICE=${env.PGSERVICE} names a pg_service entry, which can set any host`);
  }

  try {
    const api = new URL(supabaseUrl);
    if (api.protocol !== 'http:' && api.protocol !== 'https:') {
      reasons.push(`PW_SUPABASE_URL scheme ${api.protocol} is not http(s):`);
    }
    if (!isLocalHostValue(api.hostname, 'name')) {
      reasons.push(`PW_SUPABASE_URL host "${api.hostname}" is not local`);
    }
  } catch {
    reasons.push('PW_SUPABASE_URL is not a parseable URL');
  }

  return reasons;
}

/** True when the database, the libpq env and the Supabase API are all local. */
export function dbTargetsAreLocal(): boolean {
  return nonLocalDbTargetReasons().length === 0;
}

/** True when the operator explicitly opted into a non-local target. */
export function nonLocalTargetAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[ALLOW_NONLOCAL_ENV] === '1';
}

/**
 * Throw unless every target is local (or PW_ALLOW_NONLOCAL_DB=1). `context`
 * names the operation in the message.
 */
export function assertLocalDbTargets(context: string): void {
  const reasons = nonLocalDbTargetReasons();
  if (reasons.length === 0 || nonLocalTargetAllowed()) return;
  throw new Error(
    `[e2e local-only guard] refusing ${context}: ${reasons.join('; ')}. ` +
      `The e2e harness hard-deletes rows and creates auth users; it only runs against a ` +
      `local stack. Set ${ALLOW_NONLOCAL_ENV}=1 if a non-local target is really intended.`
  );
}

/** The psql child's env: password default, and NO libpq routing overrides. */
export function psqlChildEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = { ...env, PGPASSWORD: env.PGPASSWORD ?? 'postgres' };
  for (const key of CONNECTION_ROUTING_ENV) delete child[key];
  return child;
}

function run(args: string[]): string {
  assertLocalDbTargets('a psql command');
  // The connection is passed explicitly as `--dbname=<url>` (never picked up
  // from the environment), and the env vars that could reroute it are removed.
  return execFileSync('psql', [`--dbname=${DB_URL}`, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: psqlChildEnv(),
  });
}

/**
 * Run a SELECT and get typed rows back.
 *
 * Wrapped in `json_agg` so the result parses as JSON instead of the
 * column-aligned text psql prints by default.
 */
export function sqlRows<T>(query: string): T[] {
  const out = run([
    '-t',
    '-A',
    '-c',
    `select coalesce(json_agg(t), '[]'::json)::text from (${query}) t`,
  ]);
  return JSON.parse(out.trim()) as T[];
}

/** Run one or more statements. Multiple statements share ONE psql session. */
export function sqlExec(statement: string): void {
  run(['-q', '-c', statement]);
}

/** Single-quote a SQL literal, or emit NULL. */
export function sqlStr(value: string | null | undefined): string {
  return value === null || value === undefined ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
}

/** True when a local Postgres is reachable. */
export function databaseIsReachable(): boolean {
  try {
    sqlRows<{ ok: number }>('select 1 as ok');
    return true;
  } catch {
    return false;
  }
}
