import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProviderVisit, VisitNote } from '@/api/providers';
import { Card, Text } from '@/components/ui';
import { formatDateForDisplay } from '@/components/calendar/dateMath';
import { getDateInTimezone } from '@/utils/timezone';
import { noteAuthorName, visitCalendarPath } from './visitFormat';

// A note's text is collapsed to ~3 lines with "more" (docs/plans/notes-by-doctor.md
// user flow 2). Whether it NEEDS the control is measured (the clamp only matters
// when the text really overflows), so a short note never grows a dead "more".

const CLAMP_LINES = 'line-clamp-3';

function VisitNoteItem({
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
          className="min-h-[44px] self-start bg-transparent p-0 text-sm font-semibold text-moss-deep underline underline-offset-2"
        >
          {expanded ? t('providers.visits.less') : t('providers.visits.more')}
        </button>
      )}
    </li>
  );
}

export interface VisitCardProps {
  circleId: string;
  visit: ProviderVisit;
  timezone: string | null;
  /** Edit rights: a view-only member sees "No notes yet" without the Add link. */
  canEdit: boolean;
}

/**
 * One PAST visit: "Oct 2 · Follow-up", its notes inline (author, date, text) or
 * "No notes yet · Add a note". The title opens the appointment; "Add a note"
 * opens it at its notes panel (the existing appointment / note flow).
 */
export function VisitCard({ circleId, visit, timezone, canEdit }: VisitCardProps): ReactElement {
  const { t, i18n } = useTranslation('emergency');
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

  return (
    <Card as="li" variant="outlined" padding="sm" data-testid="provider-visit">
      <div className="flex items-baseline justify-between gap-3">
        <Text variant="h3" as="h4" className="min-w-0 break-words">
          <Link
            to={visitCalendarPath(circleId, visit)}
            className="text-ink no-underline hover:underline"
          >
            {dateLabel} · {visit.title}
          </Link>
        </Text>
        {hasNotes && (
          <span className="shrink-0 text-sm text-ink-3">
            {t('providers.visits.noteCount', { count: visit.note_count })}
          </span>
        )}
      </div>
      {hasNotes ? (
        <ul className="m-0 mt-2.5 flex list-none flex-col gap-3 p-0">
          {visit.notes.map((note) => (
            <VisitNoteItem key={note.id} note={note} timezone={timezone} />
          ))}
        </ul>
      ) : (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
          <span className="text-sm text-ink-3">{t('providers.visits.noNotes')}</span>
          {canEdit && (
            <Link
              to={visitCalendarPath(circleId, visit, 'notes')}
              aria-label={t('providers.visits.addNoteFor', { date: fullDate })}
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss-deep underline underline-offset-2"
            >
              {t('providers.visits.addNote')}
            </Link>
          )}
        </div>
      )}
    </Card>
  );
}
