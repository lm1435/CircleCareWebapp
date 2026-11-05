import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Eyebrow, Icon, Sheet, Skeleton, UndoBadge, useToast } from '@/components/ui';
import { useMedicationUndo } from '@/components/meds/useMedicationUndo';
import { useTaskCompletion } from '@/hooks/useTaskCompletion';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useIsOffline } from '@/hooks/useIsOffline';
import { blockOfflineWrite, offlineDisabledProps } from '@/lib/offlineWrite';
import {
  changeAnswerCopy,
  doseAlreadyRecorded,
  doseAlreadyRecordedMessage,
  type DoseAlreadyRecorded,
} from '@/lib/doseAlreadyRecorded';
import { ChangeAnswerDialog } from '@/components/meds/ChangeAnswerDialog';
import { confirmFailureOutcome } from '@/lib/confirmVerify';
import { isMedicationDiscontinuedError, isOccurrenceRemovedError } from '@/lib/apiErrors';
import {
  isPermissionDeniedError,
  type ConfirmableStatus,
  type TodaysMedication,
} from '@/api/medicationConfirmations';
import { Analytics, type MedicationConfirmEntry } from '@/lib/analytics';
import { prefersReducedMotion } from '@/components/ui/motion';
import {
  formatEventTimeCompact,
  getDateInTimezone,
  isDoseConfirmable,
  zoneReferenceInstant,
} from '@/utils/timezone';
import type { NextUpItem } from './nextUpItems';

// "Next up" on Today (docs/plans/simple-ui-1-3-1.md; hi-fi HiToday): today's
// doses, appointments and tasks in time order, the first 3 shown, then
// "All of today · N items". ONE primary action per row: Taken for a due or late
// dose, Done for a task. Late is said in text ("2 hours late"), never colour
// alone. Large text (200% zoom / large root font): the row stacks - time line,
// name, full-width action.

/** Rows shown before "All of today". */
export const NEXT_UP_VISIBLE = 3;

/** How long the row a notification landed on stays highlighted. */
export const LANDING_HIGHLIGHT_MS = 3000;

/** The dose row a notification landed on (OverviewPage resolved it from the URL). */
export interface NextUpLanding {
  /** `NextUpItem.key` of the row. */
  key: string;
  /** How the person got here, for `medication_confirmed`. */
  entry: MedicationConfirmEntry;
}

export interface NextUpProps {
  circleId: string;
  timezone: string;
  recipientName: string;
  isSelfCare: boolean;
  canEdit: boolean;
  items: readonly NextUpItem[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  /** Large-text layout: rows stack. */
  stacked: boolean;
  /**
   * Rendered directly under the first confirmable dose row (the one-time
   * first-dose hint). The row index it follows is `hintAfterKey`.
   */
  hint?: ReactNode;
  hintAfterKey?: string | null;
  /** Fired when Taken is pressed (the hint reads it to count as acted). */
  onTakenPressed?: () => void;
  /**
   * A notification landed on this row: it is rendered even past the first
   * NEXT_UP_VISIBLE, scrolled into view, highlighted for a moment, and focus
   * moves to its Taken button (its link when it has none: view-only).
   */
  landing?: NextUpLanding | null;
}


/**
 * The name column's flex basis while an undo badge shows: grow and shrink from 12rem, so a
 * row that cannot give the name 12rem beside the badge wraps the badge below instead.
 */
export const BADGE_ROW_NAME_BASIS = 'flex-[1_1_12rem]';

/**
 * A name never breaks INSIDE a word (owner report, mobile 1.4.0 build 8: "Escitalopra / m" beside
 * the undo badge, with the zone-labelled time "9:00 PM (Denver)" in the first column). The name
 * column's minimum is its longest word (`min-width: auto`, capped at the row by `max-w-full`;
 * `overflow-wrap: break-word` does not lower it), and every inline row WRAPS: when time + longest
 * word + action do not fit on one line, the action (or the name) moves to the next line instead
 * of the browser cutting the word. A single word wider than the whole row is the only one ever
 * broken. The time column is 5rem but never narrower than its own longest word (a long zone
 * label such as "(Johannesburg)" no longer overflows into the name).
 */
export const NAME_COLUMN_MIN = 'max-w-full';

/** Whole calendar days `date` lies before `today` (both YYYY-MM-DD); 0 for today or later. */
function daysBefore(date: string, today: string): number {
  const ms = Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 86_400_000) : 0;
}

