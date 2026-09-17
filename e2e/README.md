# Web E2E (Playwright + axe)

Real-browser tests that drive the web companion against the **live backend**,
each worker authenticated as its **own isolated account** (see "Isolation"
below). They catch what the vitest suite can't: routing failures, white screens,
runtime errors, and accessibility violations. On top of that sits an
**unhappy-path foundation**: personas in every gated state, fault injection,
request counting, database/mail helpers and a consent project that decodes
analytics without sending any.

## Run

```bash
# from webapp/
npm run test:e2e          # headless, all specs
npm run test:e2e:headed   # watch the browser
npm run test:e2e:ui       # Playwright UI mode (pick/replay tests)
npm run test:e2e:report   # open the last HTML report
```

The config starts the Vite dev server automatically (or reuses one already on
:5173). Vite reads `VITE_API_URL` from `.env.development`, so **the backend at
that URL must be running and reachable**, and the **demo account must be seeded**
(it is the template the per-worker accounts are cloned from).

That committed value is the **local backend** (`http://localhost:3001`) — the
case that works from a fresh clone. To run against a tunnel or any other remote
backend instead, override it rather than editing the tracked file: put
`VITE_API_URL=…` in `.env.development.local` (gitignored, loaded after
`.env.development`), or prefix the command (`VITE_API_URL=… npm run test:e2e`).
A tunnel URL changes every session, so it must never be the committed one.

### Your own server pair (the normal way when anyone else is working)

The backend's cookie-mode login only accepts an `Origin` in its allowlist —
`WEB_ORIGIN` plus `http://localhost:5173` in development
(`backend/src/middleware/webSession.ts`, `getAllowedWebOrigins`). A Vite on any
other port therefore needs a backend whose `WEB_ORIGIN` is exactly that Vite's
origin, or every login fails. One backend serves ONE extra origin, so run one
backend per Vite:

```bash
# backend (pick a free port pair per person/agent; never touch :3001 / :5173)
cd backend && PORT=3104 WEB_ORIGIN=http://localhost:5197 \
  npx ts-node-dev --transpile-only --require dotenv/config src/server.ts
# vite
cd webapp && VITE_API_URL=http://localhost:3104 npx vite --port 5197 --strictPort
# tests
cd webapp && PW_BASE_URL=http://localhost:5197 npx playwright test --reporter=line
```

Stop only your own processes: `lsof -ti tcp:<port> -sTCP:LISTEN | xargs kill`.

## Requirements

- Backend reachable at `VITE_API_URL` (see above).
- A local Postgres at `PW_DB_URL`
  (default `postgresql://postgres:postgres@127.0.0.1:55322/postgres`) and a local
  Supabase at `PW_SUPABASE_URL` (default `http://127.0.0.1:55321`) — the stack in
  `backend/supabase` (Mailpit on :55324, override with `PW_MAILPIT_URL`).
- The demo seed present (`node scripts/seed-demo-account.mjs` from the repo
  root). It is the TEMPLATE the isolated accounts are cloned from — no spec logs
  in as `demo@circlecare.app` any more.
- Nothing extra for `flows/timezone-frame.spec.ts`: when the run includes
  `chromium` and both URLs above are local, `globalSetup` idempotently ensures the
  cross-timezone circle it logs in to (`tz-owner-tokyo@tz.test`, recipient in
  `Asia/Tokyo`; `e2e/crossTimezoneSeed.ts`, look for the `[e2e tz-seed]` line).
  The spec never skips: a missing seed or a failed login is a FAILURE naming the
  cause.
- The Vite server under test must serve **no** `VITE_POSTHOG_KEY` (every worker
  checks; see "Consent project").
- Override the app URL with `PW_BASE_URL` (default `http://localhost:5173`).

### Local-only guard

The harness **hard-deletes** rows (`care_circles`, `public.users`, `auth.users`,
Storage objects under a purged circle) and creates auth users with the service
key, so it refuses any target that is not a local stack. The check
(`nonLocalDbTargetReasons` in `e2e/db.ts`) runs in `globalSetup` and
`globalTeardown` before any database or admin-API work, and again inside every
`psql` call, every Supabase admin/storage call, every purge, `dbQuery`/`dbCount`,
and every Mailpit call. It rejects:

