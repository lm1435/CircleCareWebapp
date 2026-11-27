import { useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Eyebrow, Sheet } from '@/components/ui';
import { useTasks } from '@/hooks/useTasks';
import { useCareNotes } from '@/hooks/useCareNotes';
import { useCalendarEvents, useEventsPresence } from '@/hooks/useCalendarEvents';
import { TODAY_WINDOW_DAYS } from '@/hooks/useNextUp';
import { addDays } from '@/components/calendar/dateMath';
import { Analytics } from '@/lib/analytics';
import { getDateInTimezone, isEventPastDue } from '@/utils/timezone';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CareNote } from '@/api/careNotes';

// Quick access on Today (docs/plans/simple-ui-1-3-1.md; hi-fi HiToday): the
// six destinations in ONE card, a 2x3 grid (two columns, three rows) with a status line under
// each label (1.4.4: Vitals and Emergency info joined the grid), then quiet text links - Shifts
// (when shown) and Activity.
// Large text (200% zoom / large root font): the grid is one column.
//
// The Daily update row is gone from here on purpose: the update card appears on
// Today in the evening, and the feed keeps its "Daily updates" link.

/**
 * "N refill soon" - ONE definition on both platforms (mobile: utils/todayItems.ts
 * countRefillsSoon). It uses the real refill-tracking data already on the dose rows:
 * a medication (not discontinued, not as-needed) with `track_refills` on whose
 * `quantity_remaining / pills_per_day` is at or under REFILL_SOON_DAYS days of
 * supply, counted once per BOTTLE (`refill_group_id`, else the series, else the row).
 */
export const REFILL_SOON_DAYS = 14;

interface Tile {
  /** Analytics/series id: unchanged from the old rows. */
  /** `vitals` and `careInfo` (Emergency info) keep the ids their quiet links always had. */
  id: 'notes' | 'tasks' | 'calendar' | 'medications' | 'vitals' | 'careInfo';
  segment: string;
}

/** Exported so the order is assertable. Notes, Tasks, Calendar, Meds, Vitals, Emergency info. */
export const QUICK_ACCESS_TILES: readonly Tile[] = [
  { id: 'notes', segment: 'notes' },
  { id: 'tasks', segment: 'tasks' },
  { id: 'calendar', segment: 'calendar' },
  { id: 'medications', segment: 'meds' },
  { id: 'vitals', segment: 'vitals' },
  { id: 'careInfo', segment: 'emergency' },
] as const;

interface QuietLink {
  id: 'shifts' | 'activityFeed';
  segment: string;
  /** Query string for the target, if any. */
  search?: string;
}

const QUIET_LINKS: readonly QuietLink[] = [
  { id: 'shifts', segment: 'calendar', search: '?mode=shifts' },
  { id: 'activityFeed', segment: 'activity' },
];

/** Distinct refill-tracked bottles at or under REFILL_SOON_DAYS of supply. */
export function countRefillSoon(events: readonly CalendarEvent[]): number {
  const bottles = new Set<string>();
  for (const e of events) {
    if (e.event_type !== 'medication' || e.discontinued_at || e.as_needed) continue;
    if (e.track_refills !== true) continue;
    const perDay = Number(e.pills_per_day);
    const left = Number(e.quantity_remaining);
    if (!Number.isFinite(perDay) || perDay <= 0 || !Number.isFinite(left)) continue;
    if (left / perDay <= REFILL_SOON_DAYS) {
      bottles.add(e.refill_group_id ?? e.parent_event_id ?? e.id);
    }
  }
  return bottles.size;
}

/**
 * The Meds tile's status line - ONE rule on both platforms (mobile:
 * utils/todayQuickAccess.ts medicationsStatus). Refills win; "Nothing yet" only
 * when the presence read has ANSWERED that the circle has no medication; any
 * other state (a saved medication, or presence still loading / failed) reads
 * "Schedule and refills", never "nothing".
 */
export function medicationsStatus(
  hasAnyMedication: boolean | undefined,
  refillCount: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (refillCount > 0) return t('quickAccess.medsRefill', { count: refillCount });
  if (hasAnyMedication === false) return t('quickAccess.medsEmpty');
  return t('quickAccess.medsDefault');
}

export function latestNote(notes: readonly CareNote[]): CareNote | null {
  return notes.reduce<CareNote | null>(
    (best, n) => (best === null || n.created_at > best.created_at ? n : best),
    null
  );
}

