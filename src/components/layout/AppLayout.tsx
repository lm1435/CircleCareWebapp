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
import { usePremiumGate } from '@/hooks/usePremiumGate';
import { useAuthStore } from '@/store/authStore';
import { resolveAiEntry } from '@/lib/aiAccess';
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
  const { circle, canEdit, viewOnly, isPremiumCircle } = useCircle(circleId ?? '');

  // ── AI Care Assistant gate ────────────────────────────────────────────────
  // The backend already refuses these callers (backend/src/routes/ai.ts); this
  // decides whether we OFFER the entry at all, from data the circle detail
  // response already carries — no extra request. See src/lib/aiAccess.ts for
  // the rule, for why `view_only` is read before the premium flag, and for why
  // the input is `is_premium_circle` and NOT `can_edit` (they disagree for a
  // free-tier ACTIVE circle, where `can_edit` sold a paywall no non-owner's
  // purchase could lift). Mobile's `useAIEntryAccess` reads the same input.
  //
  // `owner_id` is on the GET /circles/:id payload for every member, so "am I
  // the owner?" is the same compare MembersPage / OverviewPage / EditCirclePage
  // already make. The route spreads an EXPLICIT COLUMN PROJECTION, not the
  // `care_circles` row (`backend/src/routes/circles.ts` selects
  // `id, name, recipient_name, recipient_photo_url, recipient_dob,
  // recipient_conditions, owner_id, created_at, is_self_care` — deliberately,
  // to keep internal columns off the wire). `owner_id` is in that list today;
  // it is not there by virtue of being a column, so removing it from the
  // projection would silently make every viewer a non-owner here.
  const currentUserId = useAuthStore((s) => s.user?.id);
  const isOwner = circle != null && currentUserId != null && circle.owner_id === currentUserId;
  const aiEntry = resolveAiEntry({ viewOnly, isPremiumCircle, isOwner });
  // 'feature' (not the default): a premium-only SURFACE, which is how mobile
  // splits its paywall funnel. See usePremiumGate's `context` docs.
  const { promptUpgrade } = usePremiumGate('feature');

  // AN OPEN ASSISTANT BELONGS TO THE CIRCLE IT WAS OPENED FOR.
  //
  // The mount below is gated on `aiEntry === 'available'`, which unmounts the
  // modal the moment the flags say the viewer may not have it — but `aiOpen` is
  // layout state that outlives that, so the gate only ever HID it. The instant
  // `aiEntry` came back to 'available' the modal was re-rendered with
  // `isOpen={true}` and popped open again, unbidden.
  //
  // A CIRCLE SWITCH does exactly that, every time. `useCircle`'s flags are
  // `?? false`, so a new query key — nothing cached yet — drives `aiEntry` away
  // from 'available' and then back as the new circle's detail lands. This
  // component is not keyed on `circleId` (only `<main>`'s inner div is keyed on
  // the pathname, and `AIChatModal` sits outside it), so nothing else resets
  // it: the caregiver arrives in the next circle with an assistant they never
  // opened, scoped to a DIFFERENT care recipient.
  //
  // Both effects, not one. The `circleId` reset is the semantic rule (the
  // conversation was about one person and does not travel); the `aiEntry` reset
  // is the safety rule (a seat downgraded or a circle frozen mid-session must
  // not leave a re-openable modal behind). Neither implies the other: the
  // switch could in principle render without an intermediate non-available
  // frame, and a downgrade never changes `circleId`.
  useEffect(() => {
    setAiOpen(false);
  }, [circleId]);
  useEffect(() => {
    if (aiEntry !== 'available') setAiOpen(false);
  }, [aiEntry]);

  // One handler behind both entry points. A frozen circle's OWNER is the one
  // person whose upgrade would actually unlock this, so they get the prompt
  // rather than a chat window that can only fail; everyone else never sees an
  // entry to press (aiEntry === 'hidden').
  const openAssistant = (): void => {
    if (aiEntry === 'upgrade') {
      promptUpgrade();
      return;
    }
    setAiOpen(true);
  };

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
          // Sidebar renders its AI group only when this prop is present, so
          // `undefined` IS the hidden state on that surface.
          onOpenAssistant={aiEntry === 'hidden' ? undefined : openAssistant}
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
            onOpenAssistant={openAssistant}
            canUseAssistant={aiEntry !== 'hidden'}
          />
          {/* Mounted here, not inside the pill: the sidebar's New button opens
              the same menu from its own anchor, and only one create flow may be
              in flight at a time. It portals itself to <body> and wraps the
              pill in its own named landmark (axe `region`), so where it is
              mounted here does not matter for layout or a11y. */}
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

      {/* The MOUNT is gated, not just the entry points. `aiOpen` is layout
          state that outlives a flag refresh: a member whose seat is downgraded
          to view-only while the modal is open (or whose circle freezes) would
          otherwise keep an open assistant, and re-render it from the stale
          `true`. Gating here makes the modal disappear the moment the flags
          say it may not be there. */}
      {circleId && aiEntry === 'available' && (
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