- a `PW_DB_URL` host other than `127.0.0.1`, `localhost` or `::1` (an empty host
  is rejected too);
- libpq `host=` / `hostaddr=` query params that are not local (`host` may also
  be an absolute unix-socket path), and any `service=` param;
- a non-local `PGHOST` / `PGHOSTADDR`, or any `PGSERVICE`, in the environment;
- a non-local `PW_SUPABASE_URL` (and a non-local `PW_MAILPIT_URL` for mail).

`psql` is also launched with the connection passed explicitly and `PGHOST`,
`PGHOSTADDR`, `PGSERVICE`, `PGSERVICEFILE` and `PGSYSCONFDIR` removed from its
environment. A refused target fails `globalSetup` with a message listing every
reason. Runs made up only of backend-free projects (below) never reach the check.

**Deliberate non-local target:** set `PW_ALLOW_NONLOCAL_DB=1`. That is the only
way past the guard, and it means the isolated `e2e-iso-*` accounts **and the
circles they own will be hard-deleted on that target**. The default is to refuse.

Eight projects need none of the above. The three `a11y-*` ones crawl the public
routes with no session and no backend (`npm run test:a11y` skips provisioning
entirely), and `picker-geometry`, `picker-geometry-sheet` plus the three
`coarse-pointer-*` ones drive a harness page rather than the app:

```bash
npx playwright test --project=picker-geometry        # anchored (fine pointer)
npx playwright test --project=picker-geometry-sheet  # sheet (devices['Pixel 5'])
npx playwright test --project=coarse-pointer-webkit    # needs: npx playwright install webkit
npx playwright test --project=coarse-pointer-chromium  # devices['Pixel 5']
npx playwright test --project=coarse-pointer-control   # the fine-pointer control
```

`coarse-pointer-webkit` is the only non-Chromium project in the config. WebKit
lives in `~/Library/Caches/ms-playwright/`, outside the repo, so a fresh machine
needs that one install — nothing else.

## Concurrent runs (run ids)

Several `playwright test` runs may share one database at the same time (two
terminals, several agents). Each run gets a **run id** (`e2e/runId.ts`), minted in
`playwright.config.ts` and inherited by globalSetup, every worker and
globalTeardown:

- every account address is `e2e-iso-<runId>-<slot…>@circlecare.test`;
- the manifest lives in `e2e/.auth/runs/<runId>/` (removed at teardown; keep it
  with `PW_KEEP_RUN_DIR=1`);
- test artifacts go to `test-results/<runId>/` (override `PW_OUTPUT_DIR`); set
  `PW_HTML_REPORT_DIR` per run if two runs finish together and you want both
  HTML reports;
- **teardown purges only this run's accounts**;
- **globalSetup sweeps only dead runs**: any run whose NEWEST account
  (`created_at` in `auth.users` / `public.users`) is older than
  `PW_STALE_RUN_HOURS` (default 6, minimum 1), plus pre-run-id legacy accounts
  (`e2e-iso-w0@…`) under the same age rule. A live run's accounts are minutes
  old, so another run can never sweep them.

`PW_RUN_ID=<1-16 lowercase letters/digits>` pins the id (handy in logs). It must
be unique among runs that overlap in time.

Proven by running two full suites at once against one backend while polling the
per-run account counts every 2s (no run's count ever dropped before its own
teardown), and by seeding a 7-hour-old run, a legacy account and a fresh "live"
run: the stale and legacy accounts were swept, the live one kept.

**Load, not isolation, is the limit.** Two full runs at the default 4 workers
each against ONE ts-node-dev backend + ONE Vite took 9 min each and produced
timeouts (the app stuck on its boot spinner). The same two runs at
`--workers=2` each were both clean (245 passed, 0 failed, 0 flaky). Share a
server pair only with `--workers` summing to about 4; otherwise give each run
its own pair.

