import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useEmergencyInfo } from '@/hooks/useEmergencyInfo';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { addDays } from '@/components/calendar/dateMath';
import { getDateInTimezone } from '@/utils/timezone';
import type { EmergencyInfo } from '@/api/emergencyInfo';

export interface GettingStartedChecklistProps {
  circleId: string;
  /** Opens the calendar's Add-event modal (step 1's pending action). */
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

function CheckIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function DismissIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
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
 * First-run "Get started" checklist shown on the calendar landing for a brand-new
 * circle. Guides the owner through three setup steps and auto-completes each as
 * the underlying data appears (an event exists, the circle has more than one
 * member or a pending invite, any emergency info is present). It is NOT a
 * coach-mark tour — it's a single dismissible card.
 *
 * Self-hides when loading, when every step is done (for good), or when the user
 * dismisses it (session-only, no storage). Premium treatment mirrors
 * EmptyCircles.tsx (serif title, moss accents, editorial rows).
 */
export function GettingStartedChecklist({
  circleId,
  onAddEvent,
  fallback,
}: GettingStartedChecklistProps): ReactElement | null {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const circleQuery = useCircle(circleId);
  const { circle, members, timezone } = circleQuery;

  // Presence check over a WIDE window (~30 days back, ~180 days ahead) in the
  // care recipient's timezone, so a single med/appointment anywhere nearby
  // counts — not just one inside the currently visible week.
  const today = getDateInTimezone(timezone);
  const startDate = addDays(today, -30);
  const endDate = addDays(today, 180);
  const eventsQuery = useCalendarEvents(circleId, startDate, endDate);

  const emergencyQuery = useEmergencyInfo(circleId);

  const invited =
    members.length > 1 || (circle?.pending_invites?.length ?? 0) > 0;
  const hasEvent = eventsQuery.events.length > 0;
  const hasEmergency = hasAnyEmergencyContent(emergencyQuery.data);

  const steps = useMemo<Step[]>(
    () => [
      {
        key: 'event',
        label: t('gettingStarted.step1Label'),
        desc: t('gettingStarted.step1Desc'),
        done: hasEvent,
        actionLabel: t('gettingStarted.action'),
        onAction: () => onAddEvent?.(),
      },
      {
        key: 'invite',
        label: t('gettingStarted.step2Label'),
        desc: t('gettingStarted.step2Desc'),
        done: invited,
        actionLabel: t('gettingStarted.action'),
        onAction: () => navigate(`/circles/${circleId}/members`),
      },
      {
        key: 'emergency',
        label: t('gettingStarted.step3Label'),
        desc: t('gettingStarted.step3Desc'),
        done: hasEmergency,
        actionLabel: t('gettingStarted.action'),
        onAction: () => navigate(`/circles/${circleId}/emergency`),
      },
    ],
    [t, hasEvent, invited, hasEmergency, onAddEvent, navigate, circleId]
  );

  // Loading: wait until the circle + both presence signals have settled so the
  // card never flickers from "all pending" to "done" on first paint.
  const isLoading =
    circleQuery.isLoading || eventsQuery.isLoading || emergencyQuery.isLoading;

  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === total;

  // While the checklist's own signals settle, render nothing so the empty slot
  // never flashes the fallback before the checklist resolves.
  if (isLoading) return null;
  // Complete or dismissed: hand the slot back to the host's empty state.
  if (dismissed || allDone) return <>{fallback ?? null}</>;

  return (
    <Card
      role="region"
      aria-label={t('gettingStarted.title')}
      className="relative p-6 sm:p-7"
    >
      {/* Dismiss */}
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label={t('gettingStarted.dismiss')}
        className="absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-bg-2 hover:text-ink"
      >
        <DismissIcon />
      </button>

      {/* Header */}
      <div className="pr-10">
        <p className="eyebrow m-0">{t('gettingStarted.progress', { done: doneCount, total })}</p>
        <h2 className="serif m-0 mt-1.5 text-xl leading-tight text-ink">
          {t('gettingStarted.title')}
        </h2>
        <p className="m-0 mt-1.5 max-w-md text-sm text-ink-3">{t('gettingStarted.subtitle')}</p>
      </div>

      {/* Steps */}
      <ol className="m-0 mt-4 flex list-none flex-col p-0">
        {steps.map((step) => (
          <li key={step.key} className="border-t border-line-2 first:border-t-0">
            <div className="flex items-center gap-3 py-3">
              {/* Status marker */}
              {step.done ? (
                <span
                  aria-hidden="true"
                  className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-moss-soft text-moss-deep"
                >
                  <CheckIcon />
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
                  className={`m-0 text-sm font-medium leading-snug ${
                    step.done ? 'text-ink-3 line-through' : 'text-ink'
                  }`}
                >
                  {step.label}
                  <span className="sr-only">
                    {' '}
                    {step.done ? t('gettingStarted.statusDone') : t('gettingStarted.statusPending')}
                  </span>
                </p>
                <p className="m-0 mt-0.5 text-xs leading-snug text-ink-3">{step.desc}</p>
              </div>

              {/* Pending action */}
              {!step.done && (
                <button
                  type="button"
                  onClick={step.onAction}
                  className="inline-flex flex-none items-center gap-1 rounded-full border border-line px-3.5 py-1.5 text-sm font-medium text-terracotta-deep transition-colors hover:bg-bg-2"
                >
                  {step.actionLabel}
                  <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}
