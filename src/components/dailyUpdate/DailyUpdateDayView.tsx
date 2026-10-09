import type { ReactElement, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { DailyUpdateData, DailyUpdateStillToDoItem } from '@/api/dailyUpdate';
import { Icon, Sheet } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import {
  buildGlance,
  buildLead,
  doseStatusLine,
  formatItemTime,
  noteAuthorTitle,
  taskDoneLine,
} from '@/lib/dailyUpdateCopy';
import { appointmentTarget, doseTarget, noteTarget, taskTarget } from '@/lib/dailyUpdateLinks';
import { formatDailyUpdateShortDate } from '@/lib/dailyUpdateWindow';

/** Section anchors (the card's "2 tasks done" row opens `#tasks`). */
export const DAILY_UPDATE_SECTION_IDS = {
  still: 'still-to-do',
  medications: 'medications',
  tasks: 'tasks',
  appointments: 'appointments',
  notes: 'notes',
} as const;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <Sheet
      as="section"
      id={id}
      padding="none"
      aria-labelledby={`${id}-heading`}
      className="mt-3 scroll-mt-4 px-5 pt-4 pb-2"
    >
      {/* tabIndex -1: the `#tasks` arrival moves focus here, not just the scroll. */}
      <h2
        id={`${id}-heading`}
        tabIndex={-1}
        className="m-0 text-md font-medium leading-6 text-ink-2 focus:outline-none"
      >
        {title}
      </h2>
      <ul className="m-0 list-none p-0">{children}</ul>
    </Sheet>
  );
}

/**
 * One item: a time column, the title, an optional second line. Tappable rows
 * (an existing detail target) carry a chevron; the rest are plain text.
 */
