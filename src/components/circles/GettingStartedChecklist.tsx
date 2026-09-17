import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Eyebrow, Icon, Sheet, Text } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useEmergencyInfo } from '@/hooks/useEmergencyInfo';
import { useEventsPresence } from '@/hooks/useCalendarEvents';
import { useAuthStore } from '@/store/authStore';
import { addDays } from '@/components/calendar/dateMath';
import { getDateInTimezone } from '@/utils/timezone';
import { isPendingInviteExpired } from '@/api/circleMembers';
import { Analytics } from '@/lib/analytics';
import type { EmergencyInfo } from '@/api/emergencyInfo';

// Dismissal persists across reloads via localStorage, per circle — same key
// shape mobile uses for AsyncStorage, so the two surfaces read as one product.
// This is a non-sensitive UI preference, not a secret (auth tokens still never
// touch storage). Reads and writes are both guarded: localStorage throws in
// private-mode / quota-exceeded / storage-blocked browsers.
const dismissKey = (circleId: string): string => `getting_started_dismissed_${circleId}`;

function readDismissed(circleId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(circleId)) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(circleId: string): void {
  try {
    window.localStorage.setItem(dismissKey(circleId), 'true');
  } catch {
    // Storage unavailable — fall back to session-only dismissal.
  }
}

export interface GettingStartedChecklistProps {
  circleId: string;
  /**
   * Step 1's pending action. The step asks for a MEDICATION, so the host must
   * open the medication form (`AddEventModal` with `initialType="medication"`),
   * never merely route to the calendar — that page's create modal cannot be
   * opened from navigation, so the user would land on an empty grid.
   */
  onAddEvent?: () => void;
  /**
   * Rendered in place of the checklist once it's complete or dismissed. Lets the
   * calendar's empty slot hold a single card — the checklist while setup is in
   * progress, then the host's own empty-state message afterwards.
   */
  fallback?: ReactNode;
}

/** True when the emergency record carries ANY content the user could have added. */
function hasAnyEmergencyContent(info: EmergencyInfo | null | undefined): boolean {
  if (!info) return false;
  const nonEmptyArray = (arr: unknown[] | null | undefined): boolean => !!arr && arr.length > 0;
  const nonEmptyString = (s: string | null | undefined): boolean => !!s && s.trim().length > 0;
  return (
    nonEmptyString(info.blood_type) ||
    nonEmptyArray(info.medication_allergies) ||
    nonEmptyArray(info.allergies) ||
    nonEmptyArray(info.medical_conditions) ||
    nonEmptyArray(info.emergency_contacts) ||
    nonEmptyArray(info.additional_doctors) ||
    nonEmptyArray(info.insurance_plans) ||
    nonEmptyString(info.primary_doctor_name) ||
    nonEmptyString(info.advance_directives) ||
    info.has_dnr === true ||
    nonEmptyString(info.dnr_document_url)
  );
}

interface Step {
  key: string;
  label: string;
  /** One-line "why this matters" so the step explains itself. */
  desc: string;
  done: boolean;
  /** Localized label for the pending CTA (e.g. "Add", "Invite"). */
  actionLabel: string;
  onAction: () => void;
}

/**
 * "Get started" checklist shown on the circle Overview. Guides the viewer through
 * the setup steps they can actually perform and auto-completes each as the
 * underlying data appears (an event exists, the circle has more than one member
 * or a pending invite, any emergency info is present). It is NOT a coach-mark
 * tour — it's a single dismissible card.
 *
 * Gating is by CAPABILITY, not ownership — matching mobile. Any member who can
 * write (`canEdit`) gets guidance, because a non-owner caregiver can add
 * medications/appointments and emergency info; hiding the card from them would
 * leave an empty circle with no direction at all. Ownership only filters the
 * `invite` step, which non-owners cannot perform. A view-only member can act on
 * NO step, so they get the fallback instead. There is deliberately NO circle-age
 * window: setup help that's still outstanding on day 30 is still worth giving,
 * and dismissal is the single, permanently-honored escape hatch.
 *
 * Self-hides when loading, when every step is done (for good), or when the user
 * dismisses it — dismissal persists per circle in localStorage. Premium
 * treatment mirrors EmptyCircles.tsx (h2 title, moss accents, editorial rows).
 */
