import { useEffect, useRef, type ReactElement, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Eyebrow, Icon, TEXT_CLASS, Text } from '@/components/ui';
import { formatWeekdayList } from '@/components/calendar/recurrenceLabel';
import { formatEventTimeForDisplay, zoneReferenceInstant } from '@/utils/timezone';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { startsWhen, type SavedMedicationInfo } from '@/utils/firstMedSaved';
import { useIsOffline } from '@/hooks/useIsOffline';
import { explainOfflineWrite, offlineDisabledProps } from '@/lib/offlineWrite';
import type { HourCycle } from '@/utils/hourCycle';
import type { FirstRunAction } from './firstRunActionRoute';

/**
 * The first-run wizard's two screens, after the onboarding 1.3.1 fold (spec section 3):
 *
 *   Setup (1)  ChooseActionStep   "{{name}}'s circle is ready." + ONE primary + quiet rows
 *   Payoff     FirstMedPayoffStep "ALL SET", the saved-dose card, the Mark it line
 *
 * Name / time / repeat are no longer wizard steps: "Add {{name}}'s first med" opens the ONE
 * simple medication form (AddEventModal in first-run mode). Presentation only: no timezone,
 * no payload, no analytics (the wizard owns those).
 */

// ── Setup (1) ───────────────────────────────────────────────────────────────

export interface ChooseActionStepProps {
  recipientName: string;
  /** Self-care owner IS the recipient: address them as "you", not by name. */
  isSelfCare?: boolean;
  onSelect: (action: FirstRunAction) => void;
  /**
   * The step heading. The wizard passes it to the Modal as `initialFocusRef`, so opening
   * Setup (and coming back to it from a hand-off) focuses the heading, not the x.
   */
  headingRef?: RefObject<HTMLHeadingElement>;
}

/**
 * Screen (1) (ObWebSetupAfter): eyebrow, "{{name}}'s circle is ready.", the lede, ONE
 * primary button for the first med with its one-line promise, then "OR START WITH" and three
 * quiet one-tap rows (an appointment, someone to help, emergency info). "Skip for now" lives
 * in the modal footer. Every row selects AND advances in one tap, so the footer carries no
 * Continue (a documented exception to "every footer keeps one filled primary").
 */
