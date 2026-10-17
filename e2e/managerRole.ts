import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import { sqlExec, sqlRows, sqlStr } from './db';
import { createAccount, runDir, runScopedEmail, ACCOUNT_PASSWORD } from './isolation';
import { apiSession } from './unhappy';

// ===========================================================================
// MANAGER ROLE e2e helpers (docs/plans/manager-role.md).
//
// The whole feature is dark-launched behind app_settings `manager_role_enabled`
// (only the exact string 'on' enables it). It is ONE global row in the shared
// local database, so it is switched on per RUN, not per spec:
//
//   ensureManagerSwitchOn()   records the value it found in a run-scoped marker
//                             (created exclusively, so only the FIRST caller in
//                             the run records it — later callers, in other
//                             workers, cannot capture an 'on' they set
//                             themselves) and sets 'on'.
//   restoreManagerSwitch()    called from global-teardown: puts the recorded
//                             value back once every worker is done. Restoring
//                             in a spec's afterAll would switch the feature off
//                             under a sibling spec still running in another
//                             worker.
//
// The backend caches the switch for 60 s (services/circleManagers.ts), so
// `waitForViewer` polls the API until the viewer fields reflect it.
// ===========================================================================

export const MANAGER_SWITCH_KEY = 'manager_role_enabled';

function markerPath(): string {
  return path.join(runDir(), 'manager-switch.json');
}

function readSwitch(): string | null {
  const rows = sqlRows<{ value: string }>(
    `select value from app_settings where key = ${sqlStr(MANAGER_SWITCH_KEY)}`
  );
  return rows.length ? rows[0].value : null;
}

/** Turn the manager switch on for this run (first caller records the prior value). */
export function ensureManagerSwitchOn(): void {
  fs.mkdirSync(runDir(), { recursive: true });
  try {
    const fd = fs.openSync(markerPath(), 'wx');
    fs.writeSync(fd, JSON.stringify({ previous: readSwitch() }));
    fs.closeSync(fd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  sqlExec(`
    insert into app_settings (key, value) values (${sqlStr(MANAGER_SWITCH_KEY)}, 'on')
    on conflict (key) do update set value = 'on', updated_at = now();
  `);
}

/** Global teardown: put back what the run found. No marker = the run never touched it. */
export function restoreManagerSwitch(): void {
  const marker = markerPath();
  if (!fs.existsSync(marker)) return;
  const { previous } = JSON.parse(fs.readFileSync(marker, 'utf8')) as { previous: string | null };
  if (previous === null) {
    sqlExec(`delete from app_settings where key = ${sqlStr(MANAGER_SWITCH_KEY)}`);
  } else {
    sqlExec(
      `update app_settings set value = ${sqlStr(previous)}, updated_at = now() where key = ${sqlStr(MANAGER_SWITCH_KEY)}`
    );
  }
  fs.rmSync(marker, { force: true });
}

export interface ViewerFields {
  viewer_role?: string;
  viewer_permissions?: string[];
}

/**
 * Poll GET /api/circles/:id as `account` until `ready(viewer)` (the backend's
 * 60 s switch cache), then return the viewer fields. Fails after ~80 s.
 */
export async function waitForViewer(
  request: APIRequestContext,
  account: { email: string; password: string },
  circleId: string,
  ready: (v: ViewerFields) => boolean
): Promise<ViewerFields> {
  const api = await apiSession(request, account);
  let last: ViewerFields = {};
  await expect
    .poll(
      async () => {
        const res = await api.get(`/api/circles/${circleId}`);
        const circle = ((await res.json()) as { data?: { circle?: ViewerFields } }).data?.circle;
        last = { viewer_role: circle?.viewer_role, viewer_permissions: circle?.viewer_permissions };
        return ready(last);
      },
      {
        message: `viewer fields for ${account.email} never became ready (backend switch cache is 60 s)`,
        timeout: 80_000,
        intervals: [1_000, 2_000, 5_000],
      }
    )
    .toBe(true);
  return last;
}

export interface RunAccount {
  email: string;
  password: string;
  userId: string;
  firstName: string;
  lastName: string;
  /** "First Last", as the roster renders it. */
  name: string;
}

/**
 * A fresh run-scoped login (purged with the run) with a readable name, so the
 * roster's "Actions for <name>" triggers are predictable.
 */
export async function createRunAccount(
  label: string,
  firstName: string,
  lastName: string,
  language: 'en' | 'es' = 'en'
): Promise<RunAccount> {
  const email = runScopedEmail(label);
  const userId = await createAccount(email, 'free');
  sqlExec(`
    update public.users
       set first_name = ${sqlStr(firstName)}, last_name = ${sqlStr(lastName)},
           language = ${sqlStr(language)}, language_set_at = now()
     where id = ${sqlStr(userId)}::uuid;
  `);
  return {
    email,
    password: ACCOUNT_PASSWORD,
    userId,
    firstName,
    lastName,
    name: `${firstName} ${lastName}`,
  };
}

/** Add `userId` to the circle as a non-recipient with `role` (what an accepted invite writes). */
export function addMembership(circleId: string, userId: string, role: 'member' | 'manager'): void {
  sqlExec(`
    insert into circle_memberships (circle_id, user_id, role, is_care_recipient, joined_at, view_only)
    values (${sqlStr(circleId)}::uuid, ${sqlStr(userId)}::uuid, ${sqlStr(role)}, false, now(), false);
  `);
}

export function membershipRole(circleId: string, userId: string): string | null {
  const rows = sqlRows<{ role: string }>(`
    select role from circle_memberships
     where circle_id = ${sqlStr(circleId)}::uuid and user_id = ${sqlStr(userId)}::uuid
  `);
  return rows.length ? rows[0].role : null;
}
