import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { useEarnedUpsell } from '@/hooks/useEarnedUpsell';
import { useNextUp } from '@/hooks/useNextUp';
import { useNextStep } from '@/hooks/useNextStep';
import { measureLargeText, shouldReportLargeText, useLargeTextLayout } from '@/hooks/useLargeTextLayout';
import { Skeleton } from '@/components/ui';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { FirstRunWizardModal } from '@/components/circles/firstRun/FirstRunWizardModal';
import { Hero } from '@/components/overview/Hero';
import { QuickAccess } from '@/components/overview/QuickAccess';
import { DailyUpdateCard } from '@/components/overview/DailyUpdateCard';
import { NextUp, NEXT_UP_VISIBLE } from '@/components/overview/NextUp';
import { NextStepCard } from '@/components/overview/NextStepCard';
import { FirstMedMarkIt } from '@/components/overview/FirstMedMarkIt';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import {
  clearOnboardingPaywallPending,
  consumeOnboardingPaywall,
  peekOnboardingPaywallPending,
} from '@/lib/onboardingPaywall';
import { handOffFocusSoon } from '@/lib/focusHandoff';
import { DoseHint } from '@/components/overview/DoseHint';
import { ShiftsNudgeCard, pickShiftsNudgeMember } from '@/components/overview/ShiftsNudgeCard';
import { resolveShiftsEntry } from '@/lib/shiftsAccess';
import { ShiftsTeaserDialog } from '@/components/shifts/ShiftsTeaserDialog';
import {
  dismissShiftsNudge,
  hasDismissedShiftsNudge,
  hasSeenDoseHint,
  markDoseHintSeen,
} from '@/lib/todayCoaching';
import { Analytics } from '@/lib/analytics';
import { isDoseConfirmable } from '@/utils/timezone';

interface FirstRunLocationState {
  firstRun?: boolean;
  firstRunRecipientName?: string;
}

type Coaching = 'next_step' | 'shifts' | 'dose_hint' | 'none';

/**
 * Today (`/circles/:id`), the landing page when you open a circle
 * (docs/plans/simple-ui-1-3-1.md; hi-fi HiToday / HiTodayNew / HiHint /
 * CoachShifts). It was "Overview"; it is now only what is needed today:
 *
 *   header ("Today for {{name}}", date eyebrow)
 *   [daily update, in the evening]
 *   ONE coaching element at most: next-step card > shifts nudge > first-dose hint
 *   Next up (meds, appointments, tasks in time order; first 3 + "All of today")
 *   Quick access (2x2 + quiet links)
 *
 * Wide screens put Next up and Quick access side by side (same order, more
 * room); at 200% zoom / large root font everything is one column and rows stack.
 *
 * No Say it / voice on web: voice quick-add is mobile-only.
 *
 * The adherence card is gone (it moves to the Meds page), and so are the care
 * team and manage rows (Members and Circle settings live in the header menu),
 * the appointments / open-tasks / today's-meds cards (Next up replaces them),
 * the getting-started checklist and the "watch how it works" card (the
 * next-step card replaces them).
 */
