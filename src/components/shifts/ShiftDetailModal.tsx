import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Avatar, Button, Card, Eyebrow, Modal, Text } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { canWriteShifts, resolveShiftsEntry } from '@/lib/shiftsAccess';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useShiftSeriesRoot } from '@/hooks/useShifts';
import { useAuthStore } from '@/store/authStore';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { formatWeekdayList } from '@/components/calendar/recurrenceLabel';
import { shiftAssignee } from './shiftPeople';
import { ShiftTaskList } from './ShiftTaskList';
import { rotationPosition } from './shiftRotation';
import { holdsOnlyThisDay,
  formatShiftRange,
  formatShiftRangeViewer,
  formatShiftRepeat,
  formatShiftReminder,
  isShiftOpen,
  isShiftRepeating,
  shiftEnd,
  shiftRootId,
  canCoverShifts,
  hasShiftEnded,
} from './shiftUtils';

/** Titles longer than this step down from the large title size (the approved mock's rule, mobile's too). */

export type ShiftDetailAction = 'take' | 'drop' | 'assign' | 'edit' | 'delete' | 'addTask';

export interface ShiftDetailModalProps {
  circleId: string;
  shift: CalendarEvent;
  timezone: string;
  onClose: () => void;
  /** The page owns the dialogs (never a modal inside a modal); the detail only asks. */
  onAction: (action: ShiftDetailAction, shift: CalendarEvent) => void;
}

/**
 * Shift detail (step 4): name, date, times (dual when zones differ), repeat,
 * who is on it, reminder. Actions by role: Take (open), Drop (the assignee, or
 * an owner / manager), Edit, Assign (owner / manager), Delete (mobile's order).
 * An ENDED shift (recipient zone, naive start + duration) is history: no Take,
 * Drop or Assign (the server answers 409 SHIFT_ENDED), and an unfilled one reads
 * "Not covered". Edit and Delete stay. In progress is not ended.
 */
