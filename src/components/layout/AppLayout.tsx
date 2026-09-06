import { useEffect, useState, type ReactElement } from 'react';
import { Outlet, useLocation, useNavigate, useNavigationType, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { AddMenu, type AddMenuType } from './AddMenu';
import { FloatingNavBar } from './FloatingNavBar';
import { NeedsCircleSelectionBanner } from '@/components/NeedsCircleSelectionBanner';
import { AIChatModal } from '@/components/ai/AIChatModal';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { useCircle } from '@/hooks/useCircle';
import { useCircles } from '@/hooks/useCircles';
import { trackCirclesLoaded } from '@/lib/onboardingAnalytics';

/**
 * Authenticated layout shell (spec §5).
 *
 * Header on top; from 1024px up a 272px `Sidebar` column carries navigation,
 * and below it the `FloatingNavBar` pill does — there is no drawer, no focus
 * trap and no install banner any more (spec §5.3, §5.5).
 *
 * The create surface is the four-option `AddMenu`, opened either from the
 * sidebar's New button or from the pill's NEW cell. Document upload and Invite
 * member are deliberately NOT here: they live on the Documents and Members
 * pages, which each own the context that action needs (spec §5.2).
 *
 * No UI state is persisted to storage.
 */
export function AppLayout(): ReactElement {
  const { t } = useTranslation('common');
  const { circleId } = useParams<{ circleId: string }>();
  const [aiOpen, setAiOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [createKind, setCreateKind] = useState<AddMenuType | null>(null);
  const location = useLocation();
  const navigationType = useNavigationType();

  // A new page starts at its top. The window keeps its scroll offset across
  // client-side route changes, so with a sticky rail a click on "Activity"
  // from the foot of the overview used to land mid-feed. PUSH/REPLACE only:
  // Back and Forward (POP) keep the browser's own restoration, and a hash
  // navigation is a jump to a section, which the page itself handles.
  useEffect(() => {
    if (navigationType === 'POP' || location.hash) return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [location.pathname, location.hash, navigationType]);
  const navigate = useNavigate();

  // Write actions need an editable circle. Resolved once here so the sidebar's
  // New button and the pill's NEW cell share one source of truth.
  const { canEdit } = useCircle(circleId ?? '');

  const openCreate = (kind: AddMenuType): void => {
    // Notes have no create modal — the composer lives at the top of the Notes
    // page (mirrors mobile's New-menu note entry).
    if (kind === 'note') {
      if (circleId) navigate(`/circles/${circleId}/notes`);
      return;
    }
    setCreateKind(kind);
  };

  // R4-5 onboarding funnel: users can deep-link straight into a circle without
  // ever visiting /circles, so observe the circle list here too. Header's
  // CircleSwitcher already runs this query (same React Query key) — this adds
  // no extra fetch. Guards in the module make it once-per-browser.
  const { data: allCircles } = useCircles();
  useEffect(() => {
    if (allCircles) trackCirclesLoaded(allCircles.length);
  }, [allCircles]);

  // `overflow-x-clip`, not `-hidden`: hidden makes this wrapper a scroll
  // container, and `position: sticky` only sticks against the nearest scroll
  // container — so the sticky header and sidebar rail would scroll away with
  // the page. clip trims sideways overflow without becoming one.
  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr] overflow-x-clip bg-bg">
      <a
        href="#main"
        // `href="#main"` alone moves the URL hash but not necessarily DOM
        // focus — not every browser focuses a fragment's target element, and
        // even where it does, an element needs to BE focusable first (see the
        // `tabIndex={-1}` below). Without this, activating the link left
        // focus on <body> and the very next Tab re-entered the nav instead of
        // reaching page content.
        onClick={() => document.getElementById('main')?.focus()}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-cream focus:px-5 focus:py-3 focus:text-sm focus:text-ink focus:shadow-lg"
      >
        {t('skipToContent')}
      </a>

      <Header />

      {/* grid-cols-1 (minmax(0,1fr)) is required on mobile: without an explicit
          column the implicit `auto` track grows to the content's max-content
          width, so a wide child like the calendar makes <main> balloon past the
          viewport and the whole page scrolls sideways. The 0-min column clamps
          <main> to the viewport so wide content scrolls inside its own card.
          17rem = 272px, the Sidebar's own width — 16rem left a 16px overrun. */}
      <div className="grid grid-cols-1 xl:grid-cols-[17rem_1fr]">
        <Sidebar
          variant="desktop"
          onOpenAssistant={() => setAiOpen(true)}
          onCreate={circleId ? openCreate : undefined}
          canCreate={canEdit}
        />
        {/* Below xl the pill floats over the page, so the scroll content has to
            reserve its height + 24 (spec §4.5). `--nav-h` is published by
            FloatingNavBar itself; the 0 fallback covers the moment before it
            mounts and every route that has no pill. */}
        {/* `tabIndex={-1}`: not in the Tab order, but programmatically
            focusable — the skip link's target. The inner div below (keyed by
            path) remounts on every navigation; `<main>` itself never does, so
            a route change can't steal focus back off of it once landed. */}
        <main
          id="main"
          tabIndex={-1}
          className="min-w-0 pb-[calc(var(--nav-h,0px)+var(--nav-inset,0px)+24px)] xl:pb-0"
        >
          <NeedsCircleSelectionBanner />
          {/* Page-level boundary: a single page's render error shows the fallback
              inside <main> while the header + sidebar stay usable. Keyed by path
              so navigating to another route auto-clears a caught error. */}
          <ErrorBoundary boundary="circle-page" key={location.pathname}>
            <div
              key={location.pathname}
              className="animate-[fade-in_200ms_ease-out] motion-reduce:animate-none"
            >
              <Outlet />
            </div>
          </ErrorBoundary>
        </main>
      </div>

      {circleId && (
        <>
          <FloatingNavBar
            circleId={circleId}
            canCreate={canEdit}
            addOpen={addOpen}
            onToggleAdd={() => setAddOpen((open) => !open)}
            assistantOpen={aiOpen}
            onOpenAssistant={() => setAiOpen(true)}
          />
          {/* Mounted here, not inside the pill: the sidebar's New button opens
              the same menu from its own anchor, and only one create flow may be
              in flight at a time. Deliberately outside any landmark (axe
              `region`) — it's a transient overlay, not page content. */}
          <AddMenu
            anchor="bottom"
            open={addOpen}
            canCreate={canEdit}
            onClose={() => setAddOpen(false)}
            onSelect={(kind) => {
              setAddOpen(false);
              openCreate(kind);
            }}
          />
        </>
      )}

      {circleId && (
        <AIChatModal circleId={circleId} isOpen={aiOpen} onClose={() => setAiOpen(false)} />
      )}

      {circleId && createKind && createKind !== 'note' && (
        <AddEventModal
          circleId={circleId}
          initialType={createKind}
          onClose={() => setCreateKind(null)}
          onSaved={() => setCreateKind(null)}
        />
      )}
    </div>
  );
}
