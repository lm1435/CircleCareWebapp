# Web E2E (Playwright + axe)

Real-browser tests that drive the web companion against the **live backend**,
authenticated as the demo account. They catch what the vitest suite can't:
routing failures, white screens, runtime errors, and accessibility violations.

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
that URL must be running and reachable**, and the **demo account must be seeded**.

## Requirements

- Backend reachable at `VITE_API_URL` (see `.env.development`).
- Demo account: `demo@circlecare.app` / `DemoPass123!`
  (override with `PW_DEMO_EMAIL` / `PW_DEMO_PASSWORD`).
- Override the app URL with `PW_BASE_URL` (default `http://localhost:5173`).

## Layout

| File | Purpose |
|------|---------|
| `auth.setup.ts` | Logs in once via the UI; saves session to `e2e/.auth/user.json` (gitignored). |
| `fixtures.ts` | Extended `test` with a worker-scoped `circleId` fixture + `uniqueLabel()` helper for flows. |
| `routes.ts` | Source of truth for crawled routes — **keep in sync with `src/router.tsx`**. |
| `helpers.ts` | `visitAndCheck` (no errors / no white screen) + `checkA11y` (axe, fails at moderate+). |
| `smoke.spec.ts` | Authenticated route crawl (one test per route). |
| `public-smoke.spec.ts` | Logged-out crawl of auth pages. |
| `flows/*.spec.ts` | Critical-path create/edit/delete flows (see below). |

## Flows (`flows/`)

Each flow drives a real user path end-to-end against the live backend and cleans
up after itself (unique `uniqueLabel()` names; the delete IS the cleanup).

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
| `auth` | Logout → /login (logout endpoint stubbed so it doesn't revoke the shared session); bad-credentials error. |
| `navigation` | Click-through every sidebar nav link + header circle-switcher / account menu (Profile, Help, My Circles); asserts URL + render + no error fallback. |
| `calendar-controls` | Week/month toggle + prev / next / today navigation. |
| `tasks-controls` | Status filter + sort options. |
| `vitals-controls` | Type filter + date-range filter. |
| `documents-controls` | Category filter chips. |
| `activity-controls` | "Load more" pagination (grows the feed; annotates a skip if the demo has a single page). |
| `empty-states` | Empty tasks/vitals/documents states + a11y, and the calendar add-CTA from an empty circle. |

**Empty states:** the demo account is at the 5/5 premium circle cap, so a throwaway
empty circle can't be created. `empty-states.spec.ts` instead **stubs each list
endpoint to an empty envelope** (`page.route` on `/api/circles/*/{tasks,vitals,documents,events}`)
on the real circle — deterministic and non-destructive. NOTE: anchor such stubs
to the `/api/` prefix, or the regex also matches the SPA route of the same name
and the browser renders raw JSON. The list pages have no empty-only CTA buttons
(their add actions are always-present header buttons, covered by the CRUD flows),
so this verifies empty-state rendering + a11y + the add entry point from empty.

## Adding coverage

Crawl: add the path to `routes.ts`. Flows: add a `*.spec.ts` under `flows/` —
import `{ test, expect, uniqueLabel }` from `../fixtures`, model it on
`flows/calendar.spec.ts`, use generous (20s+) post-mutation timeouts, and always
clean up. Avoid destructive actions against the shared demo account (no real
invite emails, no global logout, no circle deletion).