function agoLabel(iso: string, locale: string, now: number): string {
  const diffMin = Math.round((now - Date.parse(iso)) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  if (!Number.isFinite(diffMin) || diffMin < 1) return rtf.format(0, 'minute');
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  if (diffMin < 60 * 24) return rtf.format(-Math.round(diffMin / 60), 'hour');
  return rtf.format(-Math.round(diffMin / 1440), 'day');
}

export interface QuickAccessProps {
  circleId: string;
  /** Care recipient's IANA zone; the date-based status lines wait for it. */
  timezone: string | null;
  /** The Shifts quiet link is offered only where Shifts exist for the viewer. */
  showShiftsLink: boolean;
  /** Large-text layout: one column. */
  stacked: boolean;
}

export function QuickAccess({
  circleId,
  timezone,
  showShiftsLink,
  stacked,
}: QuickAccessProps): ReactElement {
  const { t, i18n } = useTranslation('overview');
  const base = `/circles/${circleId}`;
  const today = timezone ? getDateInTimezone(timezone) : '';
  const tomorrow = today ? addDays(today, 1) : '';

  // `limit: 1` - only the COUNT is needed; `total` is the pre-limit match count.
  const tasksQuery = useTasks(circleId, { status: 'open', limit: 1 });
  const openTaskCount = tasksQuery.data?.total ?? tasksQuery.data?.tasks.length ?? 0;

  const notesQuery = useCareNotes(circleId);
  const note = useMemo(() => latestNote(notesQuery.data?.notes ?? []), [notesQuery.data]);

  const eventsQuery = useCalendarEvents(
    circleId,
    today,
    today ? addDays(today, TODAY_WINDOW_DAYS) : ''
  );
  const events = eventsQuery.data;
  const nextEvent = useMemo(() => {
    if (!events || !timezone) return null;
    const now = new Date();
    return (
      events
        .filter(
          (e) =>
            e.event_type !== 'medication' &&
            !e.completed_at &&
            !isEventPastDue(e.scheduled_date, e.scheduled_time ?? null, timezone, now)
        )
        .sort((a, b) =>
          a.scheduled_date === b.scheduled_date
            ? (a.scheduled_time ?? '') < (b.scheduled_time ?? '')
              ? -1
              : 1
            : a.scheduled_date < b.scheduled_date
              ? -1
              : 1
        )[0] ?? null
    );
  }, [events, timezone]);
  const refillCount = useMemo(() => countRefillSoon(events ?? []), [events]);
  // "Is there any medication?" uses Home's presence window (today-30 .. today+180, the same
  // query key the next-step card reads, so no extra request). The 7-day events window above
  // only sees refill-tracked doses; a saved medication with no refill tracking (or one whose
  // doses start later) left the tile saying "Nothing yet".
  const presence = useEventsPresence(
    circleId,
    today ? addDays(today, -30) : '',
    today ? addDays(today, 180) : ''
  );

  const dayLabel = (dateStr: string): string => {
    if (dateStr === today) return t('appointments.today');
    if (dateStr === tomorrow) return t('appointments.tomorrow');
    return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(i18n.language, {
      weekday: 'short',
      timeZone: 'UTC',
    });
  };

  const status: Record<Tile['id'], string> = {
    notes: note
      ? t('quickAccess.notesWrote', {
          who: note.author?.first_name || t('quickAccess.someone'),
          ago: agoLabel(note.created_at, i18n.language, Date.now()),
        })
      : t('quickAccess.notesEmpty'),
    tasks:
      openTaskCount > 0 ? t('quickAccess.tasksNote', { count: openTaskCount }) : t('quickAccess.tasksEmpty'),
    calendar: nextEvent
      ? t('quickAccess.calendarNext', { day: dayLabel(nextEvent.scheduled_date) })
      : t('quickAccess.calendarEmpty'),
    medications: medicationsStatus(presence.data?.medication, refillCount, t),
    // Static lines: what is behind the door (mobile's quickAccess.vitalsNote / emergencyNote).
    vitals: t('quickAccess.vitalsNote'),
    careInfo: t('quickAccess.emergencyNote'),
  };

  // Literal keys (no interpolation) so the translation-key audit sees them.
  const tileLabel: Record<Tile['id'], string> = {
    notes: t('quickAccess.notes'),
    tasks: t('quickAccess.tasks'),
    calendar: t('quickAccess.calendar'),
    medications: t('quickAccess.medications'),
    vitals: t('quickAccess.vitals'),
    careInfo: t('quickAccess.healthInfo'),
  };
  const linkLabel: Record<QuietLink['id'], string> = {
    shifts: t('quickAccess.shifts'),
    activityFeed: t('quickAccess.activity'),
  };
  const links = QUIET_LINKS.filter((l) => l.id !== 'shifts' || showShiftsLink);
  const cols = stacked ? 1 : 2;

  return (
    <section aria-labelledby="quick-access-heading">
      <Eyebrow id="quick-access-heading" color="ink-2" className="block mb-3">
        {t('quickAccess.title')}
      </Eyebrow>
      <Sheet
        as="nav"
        padding="none"
        aria-labelledby="quick-access-heading"
        className="overflow-hidden"
        data-testid="quick-access-grid"
        data-columns={cols}
      >
        <div className={stacked ? 'grid grid-cols-1' : 'grid grid-cols-2'}>
          {QUICK_ACCESS_TILES.map((tile, index) => {
            const lastRow = index >= QUICK_ACCESS_TILES.length - cols;
            const rightEdge = (index + 1) % cols === 0;
            return (
              <Link
                key={tile.id}
                to={`${base}/${tile.segment}`}
                onClick={() => Analytics.quickAccessTapped(tile.id)}
                className={[
                  'flex min-h-16 flex-col justify-center gap-0.5 px-[18px] py-3 no-underline transition-colors duration-fast hover:bg-bg-2',
                  lastRow ? '' : 'border-b border-line-2',
                  rightEdge ? '' : 'border-r border-line-2',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {/* 18px at every width: the app's tile label is 18 (bodySemiBold). */}
                <span className="text-base font-semibold text-ink">{tileLabel[tile.id]}</span>
                <span className="break-words text-sm text-ink-2">{status[tile.id]}</span>
              </Link>
            );
          })}
        </div>
      </Sheet>

      <ul className="m-0 mt-2 flex list-none flex-wrap items-center gap-x-1 p-0">
        {links.map((link, i) => (
          <li key={link.id} className="flex items-center">
            {i > 0 ? (
              <span aria-hidden="true" className="text-moss">
                ·
              </span>
            ) : null}
            <Link
              to={`${base}/${link.segment}${link.search ?? ''}`}
              onClick={() => Analytics.quickAccessTapped(link.id)}
              className="inline-flex min-h-11 items-center px-1.5 text-md font-semibold text-moss-deep"
            >
              {linkLabel[link.id]}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default QuickAccess;
