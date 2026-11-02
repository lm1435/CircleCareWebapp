import { useLayoutEffect, useRef, useState, type MouseEvent, type ReactElement } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { isPlainLeftClick, readFromEvent } from '@/lib/stackLoop';
import { useTranslation } from 'react-i18next';
import type { ProviderVisit, VisitNote } from '@/api/providers';
import { Card, Icon, Text } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { formatEventTimeForDisplay, getDateInTimezone, zoneReferenceInstant } from '@/utils/timezone';
import { noteAuthorName, visitCalendarPath, visitEventId } from './visitFormat';

// A note's text is collapsed to ~3 lines with "more" (docs/plans/notes-by-doctor.md
// user flow 2). Whether it NEEDS the control is measured (the clamp only matters
// when the text really overflows), so a short note never grows a dead "more".

const CLAMP_LINES = 'line-clamp-3';

export function VisitNoteItem({
  note,
  timezone,
}: {
  note: VisitNote;
  timezone: string | null;
}): ReactElement {
  const { t, i18n } = useTranslation('emergency');
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  // Measure while clamped; once expanded the clamp is off and the answer is kept.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el || expanded) return;
    const measure = (): void => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [expanded, note.body]);

  const author = noteAuthorName(note.author) || t('providers.visits.unnamedAuthor');
  // A calendar DAY in the care recipient's zone, rendered through the same
  // UTC-noon formatter every naive date uses. Withheld until the zone is known
  // rather than guessed from the viewer's device.
  const when = timezone
    ? formatDateForDisplay(
        getDateInTimezone(timezone, new Date(note.created_at)),
        { month: 'short', day: 'numeric', year: 'numeric' },
        i18n.language
      )
    : null;

  return (
    <li className="m-0 flex list-none flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-moss-deep">{author}</span>
        {when && <span className="shrink-0 text-xs text-ink-3">{when}</span>}
      </div>
      <p
        ref={bodyRef}
        className={`m-0 whitespace-pre-wrap break-words text-base text-ink ${
          expanded ? '' : CLAMP_LINES
        }`}
      >
        {note.body}
      </p>
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="relative z-10 min-h-[44px] self-start bg-transparent p-0 text-sm font-semibold text-moss-deep underline underline-offset-2"
        >
          {expanded ? t('providers.visits.less') : t('providers.visits.more')}
        </button>
      )}
    </li>
  );
}

/**
 * Link behavior for a visit's calendar link: when the page was opened from THIS visit's appointment, the
 * link is Back (history -1) so the appointment <-> visits loop never grows the history stack.
 */
export function useVisitLinkLoop(
  visit: Pick<ProviderVisit, 'id' | 'series_id' | 'is_virtual' | 'scheduled_date'>
): { state: { fromProviderId: string }; onClick: (e: MouseEvent) => void } {
  const location = useLocation();
  const navigate = useNavigate();
  const from = readFromEvent(location.state);
  const sameVisit =
    !!from &&
    from.date === visit.scheduled_date &&
    (from.id === visit.id || from.id === visitEventId(visit));
  const { providerId = '' } = useParams<{ providerId: string }>();
  return {
    state: { fromProviderId: providerId },
    onClick: (e: MouseEvent): void => {
      if (!sameVisit || !isPlainLeftClick(e)) return;
      e.preventDefault();
      navigate(-1);
    },
  };
}

export interface VisitCardProps {
  circleId: string;
  visit: ProviderVisit;
  timezone: string | null;
  /** Edit rights: a view-only member sees "No notes yet" without the Add link. */
  canEdit: boolean;
  /** An upcoming visit leads with weekday and time. */
  upcoming?: boolean;
}

/**
 * One PAST visit: "Oct 2 · Follow-up", its notes inline (author, date, text) or
 * "No notes yet · Add a note". The title opens the appointment; "Add a note"
 * opens it at its notes panel (the existing appointment / note flow).
 */