export function ShiftDetailModal({
  circleId,
  shift,
  timezone,
  onClose,
  onAction,
}: ShiftDetailModalProps): ReactElement {
  const { t, i18n } = useTranslation(['shifts', 'common', 'calendar']);
  const cycle = useHourCycle();
  const { members, canEdit, canManageMembers, viewOnly, isPremiumCircle, isOwner, hasShifts } =
    useCircle(circleId);
  // Lapsed Premium ('readonly'): the detail stays readable, no action is offered.
  const canWrite = canWriteShifts(
    resolveShiftsEntry({ viewOnly, isPremiumCircle, isOwner, hasShifts }),
    canEdit
  );
  const viewerId = useAuthStore((s) => s.user?.id);
  const open = isShiftOpen(shift);
  const assignee = shiftAssignee(shift, members, viewerId);
  const range = formatShiftRange(shift, timezone, cycle);
  const viewerRange = formatShiftRangeViewer(shift, timezone, cycle);
  const end = shiftEnd(shift.scheduled_date, shift.scheduled_time ?? '00:00', shift.duration_minutes ?? 15);
  const ruleSource = useShiftSeriesRoot(circleId, shift);
  const repeat = formatShiftRepeat(ruleSource ?? shift, isShiftRepeating(shift), t, (days) => formatWeekdayList(days, i18n.language));
  // "Day 3 of 14 · back on Sun, Nov 29": a rotation counts from the series ROOT's date (day 1);
  // an off day has no line. The anchor is known only once the root row is (never guessed from the occurrence).
  const rule = ruleSource?.recurrence_rule ?? shift.recurrence_rule;
  const anchor =
    shift.recurrence_anchor_date ||
    ruleSource?.recurrence_anchor_date ||
    (ruleSource && ruleSource.id === shiftRootId(shift) ? ruleSource.scheduled_date : '');
  const rotation = rotationPosition(rule, anchor, shift.scheduled_date);
  const rotationLine = rotation
    ? t('shifts:detail.rotationDay', {
        n: rotation.day,
        on: rotation.on,
        date: formatDateForDisplay(
          rotation.backOn,
          { weekday: 'short', month: 'short', day: 'numeric' },
          i18n.language
        ),
      })
    : '';
  const ended = hasShiftEnded(shift, timezone);
  const canDrop = !open && !ended && canWrite && (assignee?.isYou === true || canManageMembers);
  // Took "Just this one" of a repeating shift: say so, or "Repeats: Daily" + "You" reads as every day.
  const onlyThisDay = holdsOnlyThisDay(shift, ruleSource);
  const whoName = assignee?.isYou ? t('shifts:you') : (assignee?.name ?? '');
  const whoValue = onlyThisDay && whoName ? t('shifts:detail.whoThisDayOnly', { name: whoName }) : whoName;

  // ONE filled button per screen: on an open shift that is Take, so the list fills no Done.
  const showTake = canWrite && open && !ended && canCoverShifts(members, viewerId);
  const whenDate = formatDateForDisplay(shift.scheduled_date, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const whenRange = end.nextDay ? `${range} (${t('shifts:nextDay')})` : range;

  // The status chip IS "who's on it": open / not covered, or the person's avatar + name. It is static
  // text, not a control, so its spoken sentence may say more than the visible words (openChipSpoken).
  const chip = open ? (
    <p data-testid="shift-detail-who" className="m-0 max-w-full">
      {ended ? <span className="sr-only">{`${t('shifts:detail.coveredBy')}, `}</span> : null}
      <span
        data-testid="shift-detail-status"
        aria-hidden={ended ? undefined : 'true'}
        className={
          ended
            ? 'inline-flex rounded-full border border-line px-3 py-1 text-sm font-semibold text-ink-2'
            : 'inline-flex rounded-full border border-moss-line bg-moss-soft px-3 py-1 text-sm font-semibold text-moss'
        }
      >
        {ended ? t('shifts:notCovered') : t('shifts:detail.openChip')}
      </span>
      {ended ? null : <span className="sr-only">{t('shifts:detail.openChipSpoken')}</span>}
    </p>
  ) : (
    <p
      data-testid="shift-detail-who"
      className="m-0 inline-flex max-w-full items-center gap-1.5 rounded-full border border-moss-line bg-moss-soft py-0.5 pl-0.5 pr-3 text-sm font-semibold text-ink"
    >
      <span data-testid="shift-detail-chip-avatar" className="inline-flex shrink-0">
        <Avatar name={assignee?.name || shift.title} size="xs" />
      </span>
      <span className="sr-only">{`${t('shifts:detail.coveredBy')}, `}</span>
      <span data-testid="shift-detail-chip-name" className="min-w-0 truncate">
        {whoValue}
      </span>
    </p>
  );

  // Title + chip on ONE row when they fit; the chip wraps under a title that leaves no room. The visible
  // title is presentational: the dialog's sr-only <h2> (Modal `title`) names it, once.
  const header = (
    <div
      data-testid="shift-detail-header"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5"
    >
      <Text
        variant="sheetTitle"
        as="p"
        aria-hidden="true"
        data-testid="shift-detail-title"
        className="min-w-0"
      >
        {shift.title}
      </Text>
      {chip}
    </div>
  );

  const cellLabel = 'm-0';
  return (
    <Modal
      size="md"
      title={shift.title}
      hideTitle
      header={header}
      closeLabel={t('shifts:close')}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('shifts:close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4" data-testid="shift-detail">
        <Card variant="outlined" padding="none" className="px-4" data-testid="shift-detail-card">
          <dl className="m-0">
            <div className="flex flex-col gap-1 py-3.5">
              <Eyebrow as="dt" className={cellLabel}>
                {t('shifts:detail.when')}
              </Eyebrow>
              <dd data-testid="shift-detail-time" className="m-0 text-base font-medium text-ink tabular-nums">
                <span data-testid="shift-detail-date">{whenDate}</span>
                {` · ${whenRange}`}
              </dd>
              {viewerRange && (
                <dd data-testid="shift-detail-viewer-time" className="m-0 text-sm text-ink-2 tabular-nums">
                  {t('shifts:detail.yourTime', { range: viewerRange })}
                </dd>
              )}
            </div>
          </dl>
          {/* A <dl> of its own: a <dl> may only hold <div> groups of <dt>/<dd>, never a nested grid div. */}
          <dl
            data-testid="shift-detail-card-grid"
            className="m-0 grid grid-cols-2 gap-4 border-t border-line-2 py-3.5"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <Eyebrow as="dt" className={cellLabel}>
                {t('shifts:detail.repeats')}
              </Eyebrow>
              <dd data-testid="shift-detail-repeat" className="m-0 break-words text-base font-medium text-ink">
                {repeat}
              </dd>
              {rotationLine && (
                <dd data-testid="shift-detail-rotation" className="m-0 text-sm text-ink-2">
                  {rotationLine}
                </dd>
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <Eyebrow as="dt" className={cellLabel}>
                {t('shifts:detail.reminder')}
              </Eyebrow>
              <dd data-testid="shift-detail-reminder" className="m-0 break-words text-base font-medium text-ink">
                {formatShiftReminder(shift.reminder_lead_minutes, t)}
              </dd>
            </div>
          </dl>
        </Card>

        <ShiftTaskList
          circleId={circleId}
          shift={shift}
          timezone={timezone}
          members={members}
          viewerId={viewerId}
          canWrite={canWrite}
          ended={ended}
          onAdd={() => onAction('addTask', shift)}
          primaryAllowed={!showTake}
        />

        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {showTake && (
              <Button size="sm" offlineKind="change" onClick={() => onAction('take', shift)}>
                {t('shifts:takeButton')}
              </Button>
            )}
            {canDrop && (
              <Button
                size="sm"
                variant="secondary"
                offlineKind="change"
                onClick={() => onAction('drop', shift)}
              >
                {t('shifts:drop.action')}
              </Button>
            )}
            <Button
              size="sm"
              variant="secondary"
              offlineKind="change"
              onClick={() => onAction('edit', shift)}
            >
              {t('shifts:edit')}
            </Button>
            {canManageMembers && !ended && (
              <Button
                size="sm"
                variant="secondary"
                offlineKind="change"
                onClick={() => onAction('assign', shift)}
              >
                {t('shifts:assign.action')}
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              offlineKind="change"
              onClick={() => onAction('delete', shift)}
            >
              {t('shifts:delete.action')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