`--reporter=line` on the command line REPLACES the configured reporters, so no
HTML report is written; add `--reporter=line,html` if you want one.

## Isolation — read this before adding a spec

Every authenticated spec runs as an account that **only its own worker can
see**. `globalSetup` provisions them; `globalTeardown` removes them.

| Slot | Who uses it | May mutate? |
|------|-------------|-------------|
| `w0` … `wN` | one per parallel worker slot (`testInfo.parallelIndex`) | yes |
| `ro` | `smoke.spec.ts` only, via `readOnlyTest` | **never** |

Each account owns a private **deep clone** of the demo account's two seeded
circles (`e2e/isolation.ts`), so specs see the same rich data they always did.
Playwright runs one test at a time per worker, so "one account per worker" means
no two tests that could overlap in time share any data.

Consequences for a new spec:

- Import `{ test, expect }` from `../fixtures`. Never build a context from a
  saved `storageState` — no project sets one, and the shared cookie it replaced
  was the suite's largest flake source (single-use refresh-token rotation: four
  workers replaying one cookie revoke it for each other).
- Use the `circleId` worker fixture. Do not resolve "the first circle" out of
  the picker; that race is what produced "demo account has no circle to crawl"
  while the data was plainly there.
- Need credentials or the user id? Take the `account` fixture. Do not hardcode
  `demo@circlecare.app`.
- Cleaning up is still good manners, but it is no longer load-bearing: a spec
  that dies mid-mutation only damages its own worker's account, and
  `globalTeardown` deletes that account wholesale. Data a spec mutates DOES
  persist for later tests in the same worker slot (same as before), so leave
  the seeded records you rely on in place.
- Avoid `test.beforeAll` for anything that can fail. A `beforeAll` failure is
  reported once per worker and marks the file's remaining tests "did not run" —
  16 crawl tests became "4 failed + 12 did not run", which reads like a
  regression and hides how much of the suite never executed.

## Personas

`e2e/personas.ts`. Put `test.use({ persona })` at the **TOP LEVEL of the spec
file** — `persona` is a worker option, and Playwright rejects it inside
`describe` ("it forces a new worker"). One persona per file.

```ts
import { test, expect } from '../fixtures';
import { API_ERRORS, failRequest } from '../unhappy';

test.use({ persona: 'viewOnlyMember' });

test('view-only member cannot post a note', async ({ page, circleId, account, personaHandle }) => {
  // page: logged in as the persona; circleId: the circle its gate applies to
  // account: { email, password, userId, circleIds, slot }
  // personaHandle: + persona, ownerUserId, ownerEmail, liveCircleIds,
  //                  archivedCircleIds, seeded {medicationId, appointmentId, taskId,
  //                  eventNoteId, careNoteId, vitalId, documentId, emergencyInfoId},
  //                  expected (the backend flags, below)
  await page.goto(`/circles/${circleId}/notes`);
});
```

Rows are ones the product can produce; derived flags (`can_edit`,
`is_premium_circle`, `access_level`, `read_only`) are never written. The inputs
the backend derives from are `users.plan_tier` (cached tier,
`backend/src/services/tierService.ts:83-105`), `care_circles.archived_at` /
`selected_on_downgrade`, and the stored seat flag `circle_memberships.view_only`
(written by `applyCaregiverCap`, `tierService.ts:359-449`, and invite joins,
`services/inviteJoin.ts:151`). Derivation: `services/circleAccess.ts:264-408`.

