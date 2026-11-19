import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { isPermissionDeniedError } from '@/api/medicationConfirmations';
import { Button, Card, HighlightRing, Icon, Skeleton, UndoBadge, useToast } from '@/components/ui';
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
import { hasShiftEnded } from './shiftUtils';
import {
  buildShiftList,
  doneBucket,
  isShiftItemLate,
  rowMatchesHighlight,
  tasksBucket,
  type ShiftListRow,
} from './shiftTasks';

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
   * A TASK row's text block was tapped (1.4.3): the caller opens the editor (an open task) or the read-only
   * detail (a completed one). Medication rows are never tappable, and the Done / Taken button stays its own
   * sibling target. Omitted = the rows are static, as before.
   */
  onOpenTask?: (row: ShiftListRow) => void;
  /**
   * The task to ring after a save: the id of the new / edited task. A repeating task's row for the day is
   * usually the virtual `<root>_<date>` occurrence, so it matches the root id too. `onHighlightDone` fires
   * once the ring has run (the caller clears it so a re-render never replays it).
   */
  highlightTaskId?: string | null;
  onHighlightDone?: () => void;
  /**
   * May the list fill its first actionable Done / Taken (moss primary)? False when the detail already
   * shows a primary (an open shift's Take): ONE filled button per screen, every row is then an outline.
   */
  primaryAllowed?: boolean;
}

/**
 * The shift detail's list (docs/plans/shift-tasks.md section 1): "<Name>'s list · n of N done"
 * (just "<Name>'s list" while it is empty: never "0 of 0 done"). An empty list is ONE card: the empty
 * line and a borderless moss "Add a task" (1.4.3, mobile parity; outlines are for Edit / Assign / Delete).
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
  onOpenTask,
  highlightTaskId = null,
  onHighlightDone,
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
  // "Late" needs a clock: re-evaluated once a minute (an item crosses 15 minutes while the page is open).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  // Once the shift is over nothing on it is "late" any more (the list is a record by then).
  const shiftOver = hasShiftEnded(shift, timezone, new Date(nowMs));
  const alsoId = useId();
  const hintId = `${alsoId}-open-hint`;
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
  const empty = model.total === 0;
  const title = model.open
    ? empty
      ? t('shifts:tasks.list.titleOpenEmpty')
      : t('shifts:tasks.list.titleOpen', progress)
    : assignee?.isYou
      ? empty
        ? t('shifts:tasks.list.titleYouEmpty')
        : t('shifts:tasks.list.titleYou', progress)
      : empty
        ? t('shifts:tasks.list.titleNamedEmpty', { name: assignee?.name || t('shifts:someone') })
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

  // 15 min or more past due and still open (not done, skipped, missed or just answered): danger-coloured time + "Late".
  const isLate = (row: ShiftListRow): boolean =>
    !row.done && !row.missed && !isPending(row) && !shiftOver && isShiftItemLate(row.event, timezone, nowMs);
  const timeCaption = (row: ShiftListRow): ReactElement | string => {
    const clock = time(row.event);
    if (!clock || !isLate(row)) return clock;
    return (
      <span className="text-terracotta-deep" data-testid="shift-task-row-late">
        {`${clock} · ${t('shifts:tasks.list.late')}`}
      </span>
    );
  };

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
        variant="ghost"
        size="sm"
        offlineKind="change"
        data-testid="shift-detail-add-task"
        data-variant="ghost"
        leftIcon={<Icon name="add-outline" size="row" />}
        onClick={onAdd}
      >
        {t('shifts:tasks.form.title')}
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
      <Card
        variant="outlined"
        padding="none"
        className="flex flex-col items-start gap-3 p-4"
        data-testid="shift-task-list-empty-card"
      >
        <p className="m-0 text-base text-ink-2" data-testid="shift-task-list-empty">
          {t('shifts:tasks.list.empty')}
        </p>
        {addButton}
      </Card>
    );
  } else {
    body = (
      <ul className="m-0 flex list-none flex-col p-0" data-testid="shift-task-list">
        {model.rows.map((row) => {
          // A task row's text block is a BUTTON, a sibling of Done (never its parent). Its name is the visible
          // text with an sr-only "Edit" / "View" in front, so the time and "Late" are read too. Medication
          // rows, a task with a pending Done and an open task for a view-only member stay static.
          const openable = row.kind === 'task' && !!onOpenTask && !isPending(row) && (row.done || canWrite);
          const highlighted = highlightTaskId !== null && rowMatchesHighlight(row, highlightTaskId);
          const text = (
            <>
              <span className="min-w-0 flex-1">
                <span
                  className={`block break-words text-base font-medium ${row.done ? 'text-ink-3 line-through' : 'text-ink'}`}
                >
                  {openable ? (
                    <>
                      <span className="sr-only">
                        {t(row.done ? 'shifts:tasks.list.viewLabel' : 'shifts:tasks.list.editLabel', { name: '' }).trim()}
                      </span>{' '}
                    </>
                  ) : null}
                  <span data-testid="shift-task-row-name">
                    {row.kind === 'med' ? row.event.medication_name || row.event.title : row.event.title}
                  </span>
                </span>{' '}
                <span className="block text-xs text-ink-2">
                  {timeCaption(row)}
                  {row.kind === 'med' && row.event.medication_dosage
                    ? `${time(row.event) ? ' · ' : ''}${row.event.medication_dosage}`
                    : null}
                </span>
              </span>
              {openable ? (
                <span aria-hidden="true" className="flex-none text-ink-3">
                  <Icon name="chevron-forward" size="row" />
                </span>
              ) : null}
            </>
          );
          return (
            <li
              key={row.key}
              data-testid="shift-task-row"
              data-kind={row.kind}
              className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-line-2 py-3 first:border-t-0"
            >
              {openable ? (
                <button
                  type="button"
                  data-testid="shift-task-open"
                  aria-describedby={hintId}
                  className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-lg bg-transparent p-0 text-left"
                  onClick={() => onOpenTask?.(row)}
                >
                  {text}
                </button>
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-2">{text}</div>
              )}
              {renderAction(row)}
              {highlighted ? <HighlightRing onDone={onHighlightDone} /> : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby={`${alsoId}-title`} className="flex flex-col gap-3" data-testid="shift-task-section">
      <h3 id={`${alsoId}-title`} className="m-0 text-lg font-semibold text-ink" data-testid="shift-task-list-title">
        {title}
      </h3>
      {onOpenTask ? (
        <span id={hintId} className="sr-only">
          {t('shifts:tasks.list.openHint')}
        </span>
      ) : null}
      {body}
      {loaded && model.rows.length === 0 ? null : addButton}
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
