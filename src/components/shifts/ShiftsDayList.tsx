import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { Button, Card, EmptyState, Icon } from '@/components/ui';
import { ShiftCard } from './ShiftCard';
import { shiftsOnDay } from './shiftUtils';

export interface ShiftsDayListProps {
  date: string;
  shifts: readonly CalendarEvent[];
  timezone: string;
  members: readonly CircleMember[];
  viewerId: string | null | undefined;
  onOpen: (shift: CalendarEvent) => void;
  onTake?: (shift: CalendarEvent) => void;
  /** Present only for editors: shows "Add shift". */
  onAdd?: () => void;
}

/** The Shifts view's Day body: cards by start time, then "+ Add shift". */
export function ShiftsDayList({
  date,
  shifts,
  timezone,
  members,
  viewerId,
  onOpen,
  onTake,
  onAdd,
}: ShiftsDayListProps): ReactElement {
  const { t } = useTranslation('shifts');
  const day = shiftsOnDay(shifts, date);
  return (
    <div data-testid="shifts-day-list" className="flex flex-col gap-3">
      {day.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {day.map((shift) => (
            <ShiftCard
              key={`${shift.id}_${shift.scheduled_date}`}
              shift={shift}
              timezone={timezone}
              members={members}
              viewerId={viewerId}
              onOpen={onOpen}
              onTake={onTake}
            />
          ))}
        </ul>
      ) : (
        <Card variant="outlined" padding="lg">
          <EmptyState
            tone="moss"
            icon={<Icon name="calendar-outline" size={26} />}
            title={t('noShiftsDay')}
          >
            {onAdd && (
              <Button onClick={onAdd} offlineKind="change">
                {t('addShift')}
              </Button>
            )}
          </EmptyState>
        </Card>
      )}
      {day.length > 0 && onAdd && (
        <div>
          <Button variant="secondary" onClick={onAdd} offlineKind="change">
            {t('addShift')}
          </Button>
        </div>
      )}
    </div>
  );
}
