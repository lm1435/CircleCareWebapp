import { useId, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { Avatar, Button, Card, Icon } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import { shiftAssignee } from './shiftPeople';
import {
  formatShiftRange,
  formatShiftRangeParts,
  formatShiftRangeViewer,
  isShiftOpen,
} from './shiftUtils';

export interface ShiftCardProps {
  shift: CalendarEvent;
  timezone: string;
  members: readonly CircleMember[];
  viewerId: string | null | undefined;
  /** Opens the Shift detail. */
  onOpen: (shift: CalendarEvent) => void;
  /** Present only for someone who may take (edit rights); an open card then shows Take. */
  onTake?: (shift: CalendarEvent) => void;
}

/**
 * One shift (docs/plans/care-shifts.md, step 2). FILLED = moss family, solid
 * border, the assignee's avatar. OPEN = the same white card (Owner 2026-10-23: no
 * amber, no dashed edge): a thin hairline avatar ring with a person-add glyph,
 * "Open" in moss on the meta line, and a Take button. Open is conveyed by TEXT
 * (the word and the accessible name), never by colour alone.
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
}: ShiftCardProps): ReactElement {
  const { t } = useTranslation('shifts');
  const cycle = useHourCycle();
  const open = isShiftOpen(shift);
  const assignee = shiftAssignee(shift, members, viewerId);
  const range = formatShiftRange(shift, timezone, cycle);
  const viewerRange = formatShiftRangeViewer(shift, timezone, cycle);
  const parts = formatShiftRangeParts(shift, timezone, cycle);
  const who = assignee ? (assignee.isYou ? t('you') : assignee.name || t('someone')) : '';
  const hintId = useId();
  // "{{name}}, {{start}} to {{end}}[, next day], open" / ", {{who}} is on it". The
  // action lives in the description, never in the label.
  const status = open
    ? t('card.statusOpen')
    : assignee?.isYou
      ? t('card.statusMine')
      : t('card.statusCovered', { name: who });
  const ariaLabel = [
    shift.title,
    t('rangeSpoken', { start: parts.start, end: parts.end }),
    parts.nextDay ? t('nextDay') : '',
    status,
  ]
    .filter(Boolean)
    .join(', ');

  const common = 'm-0 flex list-none items-center gap-3 rounded-lg p-3';
  const content = (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-describedby={hintId}
        onClick={() => onOpen(shift)}
        className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 text-left"
      >
        {open ? (
          <span
            aria-hidden="true"
            data-testid="shift-open-ring"
            // card-shell-ok: the empty avatar ring (a circle), not a card
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-[1.5px] border-line bg-bg text-ink-3"
          >
            <Icon name="person-add-outline" size="inline" />
          </span>
        ) : (
          <Avatar name={assignee?.name || shift.title} size="sm" />
        )}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="break-words text-sm font-semibold text-ink">{shift.title}</span>
          <span className="text-xs text-ink-2">
            {range}
            {parts.nextDay ? ` · ${t('nextDay')}` : ''}
            {!open && who ? ` · ${who}` : ''}
            {open && (
              <>
                {' · '}
                <span data-testid="shift-open-word" className="font-semibold text-moss">
                  {t('open')}
                </span>
              </>
            )}
          </span>
          {viewerRange && (
            <span className="text-xs text-ink-3">{t('detail.yourTime', { range: viewerRange })}</span>
          )}
        </span>
        <span id={hintId} className="sr-only">
          {t('card.openDetailsHint')}
        </span>
      </button>
      {open && onTake && (
        <Button
          size="sm"
          variant="primary"
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
    <li
      data-testid="shift-card"
      data-shift-state="filled"
      className={`${common} border border-moss-line bg-moss-soft`}
    >
      {content}
    </li>
  );
}