const PAGE_FOR: Record<NextUpItem['type'], string> = {
  medication: 'meds',
  appointment: 'calendar',
  task: 'tasks',
};

export function NextUp({
  circleId,
  timezone,
  recipientName,
  isSelfCare,
  canEdit,
  items,
  loading,
  error,
  onRetry,
  stacked,
  hint,
  hintAfterKey = null,
  onTakenPressed,
  landing = null,
}: NextUpProps): ReactElement {
  const { t } = useTranslation(['overview', 'meds', 'common']);
  const { showToast } = useToast();
  const offline = useIsOffline();
  const hourCycle = useHourCycle();
  const base = `/circles/${circleId}`;
  // PK29: the already-recorded notice's "Change answer" opens this (same flow as the old Today's meds card).
  const [changing, setChanging] = useState<{
    med: TodaysMedication;
    mine: ConfirmableStatus;
    theirs: DoseAlreadyRecorded;
  } | null>(null);

  // LANDING: the highlight lasts a moment; the ENTRY (for analytics) lasts as long as the page.
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const landedRef = useRef<NextUpLanding | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const landingKey = landing?.key ?? null;
  const landingEntry = landing?.entry ?? null;

  const undoFlow = useMedicationUndo({
    circleId,
    source: 'care_profile',
    onConfirmed: (status) =>
      showToast(t(status === 'skipped' ? 'meds:dialog.successSkipped' : 'meds:dialog.successTaken'), 'success'),
    onError: (error, status, med) => {
      const already = doseAlreadyRecorded(error);
      if (already) {
        // Someone else answered first: calm information, not a failure. When the answers differ
        // (and theirs has a time) the notice offers "Change answer" (PK29).
        const canChange = changeAnswerCopy(t, already, status, hourCycle) !== null;
        showToast(
          doseAlreadyRecordedMessage(t, already, hourCycle),
          'info',
          canChange
            ? {
                label: t('meds:dialog.changeAnswerAction'),
                onClick: () => setChanging({ med, mine: status, theirs: already }),
              }
            : undefined
        );
        return;
      }
      if (isPermissionDeniedError(error)) return;
      showToast(
        t(
          isMedicationDiscontinuedError(error)
            ? 'meds:dialog.errorDiscontinued'
            : isOccurrenceRemovedError(error)
              ? 'meds:dialog.errorOccurrenceRemoved'
              : confirmFailureOutcome(error) === 'unverified'
                ? 'meds:dialog.errorUnverified'
                : 'meds:dialog.error',
          { medication: med.medication_name || med.title }
        ),
        'error'
      );
    },
  });
  const tasks = useTaskCompletion(circleId);

  // The landed row is always shown, even when it is past the first NEXT_UP_VISIBLE.
  const landedIndex = landingKey ? items.findIndex((i) => i.key === landingKey) : -1;
  const visible = items.slice(0, Math.max(NEXT_UP_VISIBLE, landedIndex + 1));
  // The 5rem leading column exists so timed and untimed rows align on the
  // title. When nothing visible has a time (e.g. only late, dateless tasks),
  // the whole column would be dead space — collapse it instead.
  const anyVisibleTimed = visible.some((i) => i.time);
  const today = getDateInTimezone(timezone);

  // The entry belongs to the circle it was set in.
  useEffect(() => {
    landedRef.current = null;
  }, [circleId]);

  // A notification landed on a row: bring it into view, mark it for a moment, put focus on the
  // action (the link for a view-only member, who gets no Taken button), and say why in a polite
  // live region. Runs when the landing key changes, once the rows are on screen.
  useEffect(() => {
    if (!landingKey || !landingEntry || loading) return;
    const row = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-next-up-key]') ?? []
    ).find((el) => el.dataset.nextUpKey === landingKey);
    if (!row) return;
    landedRef.current = { key: landingKey, entry: landingEntry };
    setHighlightKey(landingKey);
    setAnnouncement(t('today.nextUp.landingNotMarked'));
    if (typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    (
      row.querySelector<HTMLElement>('[data-next-up-taken]') ?? row.querySelector<HTMLElement>('a')
    )?.focus({ preventScroll: true });
    const timer = window.setTimeout(() => {
      setHighlightKey(null);
      setAnnouncement('');
    }, LANDING_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
    // `t` is stable per language; a language switch must not replay the landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingKey, landingEntry, loading]);

  if (loading) {
    return (
      <section aria-labelledby="next-up-heading" aria-busy="true">
        <Eyebrow id="next-up-heading" color="ink-2" className="mb-3">
          {t('today.nextUp.heading')}
        </Eyebrow>
        <Sheet padding="md" className="flex flex-col gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </Sheet>
      </section>
    );
  }

  const medConfirmable = (item: NextUpItem): boolean =>
    item.med != null &&
    canEdit &&
    isDoseConfirmable(item.med.scheduled_date, item.med.scheduled_time ?? null, timezone);

  const renderRow = (item: NextUpItem, index: number): ReactElement => {
    const position = index + 1;
    const pendingMed = item.med ? undoFlow.pending[item.med.id] : undefined;
    const pendingTask = item.type === 'task' && tasks.pendingIds.has(item.id);
    const time = item.time
      ? formatEventTimeCompact(item.time, timezone, hourCycle, zoneReferenceInstant(item.date))
      : null;
    const lateText = item.late
      ? item.lateHours !== null
        ? t('today.nextUp.lateHours', { count: item.lateHours })
        : t('today.nextUp.late')
      : null;
    const sub = [item.detail, lateText].filter(Boolean).join(' · ');
    // The action's accessible name carries WHEN (mobile NextUpCard actionWhen): yesterday's and
    // today's dose of one med, or a med's two times, would otherwise share "Taken, <med>".
    const overdueDays = daysBefore(item.date, today);
    const day =
      overdueDays <= 0
        ? null
        : item.type === 'medication' && overdueDays === 1
          ? t('today.nextUp.yesterday')
          : t('today.nextUp.daysOverdue', { count: overdueDays });
    const when = day
      ? [day, time].filter(Boolean).join(', ')
      : (time ?? t('today.nextUp.anyTime'));

    // The undo badge keeps its own width: a stacked row is `flex-col items-stretch` (for the
    // full-width Taken / Done), which stretched the status pill across the card as a new row
    // (mobile NextUpCard, owner report 1.4.0). Inline it never shrinks into the text column.
    const badgeClass = stacked ? 'self-start' : 'flex-none';
    // A long name beside the badge (wider than Taken) wrapped to ~5 lines (owner report,
    // 1.4.0, mobile NextUpCard parity). While a badge shows, the row wraps and the name
    // claims at least BADGE_ROW_NAME_BASIS: when name + badge do not fit on one line the
    // badge drops onto its own line below, at its own width. Pure CSS, so it cannot flip-flop.
    const badgeShown = !!pendingMed || pendingTask;
    let action: ReactElement | null = null;
    if (pendingMed) {
      action = (
        <UndoBadge
          kind={pendingMed === 'skipped' ? 'skipped' : 'taken'}
          label={t(pendingMed === 'skipped' ? 'meds:status.skipped' : 'meds:status.taken')}
          undoLabel={t('meds:undo')}
          itemLabel={item.title}
          onUndo={() => undoFlow.undo(item.med!.id)}
          onHoldChange={(held) => undoFlow.hold(item.med!.id, held)}
          className={badgeClass}
        />
      );
    } else if (pendingTask) {
      action = (
        <UndoBadge
          kind="done"
          label={t('today.nextUp.done')}
          undoLabel={t('meds:undo')}
          itemLabel={item.title}
          onUndo={() => tasks.handleUndo(item.id)}
          onHoldChange={(held) => tasks.handleHoldUndo(item.id, held)}
          className={badgeClass}
        />
      );
    } else if (item.med && medConfirmable(item)) {
      action = (
        <Button
          size="sm"
          aria-label={t('today.nextUp.takenLabel', { name: item.title, when })}
          className={stacked ? 'w-full' : 'flex-none'}
          data-next-up-taken=""
          {...offlineDisabledProps(offline)}
          onClick={() => {
            if (blockOfflineWrite('mark')) return;
            Analytics.nextUpAction({ action: 'taken', item_type: 'medication', position });
            onTakenPressed?.();
            // Taken on the row a notification landed on: the event says how they got here.
            const landed = landedRef.current;
            if (landed && landed.key === item.key) {
              undoFlow.confirm(item.med!, 'taken', { entry: landed.entry });
            } else {
              undoFlow.confirm(item.med!, 'taken');
            }
          }}
        >
          {t('today.nextUp.taken')}
        </Button>
      );
    } else if (item.type === 'task' && item.event && canEdit) {
      action = (
        <Button
          size="sm"
          aria-label={t('today.nextUp.doneLabel', { name: item.title, when })}
          className={stacked ? 'w-full' : 'flex-none'}
          {...offlineDisabledProps(offline)}
          onClick={() => {
            if (blockOfflineWrite('mark')) return;
            Analytics.nextUpAction({ action: 'done', item_type: 'task', position });
            tasks.handleComplete(item.event!);
          }}
        >
          {t('today.nextUp.done')}
        </Button>
      );
    }

    return (
      <li
        key={item.key}
        className="border-t border-line-2 first:border-t-0"
        data-testid="next-up-row"
        data-next-up-key={item.key}
      >
        {/* The inset (-mx-2 px-2) gives the landing highlight room around the text; the
            highlight is a tint plus a ring from the theme tokens, so it reads in light and dark. */}
        <div
          data-highlighted={highlightKey === item.key ? 'true' : undefined}
          className={`-mx-2 rounded-lg px-2 transition-colors duration-500 motion-reduce:transition-none ${
            highlightKey === item.key ? 'bg-moss-soft ring-2 ring-moss' : ''
          } ${
            stacked
              ? 'flex flex-col items-stretch gap-2 py-3'
              : 'flex flex-wrap items-center gap-x-4 gap-y-2 py-3'
          }`}
        >
          {time ? (
            <span
              className={`text-md font-semibold tabular-nums text-ink-2 ${stacked ? '' : 'flex-[0_0_5rem]'}`}
            >
              {time}
            </span>
          ) : anyVisibleTimed ? (
            <span aria-hidden="true" className={stacked ? 'hidden' : 'flex-[0_0_5rem]'} />
          ) : null}
          <Link
            to={`${base}/${PAGE_FOR[item.type]}`}
            onClick={() =>
              Analytics.nextUpAction({ action: 'open', item_type: item.type, position })
            }
            className={`flex min-h-11 ${NAME_COLUMN_MIN} flex-col justify-center no-underline ${
              badgeShown && !stacked ? BADGE_ROW_NAME_BASIS : 'flex-1'
            }`}
            data-next-up-name=""
          >
            {/* text-lg matches mobile's Today card at phone width; at xl the
                desktop density steps item titles down to the 18px body size. */}
            <span className="break-words text-lg font-semibold text-ink xl:text-base">{item.title}</span>
            {sub ? <span className="break-words text-sm text-ink-2">{sub}</span> : null}
          </Link>
          {action}
        </div>
        {hint && hintAfterKey === item.key ? <div className="pb-3">{hint}</div> : null}
      </li>
    );
  };

  let body: ReactElement;
  if (error && items.length === 0) {
    body = (
      <div>
        <p className="m-0 mb-2 text-sm text-ink-2">{t('today.nextUp.loadError')}</p>
        <button
          type="button"
          onClick={onRetry}
          className="flex min-h-11 items-center text-md font-medium text-dusk"
        >
          {t('common:retry')}
        </button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <p className="m-0 text-md text-ink-2">
        {isSelfCare || !recipientName
          ? t('today.nextUp.emptySelf')
          : t('today.nextUp.empty', { name: recipientName })}
      </p>
    );
  } else {
    body = (
      <Sheet padding="none" className="px-4">
        <ul ref={listRef} className="m-0 list-none p-0">
          {visible.map(renderRow)}
        </ul>
        <Link
          to={`${base}/calendar`}
          onClick={() => Analytics.todayAllItemsOpened()}
          className="flex min-h-11 items-center justify-between gap-2 border-t border-line-2 py-3 text-md font-semibold text-ink no-underline"
        >
          <span>{t('today.nextUp.allOfToday', { count: items.length })}</span>
          <Icon name="chevron-forward" size="inline" className="text-ink-3" />
        </Link>
      </Sheet>
    );
  }

  return (
    <section aria-labelledby="next-up-heading">
      <Eyebrow id="next-up-heading" color="ink-2" className="mb-3">
        {t('today.nextUp.heading')}
      </Eyebrow>
      {body}
      {/* Polite live region for the landing line; always mounted so the text change is announced. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {changing && (
        <ChangeAnswerDialog
          circleId={circleId}
          med={changing.med}
          mine={changing.mine}
          theirs={changing.theirs}
          source="care_profile"
          onClose={() => setChanging(null)}
        />
      )}
    </section>
  );
}

export default NextUp;