| Persona | Rows | GET /circles/:id | list `read_only` | AI entry | Gates |
|---|---|---|---|---|---|
| `premiumOwner` (default) | premium, owns 2 cloned circles (unchanged) | full / can_edit / premium | false | available | — |
| `freeOwner` | free, owns ONE circle, cap applied (owner + 1 active caregiver) | edit / can_edit / not premium | false | upgrade | AI 402 `SUBSCRIPTION_REQUIRED`; create circle 402; invite 402 (at the cap) |
| `freeMember` | 'member', EARLIEST non-owner caregiver of a free host's only circle | edit / can_edit / not premium | false | hidden | AI 402 |
| `viewOnlyMember` | 'member' who joined LAST in a free host's only circle; cap made the seat `view_only` | view / no edit / `view_only` / premium false (hardcoded, `circleAccess.ts:332-341`) | false | hidden | writes 403 `VIEW_ONLY` (`middleware/circleAccess.ts:59-67`); AI 403 `VIEW_ONLY` |
| `frozenCircleOwner` | free, owns TWO circles, none `selected_on_downgrade` (needs selection) | view / no edit / not premium | **true** | upgrade | writes 403 `SUBSCRIPTION_REQUIRED`; `needsCircleSelection: true` |
| `archivedCircleOwner` | premium; `circleId` archived exactly as `DELETE /api/circles/:id` leaves it (`archived_at`, `archive_reason='user_deleted'`), plus one live circle (`secondCircleId`) | **not gated** — the detail route has no archived check and still answers 200 with full flags | not listed | — | the list hides it; `/circles` auto-enters the live circle |

Every non-default persona's circle is a clone of the first template circle and
carries a medication series, appointment, task, event note and emergency info
(cloned) plus a care note, a blood-pressure vital and a PDF document with a real
Storage object (seeded). `freeOwner`, `freeMember` and `viewOnlyMember` have a
single circle, so `/circles` auto-redirects into it and `secondCircleId` throws.
Personas are provisioned lazily per worker slot the first time a worker asks,
and reused by later workers in that slot.

Proof: `e2e/persona-proofs/<persona>.proof.spec.ts` (one file per persona, body
in `personaProof.ts`) asserts, per persona, the stored inputs, the server flags
against the constants in `PERSONA_EXPECTATIONS`, the client's own
`resolveAiEntry` over those flags, the refusals, and one page (Assistant entry
present/absent, view-only banner present/absent). Seeding a persona wrong fails
it (verified: free owner left premium, view-only member joined first, archived
circle not archived → exactly those tests failed).

## Unhappy-path helpers (`e2e/unhappy.ts`)

Proof: `e2e/unhappy.proof.spec.ts`. Path patterns match the URL **pathname**:
`:name`/`*` = one segment, `**` = the rest, or a RegExp. Document navigations are
never matched, so `/api/…` patterns cannot catch an SPA route.

