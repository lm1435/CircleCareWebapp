import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DailyUpdateData } from '@/api/dailyUpdate';
import { Eyebrow, Icon, Sheet } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import { buildDetailLine, buildLead, formatItemTime, noteFromLine } from '@/lib/dailyUpdateCopy';
import {
  appointmentTarget,
  dailyUpdatePagePath,
  noteTarget,
  tasksRowTarget,
} from '@/lib/dailyUpdateLinks';

export interface DailyUpdateCardViewProps {
  data: DailyUpdateData;
  circleId: string;
  /** `id` of the heading, for the region's `aria-labelledby`. */
  headingId: string;
  /** `/circles/:id/members` — rendered only for a solo owner. */
  inviteTo: string | null;
  onDismiss: () => void;
  onInvite?: () => void;
  /** A content row was clicked (`daily_update_row_tapped`); the invite row uses `onInvite`. */
  onRowTap?: (row: DailyUpdateCardRowKind) => void;
}

export type DailyUpdateCardRowKind = 'tasks' | 'appointment' | 'note' | 'full_update';

/** Marks a navigation as coming from the card (daily_update_opened source). */
const FROM_CARD = { dailyUpdateSource: 'card' } as const;

/**
 * One short row: a title, an optional quiet second line, a chevron. A row
 * with no target (the item no longer exists) is plain text with no chevron.
 */
function CardRow({
  to,
  title,
  sub,
  strong = false,
  onClick,
  testId,
}: {
  to: string | null;
  title: string;
  sub?: string | null;
  strong?: boolean;
  onClick?: () => void;
  testId?: string;
}): ReactElement {
  const body = (
    <span className="min-w-0 flex-1">
      <span
        className={`block text-md leading-6 ${strong ? 'font-semibold text-moss-deep' : 'text-ink'}`}
      >
        {title}
      </span>
      {sub ? <span className="block truncate text-sm leading-5 text-ink-2">{sub}</span> : null}
    </span>
  );
  return (
    <li className="border-t border-line-2" data-testid={testId}>
      {to ? (
        <Link
          to={to}
          state={FROM_CARD}
          onClick={onClick}
          className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-1.5 no-underline transition-colors duration-fast hover:bg-bg"
        >
          {body}
          <Icon
            name="chevron-forward"
            size="inline"
            className={strong ? 'text-moss-deep' : 'text-ink-3'}
          />
        </Link>
      ) : (
        <div className="flex min-h-11 items-center py-1.5">{body}</div>
      )}
    </li>
  );
}

/**
 * The Home card, design v2 "B2" (docs/plans/daily-update.md). A white Sheet
 * like Home's other cards: eyebrow "This evening", the code-built sentence as
 * its heading, one muted line of clauses, then rows only for what happened —
 * tasks done, the first appointment, the first note — and always "See the
 * full update". No dose list: Home's Medications card right below is that.
 *
 * Pure presentation: `DailyUpdateCard` decides whether it shows and wires
 * storage, preferences and analytics. Split so the e2e harness can mount the
 * exact production markup on fixture data.
 */
export function DailyUpdateCardView({
  data,
  circleId,
  headingId,
  inviteTo,
  onDismiss,
  onInvite,
  onRowTap,
}: DailyUpdateCardViewProps): ReactElement {
  const { t, i18n } = useTranslation('dailyUpdate');
  const cycle = useHourCycle();
  const lead = buildLead(data, t, false);
  const detail = buildDetailLine(data, t, i18n.language);
  const time = (v: string | null): string | null =>
    formatItemTime(v, data.timezone, cycle, i18n.language);

  const tasks = data.tasks_done_detail ?? [];
  const appointment = data.appointments_detail?.[0] ?? null;
  const note = data.notes_detail?.[0] ?? null;

  return (
    <Sheet
      as="section"
      padding="none"
      aria-labelledby={headingId}
      data-testid="daily-update-card"
      className="px-5 pt-4 pb-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 pt-1">
          <Eyebrow color="ink-3">{t('card.eyebrow')}</Eyebrow>
          <h2 id={headingId} className="m-0 mt-1 text-base font-semibold leading-7 text-ink">
            {lead}
          </h2>
        </div>
        <button
          type="button"
          aria-label={t('dismissA11y')}
          onClick={onDismiss}
          className="-mr-3 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors duration-fast hover:bg-bg-2 hover:text-ink"
        >
          <Icon name="close-outline" size="chrome" />
        </button>
      </div>
      {detail ? <p className="m-0 mt-1 text-md leading-6 text-ink-2">{detail}</p> : null}

      <ul className="m-0 mt-3 list-none p-0">
        {data.tasks.done > 0 ? (
          <CardRow
            testId="daily-update-card-tasks"
            to={tasksRowTarget(circleId, data)}
            onClick={() => onRowTap?.('tasks')}
            title={t('tasks.done', { count: data.tasks.done })}
            sub={tasks.length > 0 ? tasks.map((x) => x.title).join(', ') : null}
          />
        ) : null}
        {appointment ? (
          <CardRow
            testId="daily-update-card-appointment"
            to={appointmentTarget(circleId, data.date, appointment)}
            onClick={() => onRowTap?.('appointment')}
            title={appointment.title}
            sub={time(appointment.time)}
          />
        ) : null}
        {note ? (
          <CardRow
            testId="daily-update-card-note"
            to={noteTarget(circleId, data.date, note)}
            onClick={() => onRowTap?.('note')}
            title={noteFromLine(note.author_name, t)}
            sub={note.excerpt}
          />
        ) : null}
        <CardRow
          to={dailyUpdatePagePath(circleId, null)}
          title={t('open')}
          strong
          onClick={() => onRowTap?.('full_update')}
        />
        {inviteTo ? <CardRow to={inviteTo} title={t('soloInvite')} onClick={onInvite} /> : null}
      </ul>
    </Sheet>
  );
}
