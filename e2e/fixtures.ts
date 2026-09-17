import { test as base, expect, type BrowserContext, type WorkerInfo } from '@playwright/test';
import {
  READ_ONLY_SLOT,
  accountFor,
  readManifest,
  workerSlot,
  type IsolatedAccount,
  type IsolationManifest,
} from './isolation';
import {
  PERSONAS,
  ensurePersona,
  premiumOwnerHandle,
  type PersonaHandle,
  type PersonaName,
} from './personas';
import {
  CONSENT_BASE_URL_ENV,
  CONSENT_PROJECT_NAME,
  POSTHOG_E2E_FAKE_KEY,
  servedPosthogKey,
} from './unhappy';

// ===========================================================================
// Shared fixtures for every authenticated spec.
//
// ISOLATION. Each parallel worker slot gets its OWN account, provisioned by
// globalSetup with its own private clone of the demo account's seeded circles
// (see e2e/isolation.ts for the full rationale). Playwright runs one test at a
// time per worker, so "one account per worker" means no two tests that could
// ever overlap in time share any data: a mutating spec can never observe
// another spec's writes, and no spec can delete a circle another spec is
// reading.
//
// PERSONAS. `test.use({ persona: 'viewOnlyMember' })` (at file or describe
// level) runs those tests as that persona instead of the default premium owner:
// `page` is logged in as the persona, `circleId` is the circle its gate applies
// to, `account` is its login and `personaHandle` carries the rest (owner, seeded
// record ids, the backend flags it must produce). `persona` is a WORKER option,
// so Playwright gives each persona its own worker; the persona's rows are
// provisioned lazily for that worker slot (e2e/personas.ts).
//
// AUTH. Each test logs in FRESH via the API rather than replaying a saved
// `storageState`. The web uses single-use refresh-token rotation, so a shared
// cookie is invalidated the moment any context refreshes it — which is what
// four workers replaying one saved cookie did to each other, and why the crawl
// intermittently reported "no circle to crawl" when the data was plainly
// there. A fresh login is one API call in cookie mode (not a UI round-trip),
// and every login is its own session family, so nothing can rotate a cookie
// another test still holds.
//
// ANALYTICS GUARD. Every worker first reads the `VITE_POSTHOG_KEY` its Vite
// server is really serving and fails loudly unless it is EMPTY (main suite) or
// exactly `phc_e2e_fake` (the `consent` project) — so no run can send real
// analytics. (Guarded at the server, not with a `context.route` block: routing
// disables the browser HTTP cache for every page load in the suite.)
// ===========================================================================

let cachedManifest: IsolationManifest | null = null;
function manifest(): IsolationManifest {
  if (!cachedManifest) cachedManifest = readManifest();
  return cachedManifest;
}

/** Establish a fresh cookie-mode session for `account` in `context`. */
async function apiLogin(
  context: BrowserContext,
  account: IsolatedAccount,
  origin: string
): Promise<void> {
  const res = await context.request.post('/api/auth/login', {
    headers: { 'X-Session-Mode': 'cookie', Origin: origin },
    data: { email: account.email, password: account.password },
  });
  if (!res.ok()) {
    throw new Error(
      `E2E apiLogin failed for ${account.email}: ${res.status()} ${await res.text()}`
    );
  }
}

/**
 * True when the spec explicitly asked for a logged-out context by setting
 * `storageState` to an empty jar. A path (string) or an undefined value both
 * mean "no such request".
 */
function wantsAnonymousContext(storageState: unknown): boolean {
  if (!storageState || typeof storageState !== 'string') {
    const state = storageState as { cookies?: unknown[]; origins?: unknown[] } | undefined;
    return Array.isArray(state?.cookies) && state.cookies.length === 0;
  }
  return false;
}

export interface WorkerFixtures {
  /**
   * WHO the tests run as. Default `'premiumOwner'` (the pre-existing clone).
   * Set with `test.use({ persona: 'freeOwner' })`. See e2e/personas.ts.
   */
  persona: PersonaName;
  /** Everything about the persona: login, `circleId`, owner, seeded ids, expected flags. */
  personaHandle: PersonaHandle;
  /** This worker's login (the persona's email/password/userId/circleIds). */
  account: IsolatedAccount;
  /** The persona's primary circle — the one its gate applies to. */
  circleId: string;
  /**
   * The account's SECOND circle. Its only job is to keep the circle picker
   * rendering (a single-circle account is auto-redirected straight into its
   * circle), but a spec that needs a second circle can use it. Throws for a
   * persona that has only one circle (freeOwner, freeMember, viewOnlyMember).
   */
  secondCircleId: string;
  /** Auto: verifies the served analytics key (see the header). */
  analyticsServerGuard: void;
}