| Helper | Use |
|---|---|
| `countRequests(page, method, pattern)` → `{ count, requests, expectCount(n, {settleMs=1000, timeoutMs=15000}), dispose() }` | Start before the action. Counts requests the browser SENT (a faulted or held one still counts). `expectCount` waits for quiet, then asserts exactly `n` (too few or too many fails). |
| `failRequest(page, method, pattern, { status=500, code, message, details, body, headers, abort, delayMs, times=1 })` → `{ hits, remaining, requests, expectHits(n), dispose() }` | Answers the next `times` matches with the backend envelope `{ success:false, error:{ code, message, details? } }` (code defaults from status), or aborts (`abort: true`). Then passes through. Presets: `API_ERRORS.viewOnly`, `.writeSubscriptionRequired`, `.aiSubscriptionRequired`, `.circleSubscriptionRequired`, `.serviceUnavailable`, `.serverError`, `.upstreamTimeout`, `.rateLimit`, `.validation`, `.notFound`. |
| `holdRequest(page, method, pattern)` → `{ requests, waitForHeld(n=1, {timeoutMs}), release(), releaseWith(fault), dispose() }` | Keeps matching requests pending until released — for double-click-while-pending. |
| `dbQuery<T>(select)` / `dbCount(select)` / `sqlStr` | Local-guarded psql. One SELECT, no semicolon. |
| `apiSession(request, account)` → `{ token, get, post, put, patch, delete }` | Bearer-token API calls. Use the `request` fixture, not `page.request` (that shares the page's cookie jar). `errorCodeOf(res)` reads `error.code`. |
| `readVerificationCode(email, { since, timeoutMs=20000 })` | Newest 6-digit code mailed to `email`, from Mailpit. See "Mail" — on the current stack auth mail does not reach Mailpit. |
| `generateSignupOtp(email, password?)` | Creates the unconfirmed user (if absent) and returns a signup OTP that `POST /api/auth/verify-otp` accepts — no mail, no hook. Pre-claims `welcome_email_sent` so verify sends nothing. |
| `runScopedEmail(label)` (`isolation.ts`) | `e2e-iso-<runId>-<label>@circlecare.test` — use for ANY account a spec creates; teardown purges it. |
| `posthogCapture(page)` | Consent project only — see below. |

Routing (`failRequest`, `holdRequest`, `posthogCapture`) disables the browser
HTTP cache for that page, so use them only in the tests that need them.

### Mail and signup

- `backend/supabase/config.toml` currently has `[auth.hook.send_email] enabled = true`
  pointing at `http://host.docker.internal:3001/api/auth/send-email-hook` (the
  running container agrees). Auth mail therefore never reaches Mailpit; with
  nothing on :3001 GoTrue refuses the signup (`422 hook_timeout_after_retry`) and
  `POST /api/auth/signup` answers **400 `SIGNUP_FAILED`** after ~5s (no user row). With a
  backend on :3001 the hook sends through Resend instead. Do not rely on a real
  signup e-mail: stub `POST /api/auth/signup` with `failRequest`/`page.route`
  for the form, and use `generateSignupOtp` for the verify step.
- `@example.com/.org/.net` signups fake-succeed (200, no user) by design
  (`isEmailBlocked`); a real signup is 201.
- A successful `verify-otp` sends the welcome e-mail unless
  `welcome_email_sent` is already claimed — `generateSignupOtp` claims it.
- Keep invites to `@example.com` (blocked, never sent).
- **Nothing may listen on host :3001 while the auth-invites specs run.** The
  tests that make GoTrue send auth mail for real (signup "existing email" and
  "real backend 400", forgot-password "unknown email", verify "resend failure")
  assume the hook is unreachable. `assertSendEmailHookUnreachable()`
  (`unhappy/auth-invites/_helpers.ts`, a TCP connect to 127.0.0.1/::1:3001)
  FAILS each of them with a clear message when something is there: the hook
  would reach it, a dev backend would send REAL mail through Resend, and the
  expected outcomes (400 `SIGNUP_FAILED`, no mail) would no longer hold. Run your
  own backend on another port (see "Your own server pair").

## Consent project

The main suite's Vite has no `VITE_POSTHOG_KEY`, so posthog-js never loads.
`*.consent.spec.ts` run in the `consent` project against a SECOND server pair
built with a fake key, and every request to `*.posthog.com` is intercepted,
decoded and never sent.

```bash
cd backend && PORT=3105 WEB_ORIGIN=http://localhost:5198 \
  npx ts-node-dev --transpile-only --require dotenv/config src/server.ts
cd webapp && VITE_API_URL=http://localhost:3105 VITE_POSTHOG_KEY=phc_e2e_fake \
  npx vite --port 5198 --strictPort
cd webapp && PW_BASE_URL=http://localhost:5197 PW_CONSENT_BASE_URL=http://localhost:5198 \
  npx playwright test --project=consent --reporter=line
```

- The project is in a run when `PW_CONSENT_BASE_URL` is set or
  `--project=consent` is named. Named without the URL, it **fails** (not skips).
  A bare full run without the URL leaves it out.
- Guard (`analyticsServerGuard`, every worker): the main suite's server must
  serve an EMPTY key, the consent server exactly `phc_e2e_fake`, read from the
  served `src/lib/env.ts`. Anything else fails the worker.
- `setup` (a dependency) still logs in against `PW_BASE_URL`.

```ts
import { consentTest as test, expect, presetAnalyticsConsent } from '../consent';

test('declined visitor is never identified', async ({ page, posthog, account, circleId }) => {
  await presetAnalyticsConsent(page, 'declined', account.userId); // 'granted' | 'declined' | 'unasked'
  await page.goto(`/circles/${circleId}/notes`);
  const pv = await posthog.waitForEvent('$pageview');            // { event, distinctId, properties, set, … }
  await posthog.expectNoEvent('$identify');                      // waits 5s
});
```

`posthog`: `events`, `requests` (kind/compression/decodeError), `captures(name?)`,
`identifies()`, `waitForEvent(name, { timeoutMs=15000, predicate })`,
`expectNoEvent(name, { settleMs=5000 })`, `clear()`, plus (consent fixture)
`beacons`, `beaconEvents`, `escapedRequests()`, `decodeFailures()`,
`integrityProblems(settleMs)`. Bodies are decoded from `compression=gzip-js`,
base64 `data=` forms or JSON. `/flags` gets an empty flag set; lazy SDK files are
served from `node_modules/posthog-js/dist`.

**Nothing reaches PostHog — three layers** (`e2e/consent.ts`):

1. `posthogCapture` routes every `*.posthog.com` request at the CONTEXT level and
   answers it locally.
2. **Unload flush.** When a page unloads inside the ~3s batch window (reload, full
   navigation) posthog-js sends the queue with `navigator.sendBeacon(…&beacon=1)`.
   Chromium issues that as a `ping` Playwright's routing never sees — it used to
   reach the real host with the fake key and user UUIDs, undecoded. The SDK's host
   is its built-in default (no `api_host` in `src/lib/posthog.ts`), so there is no
   local sink to point it at; instead an init script wraps `sendBeacon`: PostHog
   beacons are NOT sent, their body is read synchronously (a `Blob` proxy records
   the parts posthog-js builds) and handed to Node via a binding, with a
   sessionStorage copy re-delivered at the next document start (de-duplicated).
   The events land in `posthog.events` like any other.
3. **DNS.** The consent workers' Chromium runs with
   `--host-resolver-rules=MAP *.posthog.com ~NOTFOUND` (a `browser` fixture
   override), so an unknown transport cannot reach the host either.

**Integrity is enforced, not assumed.** The fixture FAILS the test at teardown when
any `*.posthog.com` request was attempted that the route did not answer
(`escapedRequests()`, from a context-level `request` listener) or any captured
body failed to decode (`decodeFailures()`); `expectNoEvent` checks the same before
it passes. A "no `$identify`" can therefore never pass because events escaped or
were undecodable. Proof: `posthog.proof.consent.spec.ts` "unload flush" (reload
inside the batch window → beacon events decoded, nothing escaped, no PostHog
response from a server address); with the wrapper removed from a copy of
`consent.ts` it goes red.

**Falsifying a consent spec against a mutated product.** Copy the webapp
(`rsync -a --exclude node_modules --exclude dist --exclude playwright-report
--exclude test-results webapp/ <scratch>/copy/`), symlink `node_modules`, set
`server.fs.strict: false` in the copy's `vite.config.ts`, apply the mutation, and
serve the copy as a consent server (own backend + `VITE_POSTHOG_KEY=phc_e2e_fake`).
`offline-withdraw-reconcile.consent.spec.ts` was split this way: removing only the
reconcile's pre-read snapshot turns only its "PRE-READ SNAPSHOT" test red, and
removing only the decision-time check turns only "DECISION-TIME CHECK" red.

**Bot filter:** posthog-js 1.386.6 silently drops every capture from a browser
whose UA or `userAgentData.brands` says HeadlessChrome, or whose
`navigator.webdriver` is true. `posthogCapture` masks exactly those signals with
an init script; without it no event is ever sent and every "no event" assertion
is vacuous.

`presetAnalyticsConsent` writes the local record (`cc_analytics_enabled`,
`cc_analytics_consent_user`) once per tab before boot. The server's
`users.analytics_consent_granted_at/withdrawn_at` wins when set; fresh accounts
have neither.

## Rate limits (auth, from 127.0.0.1)

- `backend/.env` has `NODE_ENV=development`, which (a) turns the DURABLE
  (Postgres) rate-limit store OFF — buckets are in-memory **per backend process**
  and reset on restart (`middleware/durableRateLimitStore.ts:252-281`; boot log
  "Durable store DISABLED") — and (b) raises the dev ceilings
  (`middleware/rateLimit.ts`): auth 2000/5min, login 2000/5min (failures only),
  OTP 2000/15min, session refresh 20000/15min, invite 1000/h, invite preview
  100/15min, global 10000/min. Each agent running its OWN backend has its own
  buckets.
- No dev relaxation: `contactRateLimit` and `feedbackRateLimit` (5/hour per IP).
  Do not submit the contact/feedback forms for real more than a few times an
  hour; stub them.
- `DURABLE_RATE_LIMIT=true|false` forces the store either way. There is no
  env var to disable limits.
- The AI assistant has its own in-memory 50 messages/24h per user
  (`routes/ai.ts:40`) — persona accounts are fresh per run.
- To test a limit MESSAGE, stub it: `failRequest(page, 'POST', '/api/auth/login', API_ERRORS.rateLimit)`.
  Never burst real requests to reach a limit.

## Layout

| File | Purpose |
|------|---------|
| `auth.setup.ts` | The `setup` project: environment preflight (isolation manifest present) + a real-UI login check. Saves no session. |
| `db.ts` | `psql` helpers (`sqlRows` / `sqlExec` / `sqlStr`) and the local-only guard — no database driver is added to package.json. |
| `runId.ts` | Run id, stale-run threshold, consent-project inclusion. |
| `isolation.ts` | Per-worker, run-scoped accounts + the circle deep-clone + purges. Start here to understand the isolation model. |
| `personas.ts` | Persona provisioning and `PERSONA_EXPECTATIONS`. |
| `unhappy.ts` | Request counting, fault injection, holds, DB, API session, mail/OTP, PostHog capture. |
| `consent.ts` | `consentTest` (+ `posthog` fixture) and `presetAnalyticsConsent`. |
| `global-setup.ts` / `global-teardown.ts` | Sweep stale runs, provision / remove this run's accounts. |
| `fixtures.ts` | `test` (this worker's account or persona) and `readOnlyTest` (the crawl account), `persona` option, worker-scoped `account` / `circleId` / `secondCircleId` / `personaHandle`, the analytics guard, `uniqueLabel()`. |
| `persona-proofs/` | One proof spec per persona (`personaProof.ts` holds the body). |
| `unhappy.proof.spec.ts` | Proof of every helper, including the failing case. |
| `consent/posthog.proof.consent.spec.ts` | Proof of `posthogCapture` (consent project). |
| `routes.ts` | Source of truth for crawled routes — **keep in sync with `src/router.tsx`**. |
| `helpers.ts` | `visitAndCheck` (no errors / no white screen) + `checkA11y` (axe, fails at moderate+). |
| `smoke.spec.ts` | Authenticated route crawl (one test per route) against the read-only account. |
| `public-smoke.spec.ts` | Logged-out crawl of auth pages. |
| `picker-geometry.spec.ts` | The date/time picker's open-time SCROLL arithmetic, measured in real pixels, plus the SHEET's own geometry (floor-flush, 85% height cap, 44px rows, four week rows at 390x360, no break-out at 320px). Two projects, one file: `picker-geometry` is the anchored/fine-pointer half and `picker-geometry-sheet` the touch half; they skip each other on `isMobile`. Backend-free; drives `harness/picker-geometry.html`. The one thing jsdom cannot express — see the spec header. |
| `coarse-pointer.spec.ts` | The touch PRESENTATION: on `devices['iPhone 13']` (WebKit) and `devices['Pixel 5']` the pickers render a trigger, open our sheet from a tap on the input, make that input `readOnly` (the only thing that stops WebKit summoning its own picker from focus), fetch the panel chunk and pass axe — and the suppression class's width effect is pinned per engine, which is the EVIDENCE that `readOnly` is required. Backend-free. Read its header for what WebKit-on-macOS does **not** prove about iOS Safari. |
| `harness/` | Not part of the app: Vite-served pages that mount ONE `TimeField`/`DateField` (real layout for the geometry spec) and four bare `<input>`s (the indicator-width probe). |
| `flows/*.spec.ts` | Critical-path create/edit/delete flows (see below). |

## Flows (`flows/`)

Each flow drives a real user path end-to-end against the live backend and cleans
up after itself (unique `uniqueLabel()` names; the delete IS the cleanup).
Exception: `medications.spec.ts` cleans up via a pure-API `afterEach` sweep
(`ZZ_E2E_MED_%` series, `deleteScope=series` per root) — its roster cards group
multiple series per card, so UI-click deletion races card re-grouping/remounts.

| Flow | Covers |
|------|--------|
| `calendar` | Create → edit → delete a calendar task. |
| `tasks` | Create → complete → delete a task. |
| `vitals` | Log → edit → delete a manual reading. |
| `documents` | Upload (real file) → rename → delete a document. |
| `emergency` | Edit a medical field, verify persistence, restore. |
| `profile` | Edit display name + toggle a setting, verify, restore (never email/password). |
| `members` | List renders + invite-form validation + cancel (**non-destructive — sends no invite**). |
| `circle` | Edit circle name + restore; create-modal validation + cancel (**never creates/deletes a circle**). |
| `ai` | Open assistant, send a message, verify it posts (graceful on slow AI). |
| `auth` | Sign out (with its confirm dialog) → /login — the logout endpoint is NOT stubbed any more, so the real revoke runs; bad-credentials error. |
| `navigation` | Click-through every sidebar nav link + header circle-switcher / account menu (Profile, Help, All circles); asserts URL + render + no error fallback. |
| `calendar-controls` | Week/month toggle + prev / next / today navigation. |
| `tasks-controls` | Status filter + sort options. |
| `vitals-controls` | Type filter + date-range filter. |
| `documents-controls` | Category filter chips. |
| `activity-controls` | "Load more" pagination (grows the feed; annotates a skip if the demo has a single page). |
| `empty-states` | Empty tasks ("No open tasks" + a11y), vitals/documents states + a11y, the calendar add-CTA from an empty circle, and the meds empty state (its add CTA opens the create modal). |

**Empty states:** `empty-states.spec.ts` **stubs each list
endpoint to an empty envelope** (`page.route` on `/api/circles/*/{tasks,vitals,documents,events}`)
on the real circle — deterministic and non-destructive. NOTE: anchor such stubs
to the `/api/` prefix, or the regex also matches the SPA route of the same name
and the browser renders raw JSON. The list pages have no empty-only CTA buttons
(their add actions are always-present header buttons, covered by the CRUD flows),
so this verifies empty-state rendering + a11y + the add entry point from empty.

## Adding coverage

Crawl: add the path to `routes.ts`. Flows: add a `*.spec.ts` under `flows/` —
import `{ test, expect, uniqueLabel }` from `../fixtures`, model it on
`flows/calendar.spec.ts`, use generous (20s+) post-mutation timeouts, and clean
up. Destructive actions are fine now — they land in this worker's own account —
but keep real outbound email off the table (`@example.com` invitees; accounts a
spec creates via `runScopedEmail`). Gated behaviour: pick a persona (top-level
`test.use`), and prefer the real refusal over a stub; stub (`failRequest`) the
states a persona cannot reach (503, 500, network loss, rate limits).

### Debugging a click that "intercepts pointer events"

That error names the element that won the hit test and reads like a selector
problem; it often is not. `diagnoseClickObstruction()` in `helpers.ts` resolves
the target's click point, asks the DOM what is painted there, and walks up for
the nearest CLIPPING ancestor — target inside the clip rect means a stacking
problem, target outside it means the control is not painted at all and no
`z-index` can save it. Re-measure at a second viewport HEIGHT too: a failure
that reproduces at 1280x720 and not at 1440x900 is space-dependent, which is
exactly why it shows up as flake.