export function GettingStartedChecklist({
  circleId,
  onAddEvent,
  fallback,
}: GettingStartedChecklistProps): ReactElement | null {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const currentUserId = useAuthStore((s) => s.user?.id);

  // Holds the circle the user just dismissed, so the card disappears instantly
  // without a storage read; storage is the source of truth for every other
  // circle (and for the next visit). Tracking the id — rather than a bare
  // boolean — keeps dismissal per circle when the user switches circles without
  // this component unmounting.
  const [dismissedCircleId, setDismissedCircleId] = useState<string | null>(null);
  const dismissed = useMemo(
    () => dismissedCircleId === circleId || readDismissed(circleId),
    [dismissedCircleId, circleId]
  );

  const circleQuery = useCircle(circleId);
  const { circle, members, timezone, canEdit } = circleQuery;

  // Presence check over a WIDE window (~30 days back, ~180 days ahead) in the
  // care recipient's timezone, so a single med/appointment anywhere nearby
  // counts — not just one inside the currently visible week. Asked as a
  // PRESENCE read (per-type booleans), never as the 211-day events list: the
  // list was ~1.5k rows / ~1.4 MB on the demo circle to answer one `.some()`.
  //
  // GATED on the timezone: `useCircle` reports `null` until the circle detail
  // has loaded, and the dates stay EMPTY until then — `useEventsPresence` is
  // disabled on empty dates, so no request leaves the browser against a guessed
  // zone. This used to date the window off the hook's unconditional
  // 'America/New_York' fallback, which fired the read once for a New-York
  // window and then AGAIN for the recipient's real window whenever the two
  // zones straddled midnight. Same mechanism (and same cache key) as
  // TodaysMeds, so when both are on screen the second one is a cache hit.
  const today = timezone ? getDateInTimezone(timezone) : '';
  const startDate = today ? addDays(today, -30) : '';
  const endDate = today ? addDays(today, 180) : '';
  const presenceQuery = useEventsPresence(circleId, startDate, endDate);

  const emergencyQuery = useEmergencyInfo(circleId);

  // Still derived (same shape as OverviewPage/MembersPage) — but it now only
  // decides whether the `invite` step is offered, not whether the card renders.
  const isOwner = circle != null && currentUserId != null && circle.owner_id === currentUserId;

  // An EXPIRED invite does NOT count as "you invited someone" — nobody can join
  // through it, and resend/cancel exist precisely because it lapsed. Ticking the
  // step green off a dead invite would permanently stop nudging a solo owner
  // whose one attempt timed out. `isPendingInviteExpired` keeps the staged
  // rollout safe: it prefers the server's `is_expired`, falls back to
  // `expires_at`, and treats an unusable date as live.
  const liveInviteCount = (circle?.pending_invites ?? []).filter(
    (invite) => !isPendingInviteExpired(invite)
  ).length;
  const invited = members.length > 1 || liveInviteCount > 0;
  // MEDICATIONS ONLY — the step asks for one, so only one may tick it.
  //
  // This counted ANY event in the window, so an appointment or a TASK completed
  // the step. Mobile had the sharper version of the same bug: its copy already
  // said "Add medications" while its check counted everything, and a task added
  // through the first-run wizard crossed the step off on a circle with no
  // medication in it. Both surfaces now test the same thing, and the label below
  // narrows to match rather than the check widening to excuse it — the
  // medication nudge is the point of the step.
  const hasEvent = presenceQuery.data?.medication === true;
  const hasEmergency = hasAnyEmergencyContent(emergencyQuery.data);

  // Only steps the viewer can actually perform. `invite` is owner-only (the
  // backend refuses invites from members), so non-owners get a 2-step list —
  // and every count below derives from THIS filtered array, never the full one.
  const steps = useMemo<Step[]>(
    () =>
      [
        {
          key: 'event',
          label: t('gettingStarted.step1Label'),
          desc: t('gettingStarted.step1Desc'),
          done: hasEvent,
          actionLabel: t('gettingStarted.actionAdd'),
          onAction: () => onAddEvent?.(),
        },
        ...(isOwner
          ? [
              {
                key: 'invite',
                label: t('gettingStarted.step2Label'),
                desc: t('gettingStarted.step2Desc'),
                done: invited,
                actionLabel: t('gettingStarted.actionInvite'),
                onAction: () => navigate(`/circles/${circleId}/members`),
              },
            ]
          : []),
        {
          key: 'emergency',
          label: t('gettingStarted.step3Label'),
          desc: t('gettingStarted.step3Desc'),
          done: hasEmergency,
          actionLabel: t('gettingStarted.actionAdd'),
          onAction: () => navigate(`/circles/${circleId}/emergency`),
        },
      ] satisfies Step[],
    [t, isOwner, hasEvent, invited, hasEmergency, onAddEvent, navigate, circleId]
  );

  // A step may read as NOT DONE (with its Add/Invite button) only when the read
  // that decides it has SUCCEEDED and found nothing. Until both presence reads
  // are known, the card renders nothing.
  //
  // This used to wait on `isLoading` alone, which covers neither failure nor a
  // paused read: `isLoading` is `isPending && isFetching`, so an offline
  // (paused) read reports false, and an ERRORED read has no data at all. Either
  // way `hasEvent` came out false and a circle that HAS a medication was shown
  // "0 of 3 done" with "Add a medication" pending — an invitation to create a
  // duplicate series, directly above TodaysMeds' own "Couldn't load
  // medications". Hiding (rather than a per-step "unknown" row) matches this
  // card's existing loading behaviour, needs no new copy, and leaves the one
  // error + Retry to TodaysMeds, which reads the SAME query key — its Retry
  // brings this card back.
  const signalsKnown =
    !circleQuery.isLoading && presenceQuery.isSuccess && emergencyQuery.isSuccess;

  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === total;

  // While the checklist's own signals settle (or if one failed), render
  // nothing so the empty slot never flashes the fallback or a false step.
  if (!signalsKnown) return null;
  // View-only (or otherwise write-blocked): there is no step this member could
  // act on, so guidance would only nag. Ownership is NOT the gate — a non-owner
  // caregiver who can write still gets the card. Circle age is deliberately not
  // a gate either — see the docstring.
  if (!canEdit) return <>{fallback ?? null}</>;
  // Complete or dismissed: hand the slot back to the host's empty state.
  if (dismissed || allDone) return <>{fallback ?? null}</>;

  return (
    <Sheet
      role="region"
      aria-label={t('gettingStarted.title')}
      padding="lg"
      // mobile gsCard: white, 1px hairStrong, r24, padding 24 (Sheet adds a whisper of shadow)
      className="relative rounded-2xl"
    >
      {/* Dismiss */}
      <button
        type="button"
        onClick={() => {
          // Recorded WITH the progress at the moment of dismissal: "0 of 3"
          // versus "2 of 3" is the difference between a card people bounce off
          // and one they close because it has done its job.
          Analytics.gettingStartedDismissed(doneCount, total);
          writeDismissed(circleId);
          setDismissedCircleId(circleId);
        }}
        aria-label={t('gettingStarted.dismiss')}
        className="absolute top-4 right-4 inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:bg-bg-2 hover:text-ink"
      >
        <Icon name="close-outline" size="row" />
      </button>

      {/* Header */}
      <div className="pr-12">
        <Eyebrow>{t('gettingStarted.progress', { done: doneCount, total })}</Eyebrow>
        <Text variant="h2" className="mt-1.5">
          {t('gettingStarted.title')}
        </Text>
        <Text variant="caption" className="mt-1.5 max-w-md">
          {t('gettingStarted.subtitle')}
        </Text>
      </div>

      {/* Steps */}
      <ol className="m-0 mt-4 flex list-none flex-col p-0">
        {steps.map((step) => (
          <li key={step.key} className="border-t border-line-2 first:border-t-0">
            <div className="flex items-center gap-3 py-3">
              {/* Status marker — mobile `gsMarker`: 20px, moss-soft with a
                  checkmark when done, a 2px hairline ring when pending. */}
              {step.done ? (
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-moss-soft text-moss-deep"
                >
                  <Icon name="checkmark" size="meta" />
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="h-5 w-5 flex-none rounded-full border-2 border-line"
                />
              )}

              {/* Label + "why" + a11y status text */}
              <div className="min-w-0 flex-1">
                <p
                  className={`m-0 text-md font-medium leading-snug ${
                    step.done ? 'text-ink-3 line-through' : 'text-ink'
                  }`}
                >
                  {step.label}
                  <span className="sr-only">
                    {' '}
                    {step.done ? t('gettingStarted.statusDone') : t('gettingStarted.statusPending')}
                  </span>
                </p>
                <p className="m-0 mt-0.5 text-sm leading-snug text-ink-2">{step.desc}</p>
              </div>

              {/* Pending action */}
              {!step.done && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    // Fired BEFORE the action: step 1 opens a modal and the
                    // others navigate away, so this is the last moment the
                    // press is observable from here.
                    Analytics.gettingStartedStepTapped(step.key);
                    step.onAction();
                  }}
                  className="flex-none"
                >
                  {step.actionLabel}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
