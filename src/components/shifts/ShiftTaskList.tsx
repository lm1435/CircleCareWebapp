import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { isPermissionDeniedError } from '@/api/medicationConfirmations';
import { Button, Icon, Skeleton, UndoBadge, useToast } from '@/components/ui';
import { useMedicationUndo } from '@/components/meds/useMedicationUndo';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useIsOffline } from '@/hooks/useIsOffline';
import { useShiftOccurrenceEvents } from '@/hooks/useShiftTasks';
import { UNDO_DELAY_MS, useTaskCompletion } from '@/hooks/useTaskCompletion';
import { doseAlreadyRecorded, doseAlreadyRecordedMessage } from '@/lib/doseAlreadyRecorded';
import { blockOfflineWrite, offlineDisabledProps } from '@/lib/offlineWrite';
import { Analytics } from '@/lib/analytics';
import { formatEventTimeCompact, isDoseConfirmable, zoneReferenceInstant } from '@/utils/timezone';
import { shiftAssignee } from './shiftPeople';
import { buildShiftList, doneBucket, tasksBucket, type ShiftListRow } from './shiftTasks';

export interface ShiftTaskListProps {
  circleId: string;
  shift: CalendarEvent;
  timezone: string;
  members: readonly CircleMember[];
  viewerId: string | null | undefined;
  /** May the viewer complete things and add a task (edit rights, circle not lapsed). */
  canWrite: boolean;
  /** The shift has ended: nothing can be added (the server answers 409 SHIFT_ENDED). */
  ended: boolean;
  onAdd: () => void;
  /**
   * May the list fill its first actionable Done / Taken (moss primary)? False when the detail already
   * shows a primary (an open shift's Take): ONE filled button per screen, every row is then an outline.
   */
  primaryAllowed?: boolean;
}

/**
 * The shift detail's list (docs/plans/shift-tasks.md section 1): "<Name>'s list · n of N done".
 * It holds the shift's own tasks, the doses due in the window and the on-shift person's regular
 * tasks in the window. Only the FIRST actionable row is moss-filled; the rest are outlines (the
 * one-accent rule). Other people's and Anyone's items sit in a folded "Also happening" group.
 */
