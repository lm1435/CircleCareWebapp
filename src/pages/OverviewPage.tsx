import { useEffect, useState, type ReactElement } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { Skeleton } from '@/components/ui';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { TodaysMeds } from '@/components/meds/TodaysMeds';
import { OpenTasksCard } from '@/components/tasks/OpenTasksCard';
import { GettingStartedChecklist } from '@/components/circles/GettingStartedChecklist';
import { FirstRunWizardModal } from '@/components/circles/firstRun/FirstRunWizardModal';
import { Hero } from '@/components/overview/Hero';
import { AdherenceCard } from '@/components/overview/AdherenceCard';
import { QuickAccess } from '@/components/overview/QuickAccess';
import { CareTeam } from '@/components/overview/CareTeam';
import { SettingsRows } from '@/components/overview/SettingsRows';
import { UpcomingAppointments } from '@/components/overview/UpcomingAppointments';

interface FirstRunLocationState {
  firstRun?: boolean;
  firstRunRecipientName?: string;
}

/**
 * Circle Home (`/circles/:id`) — the landing page when you open a circle,
 * mirroring mobile's `CircleDetailScreen` (spec §6.3).
 *
 * ORDER IS MOBILE'S ORDER, adapted to two columns above 1024px with the hero
 * spanning both (spec §6.3's opening paragraph):
 *
 *   hero  ·  getting-started checklist (both columns)
 *   left:  adherence · quick access · care team (+ solo invite) · manage
 *   right: today's medications · upcoming appointments · open tasks
 *
 * Below 1024px the grid collapses to one column, and the left column's blocks
 * read first — which is where mobile puts adherence and quick access relative
 * to appointments and tasks. Mobile threads today's medications between the
 * hero and adherence; on web that block heads the right-hand column, the one
 * divergence the two-column adaptation forces.
 *
 * The "recent activity" card web used to carry here is GONE: mobile's home has
 * no activity list — the feed is one Quick Access row, and duplicating it as a
 * card rendered the same rows twice on one page.
 */
export default function OverviewPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUserId = useAuthStore((s) => s.user?.id);

  /**
   * FIRST RUN — the four-step wizard, shown once, immediately after this
   * circle was created (`CreateCircleModal` sets the flag on the navigation).
   *
   * Read into state ONCE rather than off `location.state` on every render, and
   * the history entry is rewritten to drop the flag as soon as it is read. Two
   * reasons: a browser reload or a Back to this entry must not reopen a wizard
   * for a circle the user has since set up, and dismissal must not depend on a
   * second navigation landing correctly. `useState`'s initializer runs once, so
   * the wizard survives the rewrite that immediately follows it.
   */
  const firstRunState = location.state as FirstRunLocationState | null;
  const [firstRun, setFirstRun] = useState<{ recipientName: string } | null>(() =>
    firstRunState?.firstRun ? { recipientName: firstRunState.firstRunRecipientName ?? '' } : null
  );
  useEffect(() => {
    if (!firstRunState?.firstRun) return;
    // `replace` swaps the CURRENT history entry, so the flag is gone from the
    // moment the wizard opens. `location.state` survives a reload (it lives in
    // `history.state`), so without this a refresh — or a Back onto this entry
    // later — would reopen the wizard for a circle the user has since set up.
    navigate(location.pathname, { replace: true, state: null });
  }, [firstRunState?.firstRun, location.pathname, navigate]);

  // The checklist's "Add a medication" step opens THE ADD-MEDICATION FORM as a
  // modal over Home, not a route to the calendar. Navigating to `/calendar`
  // dropped the user on an empty month grid with nothing open — the calendar
  // page's create modal is local state (`showCreate`) and reads nothing off the
  // navigation, so there is no way to arrive there with it open. Mobile fixed
  // the identical bug the same way (CircleDetailScreen's
  // `handleGettingStartedAction`: `initialType: 'medication'`, back returns to
  // the checklist). Opening it HERE also keeps the checklist on screen to tick
  // the step off the moment the medication lands.
  const [showAddMed, setShowAddMed] = useState(false);

  const { circle, members, isLoading, timezone } = useCircle(circleId);
  const isOwner = circle != null && currentUserId != null && circle.owner_id === currentUserId;

  return (
    <section className="mx-auto w-full max-w-5xl">
      {isLoading && !circle ? (
        <div className="flex flex-col items-center px-7 pt-6 pb-[18px]" aria-hidden="true">
          <Skeleton className="mb-3 h-24 w-24 rounded-full" />
          <Skeleton className="h-10 w-56" />
        </div>
      ) : (
        <Hero
          recipientName={circle?.recipient_name ?? ''}
          recipientPhotoUrl={circle?.recipient_photo_url}
          recipientDob={circle?.recipient_dob}
          members={members}
        />
      )}

      {/* Get-started checklist — spans both columns, above the grid.
          Self-hides once complete, dismissed, or when the viewer can't edit
          (view-only member); gating is by write CAPABILITY, not ownership, and
          there is deliberately no circle-age window (see the component's
          docstring). `empty:hidden` drops this wrapper in those cases, so a
          hidden checklist leaves no stray gap above the grid. */}
      <div className="px-5 empty:hidden">
        <GettingStartedChecklist circleId={circleId} onAddEvent={() => setShowAddMed(true)} />
      </div>

      <div className="grid grid-cols-1 gap-6 px-5 pb-6 xl:grid-cols-2">
        <div className="flex min-w-0 flex-col">
          <AdherenceCard circleId={circleId} />
          <QuickAccess circleId={circleId} />
          <CareTeam
            circleId={circleId}
            circle={circle}
            members={members}
            currentUserId={currentUserId}
            isOwner={isOwner}
          />
          <SettingsRows circleId={circleId} isOwner={isOwner} />
        </div>

        <div className="flex min-w-0 flex-col">
          {/* Today's medications — self-contained section (own heading, its own
              queries and the confirm flow). Task 20 owns its internals. */}
          <TodaysMeds circleId={circleId} limit={5} />
          {/* GATED, not defaulted. This card derives `today`, `tomorrow` and a
              14-day window IN THE RECIPIENT'S ZONE and those dates ARE its
              events query key, so a 'America/New_York' placeholder fetched one
              15-day window and then a second, different one when the real zone
              landed (visible as the duplicate `events` reads in
              e2e/unhappy/writes/home-events-requests.spec.ts). `getDateInTimezone`
              silently falls back to DEVICE-local on a bad zone, so passing
              `null` through would not have failed loudly either — the gate is
              the only thing that makes this correct. */}
          {timezone !== null && <UpcomingAppointments circleId={circleId} timezone={timezone} />}
          {/* Open tasks — self-contained too: same TaskRow, same undo window as
              the Tasks page, so a task is completable straight from Home,
              exactly as on mobile. Rendered directly on paper (no Card
              wrapper): mobile lists these as bare cards on the page ground. */}
          <OpenTasksCard circleId={circleId} limit={3} />
        </div>
      </div>

      {/* First run — the four-step wizard, over the circle it just created.
          `recipient_name` from the circle detail wins once it lands; the name
          carried on the navigation covers the seconds before it does. */}
      {firstRun && (
        <FirstRunWizardModal
          circleId={circleId}
          circleName={circle?.recipient_name || firstRun.recipientName}
          onClose={() => setFirstRun(null)}
        />
      )}

      {/* Checklist step 1 — the medication form, pre-typed exactly as the
          Medications page opens it (see the `showAddMed` rationale above). */}
      {showAddMed && (
        <AddEventModal
          circleId={circleId}
          initialType="medication"
          onClose={() => setShowAddMed(false)}
        />
      )}
    </section>
  );
}
