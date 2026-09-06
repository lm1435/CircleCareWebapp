/**
 * Route-splitting guard (Task W6b).
 *
 * `src/router.tsx` used to statically `import` all 24 page components, so
 * every visitor's entry bundle paid for every authenticated page even though
 * AuthGuard blocks all of them until a session resolves. This test reads the
 * router SOURCE with `node:fs` (never imports it — importing would just
 * execute `createBrowserRouter` against jsdom, telling us nothing about how
 * Vite will chunk it) and asserts, textually:
 *
 *   - every authenticated page is loaded via `React.lazy(() => import(...))`,
 *     never a static `import X from '@/pages/X'`
 *   - every public / pre-auth page (rendered before any session exists, so
 *     lazy-loading it would only add a network round trip to the critical
 *     path) keeps its static import
 *   - `src/App.tsx` provides exactly ONE `<Suspense>` boundary to catch all of
 *     the above (plus the on-demand Spanish locale load — see
 *     `src/i18n/__tests__/localeSplit.test.ts`)
 *
 * Mutation check: reverting any lazy() back to a static import, or deleting
 * the App.tsx Suspense boundary, fails this test.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(HERE, '..');

// Comments are stripped before scanning App.tsx so a doc comment that
// mentions "<Suspense>" in prose (as the one above the fallback component
// does) can't masquerade as a second boundary, and a `{/* JSX comment */}`
// block can't masquerade as a text/whitespace child between two tags.
const stripComments = (src: string): string =>
  src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

const routerSource = readFileSync(join(SRC_DIR, 'router.tsx'), 'utf8');
const appSource = stripComments(readFileSync(join(SRC_DIR, 'App.tsx'), 'utf8'));

// Rendered only after AuthGuard confirms a session — safe (and desirable) to
// split into their own chunk, downloaded only by signed-in sessions.
const AUTHENTICATED_PAGES = [
  'CirclePickerPage',
  'PendingInvitesPage',
  'OverviewPage',
  'CalendarPage',
  'MedicationsPage',
  'TasksPage',
  'NotesPage',
  'ActivityFeedPage',
  'EmergencyInfoPage',
  'DocumentsPage',
  'MembersPage',
  'VitalsPage',
  'EditCirclePage',
  'ProfilePage',
  'HelpPage',
  'UpgradePage',
] as const;

// Reachable by a signed-out visitor on first paint — lazy-loading these would
// add a network hop to the critical path for no bundle-size win that matters
// (they're needed immediately regardless).
const PUBLIC_PAGES = [
  'LoginPage',
  'SignUpPage',
  'VerifyEmailPage',
  'ForgotPasswordPage',
  'ResetPasswordPage',
  'AuthCallbackPage',
  'InviteLandingPage',
  'NotFoundPage',
] as const;

function staticImportPattern(pageName: string): RegExp {
  return new RegExp(`^import\\s+${pageName}\\s+from\\s+'@/pages/${pageName}';?\\s*$`, 'm');
}

function lazyImportPattern(pageName: string): RegExp {
  return new RegExp(
    `${pageName}\\s*=\\s*lazy\\(\\s*\\(\\)\\s*=>\\s*import\\(\\s*['"]@/pages/${pageName}['"]\\s*\\)\\s*\\)`
  );
}

describe('src/router.tsx route splitting', () => {
  it.each(AUTHENTICATED_PAGES)('%s is React.lazy, not a static import', (pageName) => {
    expect(routerSource).not.toMatch(staticImportPattern(pageName));
    expect(routerSource).toMatch(lazyImportPattern(pageName));
  });

  it.each(PUBLIC_PAGES)('%s (public route) keeps its static import', (pageName) => {
    expect(routerSource).toMatch(staticImportPattern(pageName));
    expect(routerSource).not.toMatch(lazyImportPattern(pageName));
  });

  it('imports `lazy` from react', () => {
    expect(routerSource).toMatch(/import\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*'react'/);
  });

  it('every route path from the original table is still wired up', () => {
    // Path strings survive a lazy() refactor untouched — this pins the full
    // authenticated route table so a path can't silently go missing while
    // the component swap happens.
    const paths = [
      "'/login'",
      "'/signup'",
      "'/verify-email'",
      "'/forgot-password'",
      "'/reset-password'",
      "'/auth/callback'",
      "'/invite/:code'",
      "'/circles'",
      "'/invites'",
      "'/profile'",
      "'/upgrade'",
      "'/help'",
      "'/circles/:circleId'",
      "'calendar'",
      "'meds'",
      "'tasks'",
      "'notes'",
      "'activity'",
      "'emergency'",
      "'documents'",
      "'vitals'",
      "'members'",
      "'settings'",
    ];
    for (const path of paths) {
      expect(routerSource).toContain(path);
    }
  });

  it('still guards the authenticated subtree with AuthGuard', () => {
    expect(routerSource).toMatch(/<AuthGuard>/);
  });

  it('still syncs the document title via RouteTitle', () => {
    expect(routerSource).toMatch(/<RouteTitle\s*\/>/);
  });
});

describe('src/App.tsx Suspense boundary', () => {
  it('wraps the router in exactly one <Suspense> boundary', () => {
    const opens = appSource.match(/<Suspense\b/g) ?? [];
    expect(opens).toHaveLength(1);
  });

  it('imports Suspense from react', () => {
    expect(appSource).toMatch(/import\s*\{[^}]*\bSuspense\b[^}]*\}\s*from\s*'react'/);
  });

  /**
   * Reviewer-reported Critical: `<Suspense>` used to sit BELOW
   * `<ToastProvider>`/`<LanguageSync>` — both suspend-capable (ToastProvider
   * calls `useTranslation('common')`) — so a Spanish-detected session with
   * the es chunk in flight had nothing below the (unmounted) boundary to
   * paint: a blank white page, not the fallback. `<Suspense>` must now be the
   * outermost child of `<HelmetProvider>`, with `<QueryClientProvider>` (and
   * everything inside it, `LanguageSync`/`ToastProvider`/`RouterProvider`)
   * nested INSIDE it. Verified by tag position, not just presence — the tags
   * must be properly nested (Suspense opens first and closes last).
   */
  it('nests QueryClientProvider (and LanguageSync/ToastProvider inside it) INSIDE Suspense, not the other way round', () => {
    const suspenseOpen = appSource.indexOf('<Suspense');
    const suspenseClose = appSource.indexOf('</Suspense>');
    const queryProviderOpen = appSource.indexOf('<QueryClientProvider');
    const languageSyncTag = appSource.indexOf('<LanguageSync');
    const toastProviderOpen = appSource.indexOf('<ToastProvider');
    const routerProviderTag = appSource.indexOf('<RouterProvider');

    expect(suspenseOpen).toBeGreaterThan(-1);
    expect(suspenseClose).toBeGreaterThan(suspenseOpen);

    for (const tagIndex of [queryProviderOpen, languageSyncTag, toastProviderOpen, routerProviderTag]) {
      expect(tagIndex).toBeGreaterThan(suspenseOpen);
      expect(tagIndex).toBeLessThan(suspenseClose);
    }
  });

  it('is the sole child of HelmetProvider (no suspend-capable sibling sits outside it)', () => {
    const helmetOpen = appSource.indexOf('<HelmetProvider');
    const suspenseOpen = appSource.indexOf('<Suspense');
    // Nothing but whitespace/JSX-comment-free markup between the two opening
    // tags — i.e. Suspense is HelmetProvider's first (and only) child, not a
    // boundary buried a few levels down with siblings beside it.
    const between = appSource.slice(appSource.indexOf('>', helmetOpen) + 1, suspenseOpen);
    expect(between.trim()).toBe('');
  });

  it('opts RouterProvider into v7_startTransition so a not-yet-loaded lazy page keeps the current page painted', () => {
    // Without this, React Router swaps straight to the nearest Suspense
    // fallback (replacing the whole shell) the instant you navigate to an
    // unloaded lazy route, instead of keeping the outgoing page visible while
    // the next one's chunk streams in.
    expect(appSource).toMatch(
      /<RouterProvider[^>]*\bfuture=\{\{\s*v7_startTransition:\s*true\s*\}\}/
    );
  });
});
