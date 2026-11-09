import { useId, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { Avatar, Button, Card } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import { shiftAssignee } from './shiftPeople';
import { buildShiftList } from './shiftTasks';
import {
  formatShiftRange,
  formatShiftRangeParts,
  formatShiftRangeViewer,
  hasShiftEnded,
  isShiftOpen,
} from './shiftUtils';

export interface ShiftCardProps {
  shift: CalendarEvent;
  timezone: string;
  members: readonly CircleMember[];
  viewerId: string | null | undefined;
  /** Opens the Shift detail. */
  onOpen: (shift: CalendarEvent) => void;
  /**
   * Present only for someone who may take (edit rights); an open card then shows Take,
   * unless the shift has ENDED (recipient zone): then it reads "Not covered", no Take.
   */
  onTake?: (shift: CalendarEvent) => void;
  /**
   * The non-shift events around this card's day (the Shifts view loads them for its range). The
   * "3 tasks · 1 done" chip counts the same tasks the detail's list holds; hidden at 0 and while
   * they have not loaded.
   */
  events?: readonly CalendarEvent[];
}

/**
 * One shift (docs/plans/care-shifts.md, step 2). FILLED = moss family, solid
 * border, the assignee's small avatar on the status line. OPEN = the same white card
 * (Owner 2026-10-23: no amber, no dashed edge): "Open" in moss on the status line and a
 * Take outline button. Open is conveyed by TEXT (the word and the accessible name),
 * never by colour alone.
 *
 * The card body and Take are SIBLING controls (no button inside a button).
 */
export function ShiftCard({
  shift,
  timezone,
  members,
  viewerId,
  onOpen,
  onTake,
  events,
}: ShiftCardProps): ReactElement {
  const { t } = useTranslation('shifts');
  const cycle = useHourCycle();
  const open = isShiftOpen(shift);
  // Unfilled and already over (owner report, 1.4.0): "Not covered", nothing left to take.
  const unfilledEnded = open && hasShiftEnded(shift, timezone);
  const assignee = shiftAssignee(shift, members, viewerId);
  const range = formatShiftRange(shift, timezone, cycle);
  const viewerRange = formatShiftRangeViewer(shift, timezone, cycle);
  const parts = formatShiftRangeParts(shift, timezone, cycle);
  const who = assignee ? (assignee.isYou ? t('you') : assignee.name || t('someone')) : '';
  const hintId = useId();
  const list = events ? buildShiftList(shift, events) : null;
  const taskCount = list?.taskTotal ?? 0;
  const taskDone = list?.taskDone ?? 0;
  // "{{name}}, {{start}} to {{end}}[, next day], open" / ", {{who}} is on it". The
  // action lives in the description, never in the label.
  const status = unfilledEnded
    ? t('card.statusNotCovered')
    : open
    ? t('card.statusOpen')
    : assignee?.isYou
      ? t('card.statusMine')
      : t('card.statusCovered', { name: who });
  const ariaLabel = [
    shift.title,
    t('rangeSpoken', { start: parts.start, end: parts.end }),
    parts.nextDay ? t('nextDay') : '',
    status,
    taskCount > 0 ? t('tasks.card.progress', { total: taskCount, done: taskDone }) : '',
  ]
    .filter(Boolean)
    .join(', ');

  const common = 'm-0 flex list-none items-center gap-3 rounded-lg p-3';
  const progress = taskCount > 0 ? t('tasks.card.progress', { total: taskCount, done: taskDone }) : '';
  // Approved mock 2026-11-08 (mobile ShiftCard): the title (wraps, never truncated), the range alone ("(next
  // day)" inline), then ONE status line: "Open · 0 of 3 done" or a small avatar + the name (which truncates)
  // · "1 of 1 done"; "Your time" only when the viewer's zone differs. Take is an outline Button sm: the list's
  // one filled button is Add shift.
  const content = (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-describedby={hintId}
        onClick={() => onOpen(shift)}
        className="flex min-h-[56px] min-w-0 flex-1 flex-col items-stretch justify-center gap-0.5 text-left"
      >
        <span className="break-words text-sm font-semibold text-ink" data-testid="shift-card-title">
          {shift.title}
        </span>
        <span className="text-xs text-ink-2 tabular-nums" data-testid="shift-card-range">
          {range}
          {parts.nextDay ? ` (${t('nextDay')})` : ''}
        </span>
        {/* No row gap: the count carries its own " · ", so a gap put a wide space before the dot and one after
            it ("Open   · 0 of 2 done", owner TestFlight 1.4.1 (5)). The avatar keeps its 6px off the name. */}
        <span className="flex min-w-0 items-center text-xs text-ink-2" data-testid="shift-card-status">
          {open ? (
            <span
              data-testid="shift-open-word"
              className={`shrink-0 font-semibold ${unfilledEnded ? 'text-ink-2' : 'text-moss'}`}
            >
              {unfilledEnded ? t('notCovered') : t('open')}
            </span>
          ) : (
            <>
              <Avatar name={assignee?.name || shift.title} size="xs" className="mr-1.5 h-5! w-5!" />
              <span className="min-w-0 truncate" data-testid="shift-card-assignee">
                {who}
              </span>
            </>
          )}
          {progress && (
            <span className="shrink-0 whitespace-pre tabular-nums" data-testid="shift-card-task-count">
              {` · ${progress}`}
            </span>
          )}
        </span>
        {viewerRange && (
          <span className="text-xs text-ink-3 tabular-nums">{t('detail.yourTime', { range: viewerRange })}</span>
        )}
        <span id={hintId} className="sr-only">
          {t('card.openDetailsHint')}
        </span>
      </button>
      {open && !unfilledEnded && onTake && (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          aria-label={t('takeAria', { name: shift.title })}
          offlineKind="change"
          onClick={() => onTake(shift)}
        >
          {t('takeButton')}
        </Button>
      )}
    </>
  );

  // Open = the same white card as a filled one (<Card>, hairStrong edge via `border-line!`).
  return open ? (
    <Card
      as="li"
      variant="outlined"
      padding="none"
      data-testid="shift-card"
      data-shift-state="open"
      className={`${common} border-line!`}
    >
      {content}
    </Card>
  ) : (
    // The moss-soft wash means "YOURS", as on mobile (cardMine vs cardFilled):
    // someone else's shift is a cream card with a moss hairline. Washing every
    // covered card drowned the week in green (owner 2026-10-25).
    <li
      data-testid="shift-card"
      data-shift-state="filled"
      className={`${common} border ${
        assignee?.isYou ? 'border-moss bg-moss-soft' : 'border-moss-line bg-cream'
      }`}
    >
      {content}
    </li>
  );
}
