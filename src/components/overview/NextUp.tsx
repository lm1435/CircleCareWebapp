import { useState, type ReactElement, type ReactNode } from 'react';
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
import { Analytics } from '@/lib/analytics';
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
}

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

  const visible = items.slice(0, NEXT_UP_VISIBLE);
  const today = getDateInTimezone(timezone);

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
        />
      );
    } else if (item.med && medConfirmable(item)) {
      action = (
        <Button
          size="sm"
          aria-label={t('today.nextUp.takenLabel', { name: item.title, when })}
          className={stacked ? 'w-full' : 'flex-none'}
          {...offlineDisabledProps(offline)}
          onClick={() => {
            if (blockOfflineWrite('mark')) return;
            Analytics.nextUpAction({ action: 'taken', item_type: 'medication', position });
            onTakenPressed?.();
            undoFlow.confirm(item.med!, 'taken');
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
      <li key={item.key} className="border-t border-line-2 first:border-t-0" data-testid="next-up-row">
        <div
          className={
            stacked
              ? 'flex flex-col items-stretch gap-2 py-3'
              : 'flex items-center gap-4 py-3'
          }
        >
          {time ? (
            <span
              className={`text-md font-semibold tabular-nums text-ink-2 ${stacked ? '' : 'w-20 flex-none'}`}
            >
              {time}
            </span>
          ) : (
            <span aria-hidden="true" className={stacked ? 'hidden' : 'w-20 flex-none'} />
          )}
          <Link
            to={`${base}/${PAGE_FOR[item.type]}`}
            onClick={() =>
              Analytics.nextUpAction({ action: 'open', item_type: item.type, position })
            }
            className="flex min-h-11 min-w-0 flex-1 flex-col justify-center no-underline"
          >
            <span className="break-words text-lg font-semibold text-ink">{item.title}</span>
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
        <ul className="m-0 list-none p-0">{visible.map(renderRow)}</ul>
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