export function VisitCard({
  circleId,
  visit,
  timezone,
  canEdit,
  upcoming = false,
}: VisitCardProps): ReactElement {
  const { t, i18n } = useTranslation('emergency');
  const hourCycle = useHourCycle();
  const { onClick: backIfCameFromVisit, state: linkState } = useVisitLinkLoop(visit);
  const dateLabel = formatDateForDisplay(
    visit.scheduled_date,
    { month: 'short', day: 'numeric' },
    i18n.language
  );
  const fullDate = formatDateForDisplay(
    visit.scheduled_date,
    { month: 'long', day: 'numeric', year: 'numeric' },
    i18n.language
  );
  const hasNotes = visit.notes.length > 0;
  const when = upcoming
    ? [
        formatDateForDisplay(
          visit.scheduled_date,
          { weekday: 'short', month: 'short', day: 'numeric' },
          i18n.language
        ),
        visit.scheduled_time && timezone
          ? formatEventTimeForDisplay(
              visit.scheduled_time,
              timezone,
              undefined,
              zoneReferenceInstant(visit.scheduled_date),
              hourCycle
            )
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : dateLabel;

  return (
    <Card as="li" variant="outlined" padding="sm" data-testid="provider-visit">
      {/* Heading order (axe heading-order): upcoming cards sit straight under the
          section's h2; past cards sit under a year h3. */}
      <Text variant="h3" as={upcoming ? 'h3' : 'h4'} className="min-w-0 break-words">
        <Link
          to={visitCalendarPath(circleId, visit)}
          state={linkState}
          onClick={backIfCameFromVisit}
          className="text-ink no-underline hover:underline"
        >
          {when} · {visit.title}
        </Link>
      </Text>
      {visit.location && <p className="m-0 mt-0.5 break-words text-sm text-ink-2">{visit.location}</p>}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
        <span className="text-sm text-ink-3">
          {hasNotes
            ? t('providers.visits.noteCount', { count: visit.note_count })
            : t('providers.visits.noNotes')}
        </span>
        {canEdit && (
          <Link
            to={visitCalendarPath(circleId, visit, 'notes')}
            state={linkState}
            aria-label={t('providers.visits.addNoteFor', { date: fullDate })}
            className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss-deep underline underline-offset-2"
          >
            {t('providers.visits.addNote')}
          </Link>
        )}
      </div>
    </Card>
  );
}

/** One note in the Notes section: its visit's date, then the note; the whole card opens that visit. */
export function VisitNoteCard({
  circleId,
  note,
  visit,
  timezone,
}: {
  circleId: string;
  note: VisitNote;
  visit: ProviderVisit;
  timezone: string | null;
}): ReactElement {
  const { t, i18n } = useTranslation('emergency');
  const { onClick, state } = useVisitLinkLoop(visit);
  const date = formatDateForDisplay(
    visit.scheduled_date,
    { month: 'short', day: 'numeric' },
    i18n.language
  );
  return (
    <Card as="li" variant="outlined" padding="sm" className="relative" data-testid="provider-note">
      <Link
        to={visitCalendarPath(circleId, visit)}
        state={state}
        onClick={onClick}
        className="text-xs font-semibold text-ink-3 no-underline after:absolute after:inset-0 after:content-[''] hover:underline"
      >
        {t('providers.visits.noteVisitLabel', { date })}
      </Link>
      <ul className="m-0 mt-1 list-none p-0">
        <VisitNoteItem note={note} timezone={timezone} />
      </ul>
    </Card>
  );
}

/** A section header that is one button: title, count and a chevron; announces expanded/collapsed. */
export function VisitsSectionHeader({
  id,
  title,
  count,
  open,
  onToggle,
}: {
  id: 'upcoming' | 'notes' | 'past';
  title: string;
  count: string;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  return (
    <Text variant="label" as="h2" className="uppercase tracking-wide">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`provider-visits-panel-${id}`}
        onClick={onToggle}
        data-testid={`provider-visits-section-${id}`}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 bg-transparent p-0 text-left uppercase tracking-wide"
      >
        <span>{`${title} (${count})`}</span>
        <Icon name="chevron-down" size="row" className={open ? 'rotate-180' : ''} />
      </button>
    </Text>
  );
}