function buildTest(resolveSlot: (workerInfo: WorkerInfo) => string) {
  return base.extend<object, WorkerFixtures>({
    persona: ['premiumOwner', { scope: 'worker', option: true }],

    analyticsServerGuard: [
      async ({}, use, workerInfo) => {
        const isConsent = workerInfo.project.name === CONSENT_PROJECT_NAME;
        const baseURL = workerInfo.project.use.baseURL;
        if (isConsent && !process.env[CONSENT_BASE_URL_ENV]) {
          throw new Error(
            `[e2e consent] ${CONSENT_BASE_URL_ENV} is not set. The '${CONSENT_PROJECT_NAME}' project needs its own ` +
              `Vite server started with VITE_POSTHOG_KEY=${POSTHOG_E2E_FAKE_KEY} (see e2e/README.md, "Consent project").`
          );
        }
        if (!baseURL) throw new Error(`[e2e analytics guard] project ${workerInfo.project.name} has no baseURL`);
        const served = await servedPosthogKey(baseURL);
        const allowed = isConsent ? POSTHOG_E2E_FAKE_KEY : '';
        if (served !== allowed) {
          throw new Error(
            `[e2e analytics guard] ${baseURL} serves VITE_POSTHOG_KEY=${served ? `"${served.slice(0, 8)}…"` : '(empty)'}; ` +
              (isConsent
                ? `the consent server must serve exactly "${POSTHOG_E2E_FAKE_KEY}" (all its PostHog traffic is intercepted).`
                : `the main suite must run with NO key so it can never send analytics. Unset it ` +
                  `(check .env.development.local) or start Vite with VITE_POSTHOG_KEY=.`)
          );
        }
        await use();
      },
      { scope: 'worker', auto: true },
    ],

    personaHandle: [
      async ({ persona }, use, workerInfo) => {
        if (!(PERSONAS as readonly string[]).includes(persona)) {
          throw new Error(`Unknown persona "${persona}". Known: ${PERSONAS.join(', ')}`);
        }
        const slot = resolveSlot(workerInfo);
        if (persona === 'premiumOwner') {
          await use(premiumOwnerHandle(accountFor(manifest(), slot)));
          return;
        }
        if (slot === READ_ONLY_SLOT) {
          throw new Error('readOnlyTest runs as the read-only premium owner only; it cannot take a persona.');
        }
        await use(await ensurePersona(slot, persona));
      },
      { scope: 'worker' },
    ],
    account: [
      async ({ personaHandle }, use) => {
        const { slot, email, password, userId, circleIds } = personaHandle;
        await use({ slot, email, password, userId, circleIds });
      },
      { scope: 'worker' },
    ],
    circleId: [
      async ({ personaHandle }, use) => {
        await use(personaHandle.circleId);
      },
      { scope: 'worker' },
    ],
    secondCircleId: [
      async ({ personaHandle }, use) => {
        const second = personaHandle.circleIds[1];
        if (!second) {
          throw new Error(`persona ${personaHandle.persona} has a single circle; there is no secondCircleId`);
        }
        await use(second);
      },
      { scope: 'worker' },
    ],
    // Fresh login per test (see header note). Runs before the test body touches
    // the page, so the first navigation is already authenticated.
    //
    // EXCEPT when the spec asked to be logged OUT. A few specs declare
    // `test.use({ storageState: { cookies: [], origins: [] } })` to drive a
    // genuinely anonymous page (the bad-credentials path, the invite landing
    // page's logged-out CTAs). That used to be enough on its own, because the
    // session came from a project-level storageState this cleared. Now that the
    // session is minted here instead, an unconditional login would silently
    // re-authenticate exactly the contexts those specs need anonymous — so the
    // declaration is honoured explicitly: an empty cookie jar means "no login".
    //
    // The login's Origin is the project's baseURL (the backend's cookie-mode
    // CSRF allowlist is WEB_ORIGIN, so each Vite needs a backend whose
    // WEB_ORIGIN is that Vite's origin).
    page: async ({ page, context, account, storageState, baseURL }, use) => {
      if (!wantsAnonymousContext(storageState)) {
        await apiLogin(context, account, new URL(baseURL ?? 'http://localhost:5173').origin);
      }
      await use(page);
    },
  });
}

/**
 * The default authenticated `test`: runs as THIS WORKER's isolated account (or
 * its persona). Use it for anything that writes.
 */
export const test = buildTest((workerInfo) => workerSlot(workerInfo.parallelIndex));

/**
 * A `test` bound to the single READ-ONLY account.
 *
 * `smoke.spec.ts` crawls a circle list and asserts routes render; it needs a
 * target that nothing else in the suite can move. This account is provisioned
 * by globalSetup and no other spec is allowed to authenticate as it, so its
 * circles, members and events are byte-identical from the first test of the run
 * to the last. Because the crawl only READS, several workers can share it
 * safely — each still mints its own session.
 */
export const readOnlyTest = buildTest(() => READ_ONLY_SLOT);

export { expect };
export type { PersonaHandle, PersonaName };

/** A run-unique label so parallel/repeat runs never collide and cleanup is easy. */
export function uniqueLabel(prefix: string): string {
  return `E2E ${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
}