function Row({
  time,
  title,
  sub,
  to,
  clampSub = 0,
  muted = false,
}: {
  time: string | null;
  title: string;
  sub?: string | null;
  to?: string | null;
  clampSub?: 0 | 3;
  muted?: boolean;
}): ReactElement {
  const inner = (
    <>
      <span className="w-[76px] shrink-0 text-sm leading-6 text-ink-3 tabular-nums">
        {time ?? <span aria-hidden="true">—</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-md leading-6 ${muted ? 'text-ink-2' : 'text-ink'}`}>
          {title}
        </span>
        {sub ? (
          <span
            className={`text-sm leading-5 text-ink-2 ${clampSub === 3 ? 'line-clamp-3' : 'block'}`}
          >
            {sub}
          </span>
        ) : null}
      </span>
    </>
  );
  return (
    <li>
      {to ? (
        <Link
          to={to}
          className="-mx-2 flex min-h-11 items-start gap-3 rounded-md px-2 py-[7px] no-underline transition-colors duration-fast hover:bg-bg"
        >
          {inner}
          <Icon name="chevron-forward" size="inline" className="mt-1 shrink-0 text-ink-3" />
        </Link>
      ) : (
        <div className="flex gap-3 py-[7px]">{inner}</div>
      )}
    </li>
  );
}

export interface DailyUpdateDayArrowsProps {
  circleId: string;
  prev: string | null;
  next: string | null;
  /** The shown date is the recipient's today: the right end reads "Today". */
  isToday: boolean;
}

/** "‹ Wed, Oct 7" … "Today" / "Thu, Oct 9 ›" — an arrow is absent at the range edge. */
export function DailyUpdateDayArrows({
  circleId,
  prev,
  next,
  isToday,
}: DailyUpdateDayArrowsProps): ReactElement {
  const { t, i18n } = useTranslation('dailyUpdate');
  const link =
    'inline-flex min-h-11 items-center gap-1 text-md font-medium text-moss-deep no-underline hover:underline underline-offset-2';
  const prevLabel = prev ? formatDailyUpdateShortDate(prev, i18n.language) : null;
  const nextLabel = next ? formatDailyUpdateShortDate(next, i18n.language) : null;
  return (
    <nav aria-label={t('page.navLabel')} className="flex items-center justify-between gap-3">
      {prev && prevLabel ? (
        <Link
          to={`/circles/${circleId}/daily-update/${prev}`}
          aria-label={t('page.prevA11y', { date: prevLabel })}
          className={link}
          data-testid="daily-update-prev"
        >
          <Icon name="chevron-back" size="inline" />
          {prevLabel}
        </Link>
      ) : (
        <span />
      )}
      {isToday ? (
        <span className="inline-flex min-h-11 items-center text-md text-ink-2">{t('page.today')}</span>
      ) : next && nextLabel ? (
        <Link
          to={`/circles/${circleId}/daily-update/${next}`}
          aria-label={t('page.nextA11y', { date: nextLabel })}
          className={link}
          data-testid="daily-update-next"
        >
          {nextLabel}
          <Icon name="chevron-forward" size="inline" />
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function stillToDoSub(item: DailyUpdateStillToDoItem, t: TFunction<'dailyUpdate'>): string {
  if (item.kind === 'task') return t('status.openTask');
  if (item.status === 'not_marked') return t('status.notMarked');
  return t('status.upcoming');
}

export interface DailyUpdateDayViewProps {
  data: DailyUpdateData;
  circleId: string;
  /** A finished day (not the recipient's today). */
  past: boolean;
}

/**
 * The full page's body, design v2 "B2": the sentence, one plain summary line,
 * then one white section card each for Still to do (today only, first),
 * Medications, Tasks, Appointments and Notes. Empty sections are left out; an
 * older backend without item detail shows the sentence, the line and Still to
 * do only.
 */
export function DailyUpdateDayView({ data, circleId, past }: DailyUpdateDayViewProps): ReactElement {
  const { t, i18n } = useTranslation('dailyUpdate');
  const cycle = useHourCycle();
  const time = (v: string | null): string | null =>
    formatItemTime(v, data.timezone, cycle, i18n.language);

  const lead = buildLead(data, t, past);
  const glance = buildGlance(data, t, past);
  const ids = DAILY_UPDATE_SECTION_IDS;

  const still = past ? [] : data.still_to_do ?? [];
  // Today, an upcoming or unmarked dose is listed under Still to do; listing
  // it under Medications as well would mention the same dose twice.
  const doses = (data.doses_detail ?? []).filter(
    (d) => past || (d.status !== 'upcoming' && d.status !== 'not_marked')
  );
  const tasks = data.tasks_done_detail ?? [];
  const appointments = data.appointments_detail ?? [];
  const notes = data.notes_detail ?? [];

  return (
    <div data-testid="daily-update-day">
      <p className="m-0 text-lg font-semibold leading-8 text-ink" data-testid="daily-update-lead">
        {lead}
      </p>
      {glance ? (
        <p className="m-0 mt-2 text-md leading-6 text-ink-2" data-testid="daily-update-glance">
          {glance}
        </p>
      ) : null}

      <div className="mt-3">
        {still.length > 0 ? (
          <Section id={ids.still} title={t('sections.stillToDo')}>
            {still.map((item, i) => (
              <Row
                key={`${item.kind}:${item.id}:${i}`}
                time={time(item.time)}
                title={item.title}
                sub={stillToDoSub(item, t)}
                muted={item.kind === 'dose' && item.status === 'upcoming'}
              />
            ))}
            {data.still_to_do_more > 0 ? (
              <li className="py-[7px] pl-[88px] text-sm leading-5 text-ink-2">
                {t('item.more', { count: data.still_to_do_more })}
              </li>
            ) : null}
          </Section>
        ) : null}

        {doses.length > 0 ? (
          <Section id={ids.medications} title={t('sections.medications')}>
            {doses.map((d, i) => (
              <Row
                key={`${d.event_id}:${d.time ?? ''}:${i}`}
                time={time(d.time)}
                title={d.medication_name}
                sub={doseStatusLine(d, t, time)}
                to={doseTarget(circleId, d)}
              />
            ))}
          </Section>
        ) : null}

        {tasks.length > 0 ? (
          <Section id={ids.tasks} title={t('sections.tasks')}>
            {tasks.map((task, i) => (
              <Row
                key={`${task.event_id ?? 'task'}:${i}`}
                time={time(task.completed_at)}
                title={task.title}
                sub={taskDoneLine(task.completed_by_name, t)}
                to={taskTarget(circleId, task)}
              />
            ))}
          </Section>
        ) : null}

        {appointments.length > 0 ? (
          <Section id={ids.appointments} title={t('sections.appointments')}>
            {appointments.map((a, i) => (
              <Row
                key={`${a.event_id ?? 'appt'}:${i}`}
                time={time(a.time)}
                title={a.title}
                sub={a.location}
                to={appointmentTarget(circleId, data.date, a)}
              />
            ))}
          </Section>
        ) : null}

        {notes.length > 0 ? (
          <Section id={ids.notes} title={t('sections.notes')}>
            {notes.map((n) => (
              <Row
                key={n.note_id}
                time={time(n.created_at)}
                title={noteAuthorTitle(n.author_name, t)}
                sub={n.excerpt}
                clampSub={3}
                to={noteTarget(circleId, data.date, n)}
              />
            ))}
          </Section>
        ) : null}
      </div>
    </div>
  );
}
