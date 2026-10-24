import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Avatar, Button, Modal } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { canWriteShifts, resolveShiftsEntry } from '@/lib/shiftsAccess';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useShiftSeriesRoot } from '@/hooks/useShifts';
import { useAuthStore } from '@/store/authStore';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { formatWeekdayList } from '@/components/calendar/recurrenceLabel';
import { shiftAssignee } from './shiftPeople';
import {
  formatShiftRange,
  formatShiftRangeViewer,
  formatShiftRepeat,
  formatShiftReminder,
  isShiftOpen,
  isShiftRepeating,
  shiftEnd,
} from './shiftUtils';

export type ShiftDetailAction = 'take' | 'drop' | 'assign' | 'edit' | 'delete';

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
 */
export function ShiftDetailModal({
  circleId,
  shift,
  timezone,
  onClose,
  onAction,
}: ShiftDetailModalProps): ReactElement {
  const { t, i18n } = useTranslation(['shifts', 'common']);
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
  const canDrop = !open && canWrite && (assignee?.isYou === true || canManageMembers);

  const row = (label: string, value: string, testId: string): ReactElement => (
    <div className="flex flex-col gap-0.5 border-t border-line-2 py-3 first:border-t-0">
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd data-testid={testId} className="m-0 text-base text-ink">
        {value}
      </dd>
    </div>
  );

  return (
    <Modal
      size="md"
      title={shift.title}
      closeLabel={t('shifts:close')}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t('shifts:close')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4" data-testid="shift-detail">
        <div className="flex items-center gap-3">
          {open ? (
            <>
              <span
                aria-hidden="true"
                // card-shell-ok: the empty avatar ring (a circle), not a card
                className="inline-flex h-12 w-12 shrink-0 rounded-full border-[1.5px] border-line bg-bg"
              />
              <span className="rounded-full bg-moss-soft px-3 py-1 text-sm font-semibold text-moss">
                {t('shifts:open')}
              </span>
            </>
          ) : (
            <>
              <Avatar name={assignee?.name || shift.title} size="md" />
              <span className="text-base font-semibold text-ink">
                {assignee?.isYou ? t('shifts:you') : assignee?.name}
              </span>
            </>
          )}
        </div>

        <dl className="m-0">
          {row(
            t('shifts:detail.date'),
            formatDateForDisplay(shift.scheduled_date, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            }),
            'shift-detail-date'
          )}
          {row(
            t('shifts:detail.time'),
            end.nextDay ? `${range} (${t('shifts:nextDay')})` : range,
            'shift-detail-time'
          )}
          {viewerRange &&
            row(t('shifts:detail.yourTimeRow'), viewerRange, 'shift-detail-viewer-time')}
          {row(t('shifts:detail.repeats'), repeat, 'shift-detail-repeat')}
          {row(
            t('shifts:detail.coveredBy'),
            open
              ? t('shifts:detail.openValue')
              : assignee?.isYou
                ? t('shifts:you')
                : (assignee?.name ?? ''),
            'shift-detail-who'
          )}
          {row(
            t('shifts:detail.reminder'),
            formatShiftReminder(shift.reminder_lead_minutes, t),
            'shift-detail-reminder'
          )}
        </dl>

        {canWrite && (
          <div className="flex flex-wrap gap-2">
            {open && (
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
            {canManageMembers && (
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
