import { baseLanguage } from '@/i18n/locales';
import { useLayoutEffect, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, UndoBadge, STATUS_PILL } from '@/components/ui';
import type { AsNeededSummary } from '@/api/medicationAsNeeded';
import { firstNameOf, formatGivenWhen } from '@/lib/asNeeded';
import { useHourCycle } from '@/hooks/useHourCycle';
import type { TimeLanguage } from '@/utils/timezone';

// The two pieces every as-needed (PRN) card shares — the roster card and Home's
// section — so a medication reads the same wherever it is drawn.
//
// NO LIMITS, NO COUNTERS (owner decision 2026-10-05): the status is "Last given
// {time} by {name}" or "Not given yet", and nothing else. No "2 of 4", no "OK
// again after", no warning. Whether another dose is appropriate is the family's
// call, not the app's.

export interface LastGivenLineProps {
  summary: AsNeededSummary | undefined;
  /** Care recipient's IANA zone — `given_at` is an instant read in THIS frame. */
  timezone: string;
  /** The viewer's user id, so their own dose reads "by you". */
  myUserId: string | null | undefined;
}

export function LastGivenLine({
  summary,
  timezone,
  myUserId,
}: LastGivenLineProps): ReactElement | null {
  const { t, i18n } = useTranslation('meds');
  const hourCycle = useHourCycle();
  const language: TimeLanguage = baseLanguage(i18n.language);

  // Never claim "Not given yet" off a read that has not answered: that would
  // tell a caregiver nobody gave the dose, which is exactly the wrong thing to
  // be wrong about.
  if (!summary) return null;

  const last = summary.last_dose;
  if (!last) {
    return <span data-testid="as-needed-last-given">{t('asNeeded.card.notGivenYet')}</span>;
  }

  const when = formatGivenWhen(last.given_at, timezone, hourCycle, language, {
    today: t('history.today'),
    yesterday: t('history.yesterday'),
  });
  const mine = !!myUserId && last.given_by.id === myUserId;
  const name = firstNameOf(last.given_by) ?? t('asNeeded.history.someone');

  return (
    <span data-testid="as-needed-last-given">
      {t('asNeeded.card.lastGivenPrefix')} <strong className="font-semibold text-ink">{when}</strong>{' '}
      {mine ? t('asNeeded.card.byYou') : t('asNeeded.card.byName', { name })}
    </span>
  );
}

export interface AsNeededActionsProps {
  /** Medication name — names each button for assistive tech. */
  name: string;
  /** The viewer can write. Hidden (not disabled) for view-only, as everywhere. */
  canEdit: boolean;
  /** The medication is inactive: no dose can be logged until it is reactivated. */
  inactive?: boolean;
  /** The dose is counting down its 5 s undo window or in flight. */
  pending: boolean;
  /** The POST has already left: Undo is no longer possible. */
  inFlight: boolean;
  onGive: () => void;
  onHistory: () => void;
  onUndo: () => void;
  /** Pause (`true`) / resume (`false`) the undo countdown — see UndoBadge `onHoldChange`. */
  onHoldUndo?: (held: boolean) => void;
}

export function AsNeededActions({
  name,
  canEdit,
  inactive = false,
  pending,
  inFlight,
  onGive,
  onHistory,
  onUndo,
  onHoldUndo,
}: AsNeededActionsProps): ReactElement {
  const { t } = useTranslation('meds');

  // After Undo the badge (which held focus) is replaced by "Gave a dose" again.
  // Put focus back on it, the control the keyboard user pressed in the first
  // place. UndoBadge's own fallback would pick the row's FIRST focusable (the
  // card's "View details"), which is the wrong place to resume (WCAG 2.4.3).
  // Only when focus was lost to <body>: a user who moved on keeps their place.
  const giveRef = useRef<HTMLButtonElement>(null);
  const wasPending = useRef(pending);
  useLayoutEffect(() => {
    const was = wasPending.current;
    wasPending.current = pending;
    if (!was || pending) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    giveRef.current?.focus();
  }, [pending]);

  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
      <Button
        variant="ghost"
        size="md"
        onClick={onHistory}
        aria-label={t('asNeeded.card.historyA11y', { name })}
      >
        {t('asNeeded.card.history')}
      </Button>
      {canEdit &&
        !inactive &&
        (pending ? (
          inFlight ? (
            <span className={STATUS_PILL.taken}>{t('asNeeded.card.loggedBadge')}</span>
          ) : (
            <UndoBadge
              kind="taken"
              label={t('asNeeded.card.loggedBadge')}
              undoLabel={t('undo')}
              itemLabel={name}
              onUndo={onUndo}
              onHoldChange={onHoldUndo}
            />
          )
        ) : (
          <Button
            ref={giveRef}
            size="md"
            onClick={onGive}
            aria-label={t('asNeeded.card.giveA11y', { name })}
          >
            {t('asNeeded.card.give')}
          </Button>
        ))}
    </div>
  );
}