export default function OverviewPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUserId = useAuthStore((s) => s.user?.id);

  /**
   * FIRST RUN: the wizard, shown once, immediately after this circle was
   * created. Read into state ONCE and the history entry rewritten to drop the
   * flag, so a reload or Back never reopens it.
   */
  const firstRunState = location.state as FirstRunLocationState | null;
  const [firstRun, setFirstRun] = useState<{ recipientName: string } | null>(() =>
    firstRunState?.firstRun ? { recipientName: firstRunState.firstRunRecipientName ?? '' } : null
  );
  useEffect(() => {
    if (!firstRunState?.firstRun) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [firstRunState?.firstRun, location.pathname, navigate]);

  // The next-step card's "Add medication" opens THE ADD-MEDICATION FORM as a
  // modal over Today (never a route to an empty calendar).
  const [showAddMed, setShowAddMed] = useState(false);

  const {
    circle,
    members,
    isLoading,
    timezone,
    canEdit,
    viewOnly,
    isPremiumCircle,
    hasShifts,
    isOwner,
  } = useCircle(circleId);
  const isRecipient = members.some((m) => m.is_care_recipient && m.id === currentUserId);
  const recipientName = circle?.recipient_name ?? '';
  const isSelfCare = circle?.is_self_care === true;
  const base = `/circles/${circleId}`;

  // The earned upsell: asked HERE (arriving on the circle is a natural pause),
  // only for the owner, never over the wizard or the add-medication modal.
  useEarnedUpsell(isOwner && firstRun === null && !showAddMed);

  const largeText = useLargeTextLayout();
  useEffect(() => {
    // Once per screen per session. Measured at mount, not from the first render's guess.
    if (shouldReportLargeText('today')) Analytics.largeTextLayout('today', measureLargeText());
  }, []);

  // ONBOARDING PAYWALL, no-first-med path (onboarding 1.3.1, spec section 7). Circle
  // creation only recorded that the paywall is OWED; the first-med path pays it after the
  // payoff. Anyone who got here without a first med (Skip, close, another first-run action,
  // the first-run form closed unsaved, a reload) is asked ONCE, the next time Today is on
  // screen with nothing else over it. An unknown tier waits; a paying user is released.
  // `consumeOnboardingPaywall` writes the seen flag BEFORE the route change, so racing entry
  // points cannot show it twice.
  const { data: subscription } = useSubscriptionStatus();
  useEffect(() => {
    if (firstRun !== null || showAddMed || !circleId) return;
    if (peekOnboardingPaywallPending() !== circleId) return;
    if (!subscription) return;
    if (subscription.tier !== 'free') {
      clearOnboardingPaywallPending();
      return;
    }
    if (consumeOnboardingPaywall({ circleId, recipientName })) {
      navigate('/upgrade', {
        state: { paywallContext: 'onboarding', paywallTrigger: 'onboarding' },
      });
    }
  }, [firstRun, showAddMed, circleId, subscription, recipientName, navigate]);

  const nextUp = useNextUp(circleId, timezone);
  const nextStep = useNextStep(circleId, timezone);

  // Shifts nudge (mobile's rule): PREMIUM circles (a setup prompt) and the OWNER of a FREE circle
  // (they just hit the caregiver cap: "Set up shifts" opens the existing shifts teaser -> paywall,
  // like the New menu's Shift option). A free circle's members are never sold a paywall; a lapsed
  // (read-only) circle gets nothing to set up. The viewer can edit, and the circle got a 2nd
  // caregiver in the last 14 days and has no shifts yet. Once per user per circle.
  const shiftsEntry = resolveShiftsEntry({ viewOnly, isPremiumCircle, isOwner, hasShifts });
  const shiftsMember =
    circle && (shiftsEntry === 'available' || shiftsEntry === 'teaser') && canEdit && !hasShifts
      ? pickShiftsNudgeMember(members, currentUserId)
      : null;
  const shiftsUpsell = shiftsEntry === 'teaser';
  const [shiftsTeaserOpen, setShiftsTeaserOpen] = useState(false);
  const [shiftsDismissedFor, setShiftsDismissedFor] = useState<string | null>(null);
  const showShiftsNudge =
    shiftsMember !== null && shiftsDismissedFor !== circleId && !hasDismissedShiftsNudge(circleId);

  // First-dose hint: under the first dose row that can be answered, once per user.
  const [doseHintGone, setDoseHintGone] = useState(false);
  const firstDose =
    timezone && canEdit
      ? nextUp.items
          .slice(0, NEXT_UP_VISIBLE)
          .find(
            (i) =>
              i.med && isDoseConfirmable(i.med.scheduled_date, i.med.scheduled_time ?? null, timezone)
          ) ?? null
      : null;
  const doseHintAvailable = firstDose !== null && !doseHintGone && !hasSeenDoseHint();

  // ONE coaching element at a time. Priority: next-step > shifts > dose hint.
  const coaching: Coaching =
    nextStep.status === 'step'
      ? 'next_step'
      : showShiftsNudge
        ? 'shifts'
        : doseHintAvailable
          ? 'dose_hint'
          : 'none';

  // today_viewed: once per circle visit, when everything that decides it has answered.
  const viewedFor = useRef<string | null>(null);
  const ready = nextUp.settled && nextStep.status !== 'unknown' && !!circle;
  useEffect(() => {
    if (!ready || viewedFor.current === circleId) return;
    viewedFor.current = circleId;
    Analytics.todayViewed({
      has_items: nextUp.items.length > 0,
      next_up_count: nextUp.items.length,
      coaching,
    });
  }, [ready, circleId, nextUp.items.length, coaching]);

  const gotItDoseHint = (): void => {
    markDoseHintSeen();
    setDoseHintGone(true);
    // "Got it" unmounts with the hint: never leave focus on <body>.
    handOffFocusSoon();
  };

  return (
    <section className="mx-auto w-full max-w-5xl" data-large-text={largeText ? 'true' : undefined}>
      {isLoading && !circle ? (
        <div className="px-5 pt-5 pb-4" aria-hidden="true">
          <Skeleton className="mb-2 h-4 w-40" />
          <Skeleton className="h-8 w-56" />
        </div>
      ) : (
        <Hero
          recipientName={recipientName}
          isSelfCare={isSelfCare}
          recipientTimezone={timezone}
        />
      )}

      {/* Daily update: renders nothing outside 19:00-24:00 recipient time or
          without activity; `empty:hidden` then drops the wrapper's spacing.
          Gated on the recipient's zone (its date IS the query key). `max-sm:pt-6` keeps the card's
          "Hide until tomorrow" X below the phone page toast (Toast.tsx, bottom edge at 186px);
          e2e/unhappy/writes/toast-page-gate-overlap.spec.ts, Overview (evening). */}
      <div className="px-5 pb-6 max-sm:pt-6 empty:hidden">
        {timezone !== null && (
          <DailyUpdateCard
            circleId={circleId}
            timezone={timezone}
            isOwner={isOwner}
            isRecipient={isRecipient}
          />
        )}
      </div>

      {coaching === 'next_step' && nextStep.status === 'step' && (
        <div className="px-5 pb-6">
          <NextStepCard
            step={nextStep.step}
            position={nextStep.position}
            total={nextStep.total}
            recipientName={recipientName}
            isSelfCare={isSelfCare}
            onNotNow={() => {
              nextStep.snooze();
              handOffFocusSoon();
            }}
            onAction={() => {
              if (nextStep.step === 'first_med') setShowAddMed(true);
              else if (nextStep.step === 'invite') navigate(`${base}/members`);
              else navigate('/profile');
            }}
          />
        </div>
      )}

      {coaching === 'shifts' && shiftsMember && (
        <div className="px-5 pb-6">
          <ShiftsNudgeCard
            member={shiftsMember}
            recipientName={recipientName}
            isSelfCare={isSelfCare}
            upsell={shiftsUpsell}
            onNotNow={() => {
              dismissShiftsNudge(circleId);
              setShiftsDismissedFor(circleId);
              handOffFocusSoon();
            }}
            onSetUp={() => {
              dismissShiftsNudge(circleId);
              setShiftsDismissedFor(circleId);
              if (shiftsUpsell) setShiftsTeaserOpen(true);
              else navigate(`${base}/calendar?mode=shifts`);
            }}
          />
        </div>
      )}

      <div
        className={`grid grid-cols-1 gap-6 px-5 pb-8 ${largeText ? '' : 'xl:grid-cols-2'}`}
        data-testid="today-grid"
      >
        <div className="min-w-0">
          {timezone !== null && (
            <FirstMedMarkIt
              circleId={circleId}
              timezone={timezone}
              today={nextUp.today}
              canEdit={canEdit && !viewOnly}
              stacked={largeText}
            />
          )}
          {timezone !== null && (
            <NextUp
              circleId={circleId}
              timezone={timezone}
              recipientName={recipientName}
              isSelfCare={isSelfCare}
              canEdit={canEdit}
              items={nextUp.items}
              loading={!nextUp.settled}
              error={nextUp.isError}
              onRetry={nextUp.refetch}
              stacked={largeText}
              hint={
                coaching === 'dose_hint' ? (
                  <DoseHint
                    recipientName={recipientName}
                    isSelfCare={isSelfCare}
                    onGotIt={gotItDoseHint}
                  />
                ) : undefined
              }
              hintAfterKey={coaching === 'dose_hint' ? (firstDose?.key ?? null) : null}
              onTakenPressed={() => {
                if (coaching === 'dose_hint') {
                  Analytics.coachingHintActed('first_dose');
                  gotItDoseHint();
                }
              }}
            />
          )}
        </div>
        <div className="min-w-0">
          <QuickAccess
            circleId={circleId}
            timezone={timezone}
            showShiftsLink={shiftsEntry !== 'hidden'}
            stacked={largeText}
          />
        </div>
      </div>

      {firstRun && (
        <FirstRunWizardModal
          circleId={circleId}
          circleName={circle?.recipient_name || firstRun.recipientName}
          onClose={() => {
            setFirstRun(null);
            // The wizard took focus from nothing (it mounts over a fresh Today), so its own
            // restore has nowhere to go: land on Today's heading, not <body>.
            handOffFocusSoon();
          }}
        />
      )}

      {shiftsTeaserOpen && (
        <ShiftsTeaserDialog source="shifts_nudge" onClose={() => setShiftsTeaserOpen(false)} />
      )}

      {showAddMed && (
        <AddEventModal
          circleId={circleId}
          initialType="medication"
          entry="next_step"
          onClose={() => setShowAddMed(false)}
        />
      )}
    </section>
  );
}