export function ChooseActionStep({
  recipientName,
  isSelfCare,
  onSelect,
  headingRef,
}: ChooseActionStepProps): ReactElement {
  const { t, i18n } = useTranslation('circles');
  // Offline (owner decision 2026-10-14): every choice here starts a create, so each
  // explains with the 'change' sentence and goes nowhere. "Skip for now" is a close and
  // stays live.
  const offline = useIsOffline();

  const rows: { id: Exclude<FirstRunAction, 'skip' | 'medication'>; title: string }[] = [
    { id: 'appointment', title: t('firstRun.ready.appointmentTitle') },
    { id: 'invite', title: t('firstRun.ready.inviteTitle') },
    { id: 'emergency', title: t('firstRun.ready.emergencyTitle') },
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="first-run-choose">
      <header className="flex flex-col gap-2">
        <Eyebrow>
          {isSelfCare
            ? t('firstRun.ready.eyebrowSelf')
            : t('firstRun.ready.eyebrow', {
                name: recipientName.toLocaleUpperCase(i18n.language),
              })}
        </Eyebrow>
        {/* Plain h3 (the h2 style) so the ref + tabIndex reach the DOM node. */}
        <h3 ref={headingRef} tabIndex={-1} className={`${TEXT_CLASS.h2} m-0 outline-none`}>
          {isSelfCare
            ? t('firstRun.ready.titleSelf')
            : t('firstRun.ready.title', { name: recipientName })}
        </h3>
        <Text variant="caption" id="first-run-ready-lede">
          {t('firstRun.ready.lede')}
        </Text>
      </header>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          fullWidth
          offlineKind="change"
          onClick={() => onSelect('medication')}
          data-testid="first-run-primary"
          aria-describedby="first-run-primary-promise"
        >
          {isSelfCare
            ? t('firstRun.choose.primarySelf')
            : t('firstRun.choose.primary', { name: recipientName })}
        </Button>
        <Text variant="caption" id="first-run-primary-promise" className="text-center">
          {isSelfCare ? t('firstRun.choose.promiseSelf') : t('firstRun.choose.promise')}
        </Text>
      </div>

      <section aria-labelledby="first-run-or-start-with" className="flex flex-col gap-1">
        <Eyebrow id="first-run-or-start-with" color="ink-2">
          {t('firstRun.ready.orStartWith')}
        </Eyebrow>
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => (
            <li key={row.id} className="border-t border-line-2">
              <button
                type="button"
                {...offlineDisabledProps(offline)}
                onClick={() => (offline ? explainOfflineWrite('change') : onSelect(row.id))}
                data-testid={`first-run-start-with-${row.id}`}
                className={`flex min-h-[52px] w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left text-md text-ink transition-colors duration-fast hover:bg-bg-2${offline ? ' cursor-not-allowed opacity-50' : ''}`}
              >
                <span>{row.title}</span>
                <Icon name="chevron-forward" size="inline" className="flex-none text-ink-3" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ── Payoff ──────────────────────────────────────────────────────────────────

export interface FirstMedPayoffStepProps {
  recipientName: string;
  /** Self-care owner IS the recipient: address them as "you", not by name. */
  isSelfCare?: boolean;
  saved: SavedMedicationInfo;
  hourCycle: HourCycle;
  /** Show the "Already given today? Mark it" line (rolled start, can confirm doses). */
  markIt: { onMark: () => void; pending: boolean; done: boolean } | null;
  /** The step heading; the wizard also hands it to the Modal as `initialFocusRef`. */
  headingRef?: RefObject<HTMLHeadingElement>;
  /** Where focus goes once Mark it succeeded (its button is gone): the footer's Continue. */
  onMarked?: () => void;
}

/**
 * The payoff (ObWebPayoffAfter, WITHOUT the invite block - decision 7): "ALL SET", the
 * reminder sentence, the saved-dose card with when it starts, the one-line explanation, and
 * the Mark it line when the start rolled. The footer carries the one primary, "Continue".
 */
export function FirstMedPayoffStep({
  recipientName,
  isSelfCare,
  saved,
  hourCycle,
  markIt,
  headingRef: headingRefProp,
  onMarked,
}: FirstMedPayoffStepProps): ReactElement {
  const { t, i18n } = useTranslation(['circles', 'calendar']);
  const offline = useIsOffline();
  const ownHeadingRef = useRef<HTMLHeadingElement>(null);
  const headingRef = headingRefProp ?? ownHeadingRef;
  // Focus follows the step change (the heading names what just happened).
  useEffect(() => {
    headingRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // Mark it succeeded: its button left the DOM (focus would fall to <body>). The polite
  // region below already holds the text; focus moves on to the next step.
  const done = markIt?.done === true;
  useEffect(() => {
    if (done) onMarked?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on the done edge only
  }, [done]);

  // The saved doses the way every other surface shows a dose: the recipient's time, bare when
  // the viewer shares the recipient's zone, both clocks named when they do not.
  const times = saved.doses.map((dose) =>
    formatEventTimeForDisplay(
      dose.scheduledTime,
      saved.timezone,
      undefined,
      zoneReferenceInstant(dose.scheduledDate),
      hourCycle
    )
  );
  const multi = times.length > 1;
  const title = isSelfCare
    ? multi
      ? t('firstRun.payoff.titleMultiSelf')
      : t('firstRun.payoff.titleSelf', { time: times[0] })
    : multi
      ? t('firstRun.payoff.titleMulti', { name: recipientName })
      : t('firstRun.payoff.title', { name: recipientName, time: times[0] });

  // Literal keys on purpose (key-coverage tooling resolves literals only). The first-run
  // form offers every day / some days; anything else reads as "every day".
  const rule = saved.recurrenceRule;
  const weekdays = formatWeekdayList(saved.recurrenceDays, i18n.language);
  const recurrence =
    rule === 'weekly'
      ? weekdays
        ? t('calendar:recurrence.weeklyOn', { days: weekdays })
        : t('calendar:recurrence.weekly')
      : rule === 'every_other_day'
        ? t('calendar:recurrence.everyOtherDay')
        : t('firstRun.payoff.everyDay');
  const when = startsWhen(saved);
  const starts =
    when === 'today'
      ? t('firstRun.payoff.startsToday')
      : when === 'tomorrow'
        ? t('firstRun.payoff.startsTomorrow')
        : t('firstRun.payoff.startsOn', {
            date: formatDateForDisplay(
              saved.startDate ?? saved.doses[0].scheduledDate,
              { weekday: 'short', month: 'short', day: 'numeric' },
              i18n.language
            ),
          });
  const detail = [saved.dosage.trim(), recurrence, starts].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-4" data-testid="first-run-payoff">
      <Eyebrow>{t('firstRun.payoff.eyebrow')}</Eyebrow>
      <h3 ref={headingRef} tabIndex={-1} className={`${TEXT_CLASS.h2} m-0 outline-none`}>
        {title}
      </h3>

      <Card
        variant="outlined"
        padding="md"
        className="flex items-center gap-4"
        data-testid="first-run-payoff-card"
      >
        <span className="w-20 flex-none text-md font-semibold tabular-nums text-ink-2">
          {times.join(', ')}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="break-words text-lg font-semibold text-ink">{saved.name}</span>
          <span className="break-words text-sm text-ink-2">{detail}</span>
        </div>
      </Card>

      <Text variant="caption">
        {isSelfCare ? t('firstRun.payoff.lineSelf') : t('firstRun.payoff.line')}
      </Text>

      {markIt && (
        <p className="m-0 text-md text-ink" data-testid="mark-it-line">
          {/* ALWAYS mounted (empty until done): a live region inserted together with its
              text is not reliably spoken (WCAG 4.1.3). */}
          <span role="status" data-testid="mark-it-announcer">
            {markIt.done ? t('firstRun.markIt.done') : ''}
          </span>
          {markIt.done ? null : (
            <>
              {t('firstRun.markIt.question')}{' '}
              <button
                type="button"
                onClick={markIt.onMark}
                // aria-disabled while in flight, not disabled: a disabled button drops
                // keyboard focus, and on a failed mark the user is left nowhere.
                aria-disabled={markIt.pending || undefined}
                {...offlineDisabledProps(offline)}
                data-testid="mark-it-button"
                className="min-h-[44px] cursor-pointer border-0 bg-transparent p-0 text-md font-semibold text-moss-deep underline underline-offset-2 hover:text-moss aria-disabled:cursor-wait"
              >
                {t('firstRun.markIt.action')}
              </button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