export function ShiftTaskList({
  circleId,
  shift,
  timezone,
  members,
  viewerId,
  canWrite,
  ended,
  onAdd,
  primaryAllowed = true,
}: ShiftTaskListProps): ReactElement {
  const { t } = useTranslation(['shifts', 'meds', 'tasks', 'common']);
  const { showToast } = useToast();
  const hourCycle = useHourCycle();
  const offline = useIsOffline();
  const { events, isLoading, isError, refetch } = useShiftOccurrenceEvents(circleId, shift);
  const tasks = useTaskCompletion(circleId, 'shift_detail');
  const undoFlow = useMedicationUndo({
    circleId,
    source: 'care_profile',
    onConfirmed: (status) =>
      showToast(t(status === 'skipped' ? 'meds:dialog.successSkipped' : 'meds:dialog.successTaken'), 'success'),
    onError: (error, _status, med) => {
      const already = doseAlreadyRecorded(error);
      if (already) {
        showToast(doseAlreadyRecordedMessage(t, already, hourCycle), 'info');
        return;
      }
      if (isPermissionDeniedError(error)) return;
      showToast(t('meds:dialog.error', { medication: med.title }), 'error');
    },
  });

  const [alsoOpen, setAlsoOpen] = useState(false);
  const alsoId = useId();
  const model = useMemo(() => buildShiftList(shift, events), [shift, events]);
  const assignee = shiftAssignee(shift, members, viewerId);

  // shift_task_list_viewed: once per opened occurrence, when its list has loaded.
  const viewedFor = useRef<string | null>(null);
  const loaded = !isLoading && !isError;
  useEffect(() => {
    const key = `${shift.id}|${shift.scheduled_date}`;
    if (!loaded || viewedFor.current === key) return;
    viewedFor.current = key;
    Analytics.shiftTaskListViewed({
      tasksBucket: tasksBucket(model.taskTotal),
      doneBucket: doneBucket(model.done, model.total),
    });
  }, [loaded, shift.id, shift.scheduled_date, model.taskTotal, model.done, model.total]);

  const progress = { done: model.done, total: model.total };
  const title = model.open
    ? t('shifts:tasks.list.titleOpen', progress)
    : assignee?.isYou
      ? t('shifts:tasks.list.titleYou', progress)
      : t('shifts:tasks.list.titleNamed', { ...progress, name: assignee?.name || t('shifts:someone') });

  const time = (event: CalendarEvent): string =>
    event.scheduled_time
      ? formatEventTimeCompact(event.scheduled_time, timezone, hourCycle, zoneReferenceInstant(event.scheduled_date))
      : '';

  const isPending = (row: ShiftListRow): boolean =>
    row.kind === 'med' ? !!undoFlow.pending[row.event.id] : tasks.pendingIds.has(row.event.id);
  const canAct = (row: ShiftListRow): boolean => {
    if (!canWrite || row.done || row.missed || isPending(row)) return false;
    return row.kind === 'task'
      ? true
      : isDoseConfirmable(row.event.scheduled_date, row.event.scheduled_time ?? null, timezone);
  };
  // ONE filled action: the first row that has a button (none when the screen's primary is Take).
  const primaryKey = primaryAllowed ? (model.rows.find(canAct)?.key ?? null) : null;

  const renderAction = (row: ShiftListRow): ReactElement | null => {
    const name = row.event.title;
    if (row.kind === 'med' && undoFlow.pending[row.event.id]) {
      const status = undoFlow.pending[row.event.id];
      return (
        <UndoBadge
          kind={status === 'skipped' ? 'skipped' : 'taken'}
          label={t(status === 'skipped' ? 'meds:status.skipped' : 'meds:status.taken')}
          undoLabel={t('meds:undo')}
          itemLabel={name}
          onUndo={() => undoFlow.undo(row.event.id)}
          onHoldChange={(held) => undoFlow.hold(row.event.id, held)}
          className="flex-none"
        />
      );
    }
    if (row.kind === 'task' && tasks.pendingIds.has(row.event.id)) {
      return (
        <UndoBadge
          kind="done"
          label={t('shifts:tasks.list.done')}
          undoLabel={t('meds:undo')}
          itemLabel={name}
          onUndo={() => tasks.handleUndo(row.event.id)}
          onHoldChange={(held) => tasks.handleHoldUndo(row.event.id, held)}
          durationMs={UNDO_DELAY_MS}
          className="flex-none"
        />
      );
    }
    if (row.done || row.missed) {
      const word = row.missed
        ? t('shifts:tasks.list.missed')
        : row.skipped
        ? t('shifts:tasks.list.skipped')
        : row.kind === 'med'
          ? t('shifts:tasks.list.taken')
          : t('shifts:tasks.list.done');
      return (
        <span className="flex-none text-sm font-medium text-ink-2" data-testid="shift-task-row-status">
          {word}
        </span>
      );
    }
    if (!canAct(row)) return null;
    const variant = row.key === primaryKey ? 'primary' : 'outline';
    return (
      <Button
        size="sm"
        variant={variant}
        className="flex-none"
        aria-label={t(row.kind === 'med' ? 'shifts:tasks.list.takenLabel' : 'shifts:tasks.list.doneLabel', { name })}
        data-testid={row.kind === 'med' ? 'shift-task-taken' : 'shift-task-done'}
        data-variant={variant}
        {...offlineDisabledProps(offline)}
        onClick={() => {
          if (blockOfflineWrite('mark')) return;
          if (row.kind === 'med') undoFlow.confirm(row.event, 'taken');
          else tasks.handleComplete(row.event);
        }}
      >
        {row.kind === 'med' ? t('shifts:tasks.list.taken') : t('shifts:tasks.list.done')}
      </Button>
    );
  };

  const canAdd = canWrite && !ended;
  const addButton = canAdd ? (
    <div>
      <Button
        variant="secondary"
        size="sm"
        offlineKind="change"
        data-testid="shift-detail-add-task"
        leftIcon={<Icon name="add-outline" size="row" />}
        onClick={onAdd}
      >
        {t('shifts:tasks.addTask')}
      </Button>
    </div>
  ) : null;

  let body: ReactElement;
  if (isLoading) {
    body = (
      <div aria-busy="true" data-testid="shift-task-list-loading" className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (isError) {
    body = (
      <div className="flex flex-col items-start gap-2" data-testid="shift-task-list-error">
        <p role="alert" className="m-0 text-sm text-ink-2">
          {t('shifts:tasks.list.error')}
        </p>
        <Button size="sm" variant="secondary" onClick={refetch}>
          {t('shifts:tasks.list.retry')}
        </Button>
      </div>
    );
  } else if (model.rows.length === 0) {
    body = (
      <p className="m-0 text-sm text-ink-2" data-testid="shift-task-list-empty">
        {t('shifts:tasks.list.empty')}
      </p>
    );
  } else {
    body = (
      <ul className="m-0 flex list-none flex-col p-0" data-testid="shift-task-list">
        {model.rows.map((row) => (
          <li
            key={row.key}
            data-testid="shift-task-row"
            data-kind={row.kind}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line-2 py-3 first:border-t-0"
          >
            <div className="min-w-0 flex-1">
              <p
                className={`m-0 break-words text-base font-medium ${row.done ? 'text-ink-3 line-through' : 'text-ink'}`}
              >
                {row.kind === 'med' ? row.event.medication_name || row.event.title : row.event.title}
              </p>
              <p className="m-0 text-xs text-ink-2">
                {[time(row.event), row.kind === 'med' ? row.event.medication_dosage : null]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            {renderAction(row)}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby={`${alsoId}-title`} className="flex flex-col gap-3" data-testid="shift-task-section">
      <h3 id={`${alsoId}-title`} className="m-0 text-lg font-semibold text-ink" data-testid="shift-task-list-title">
        {title}
      </h3>
      {body}
      {addButton}
      {loaded && model.also.length > 0 ? (
        <div className="border-t border-line-2 pt-3">
          <button
            type="button"
            aria-expanded={alsoOpen}
            aria-controls={alsoId}
            data-testid="shift-also-toggle"
            className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-base font-medium text-ink"
            onClick={() => {
              if (!alsoOpen) Analytics.shiftAlsoHappeningExpanded();
              setAlsoOpen((v) => !v);
            }}
          >
            <span>{t('shifts:tasks.list.alsoHappening', { count: model.also.length })}</span>
            <span aria-hidden="true" className={alsoOpen ? 'rotate-180' : ''}>
              <Icon name="chevron-down" size="row" />
            </span>
          </button>
          {alsoOpen ? (
            <ul id={alsoId} className="m-0 flex list-none flex-col p-0" data-testid="shift-also-list">
              {model.also.map((event) => (
                <li key={event.id} className="flex flex-col py-2" data-testid="shift-also-row">
                  <span className="break-words text-base text-ink">{event.title}</span>
                  <span className="text-xs text-ink-2">{time(event)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
