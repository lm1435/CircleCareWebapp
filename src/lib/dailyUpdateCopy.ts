import type { TFunction } from 'i18next';
import type { DailyUpdateData, DailyUpdateStillToDoItem } from '@/api/dailyUpdate';
import type { HourCycle } from '@/utils/hourCycle';
import { formatTimeOfDay, getCachedDateTimeFormat, type TimeLanguage } from '@/utils/timezone';

/**
 * Sentence building for the daily update (docs/plans/daily-update.md §2.1, P7).
 * The server sends counts and items; every word on screen comes from the
 * `dailyUpdate` namespace here, so plurals follow each locale's rules.
 *
 * Rules that the tests pin:
 * - A count of 0 is NEVER rendered: the line is omitted (this is also what
 *   keeps pt, where 0 selects `_one`, from ever reading "0 dose tomada").
 * - Skipped is its own line, never folded into taken, never "Taken at".
 * - Nothing says "missed".
 */
export interface DailyUpdateLine {
  /** Stable id for React keys and tests. */
  id: string;
  text: string;
}

type T = TFunction<'dailyUpdate'>;

/**
 * Does `name` begin with an /i/ sound? Spanish writes "e" instead of "y"
 * before one ("Ana e Isabel", "Luis e Hilda"), but keeps "y" before a
 * diphthong spelled hie-/hia- ("Ana y Hielo") and before a consonantal y-.
 * Every locale carries `names.twoBeforeI`; outside Spanish it is identical to
 * `names.two`, so no language branching is needed here.
 */
export function startsWithISound(name: string): boolean {
  const n = name
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (/^hi[aeou]/.test(n)) return false;
  return /^(i|hi)/.test(n);
}

/** "Ana", "Ana and Luis", "Ana, Luis and 2 others", or "a former member". */
export function formatNoteAuthors(
  notes: DailyUpdateData['notes'],
  t: T
): string {
  const authors = notes.authors.filter((a) => a.trim().length > 0);
  const more = Math.max(0, notes.more_authors);
  const two = (a: string, b: string): string =>
    startsWithISound(b) ? t('names.twoBeforeI', { a, b }) : t('names.two', { a, b });

  if (authors.length === 0) return t('names.former');
  if (authors.length === 1) {
    if (more === 0) return authors[0];
    // One resolvable name; the rest could not be named.
    if (more === 1) return two(authors[0], t('names.former'));
    return t('names.many', { a: authors[0], b: t('names.former'), count: more - 1 });
  }
  if (more === 0) return two(authors[0], authors[1]);
  return t('names.many', { a: authors[0], b: authors[1], count: more });
}

/**
 * The count lines of the first section ("Today so far" / "What happened").
 * `past` adds the "N doses not marked" count (today lists those doses under
 * "Still to do" instead) and switches "appointments today" to "appointments
 * that day".
 */
export function buildSummaryLines(data: DailyUpdateData, t: T, past: boolean): DailyUpdateLine[] {
  const lines: DailyUpdateLine[] = [];
  const add = (id: string, count: number, text: () => string): void => {
    if (count > 0) lines.push({ id, text: text() });
  };
  const { doses } = data;
  add('taken', doses.taken, () => t('doses.taken', { count: doses.taken }));
  add('takenLate', doses.taken_late, () => t('doses.takenLate', { count: doses.taken_late }));
  add('skipped', doses.skipped, () => t('doses.skipped', { count: doses.skipped }));
  // Past day only. On TODAY's view a due-but-unmarked dose is listed as an
  // item under "Still to do" ("7:30 PM · Lisinopril · Not marked"); a count
  // here as well would mention the same dose twice.
  if (past) {
    add('notMarked', doses.not_marked, () =>
      t('doses.notMarkedPast', { count: doses.not_marked })
    );
  }
  if (data.as_needed) {
    const given = data.as_needed.given;
    add('asNeeded', given, () => t('asNeeded.given', { count: given }));
  }
  add('tasksDone', data.tasks.done, () => t('tasks.done', { count: data.tasks.done }));
  const appts = data.appointments.past_count;
  add('appointments', appts, () =>
    past ? t('appointments.thatDay', { count: appts }) : t('appointments.today', { count: appts })
  );
  add('notes', data.notes.count, () =>
    t('notes.added', { count: data.notes.count, names: formatNoteAuthors(data.notes, t) })
  );
  return lines;
}

/**
 * An item's time in the reader's 12/24h cycle. The server sends the
 * recipient-local wall time ("HH:MM[:SS]", like `scheduled_time`); an ISO
 * instant is also accepted and rendered in the recipient's zone.
 */
export function formatItemTime(
  time: string | null,
  timezone: string,
  cycle: HourCycle,
  language?: string
): string | null {
  if (!time) return null;
  // The meridiem follows the language the sentence is rendered in (a. m./p. m. in Spanish).
  const lang = language as TimeLanguage | undefined;
  const wall = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(time.trim());
  if (wall) return formatTimeOfDay(Number(wall[1]), Number(wall[2]), cycle, lang);
  const instant = new Date(time);
  if (Number.isNaN(instant.getTime())) return null;
  try {
    // Numeric extraction only (hour12:false + formatToParts), then the
    // canonical formatter renders it — see project hour-cycle architecture.
    const parts = getCachedDateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(instant);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return formatTimeOfDay(h, m, cycle, lang);
  } catch {
    return null;
  }
}

/** One "Still to do" / "Not done that day" row. */
export function formatStillToDoItem(
  item: DailyUpdateStillToDoItem,
  t: T,
  opts: { timezone: string; cycle: HourCycle; past: boolean; language?: string }
): string {
  const time = formatItemTime(item.time, opts.timezone, opts.cycle, opts.language);
  if (item.kind === 'dose') {
    // A scheduled dose always has a time; the bare title is only a safety net.
    if (!time) return item.title;
    return item.status === 'not_marked'
      ? t('item.doseNotMarked', { time, medication: item.title })
      : t('item.doseUpcoming', { time, medication: item.title });
  }
  if (item.kind === 'task') {
    // "Due today" is wrong on a past day's view; the section heading
    // ("Not done that day") already says it.
    return opts.past ? item.title : t('item.task', { title: item.title });
  }
  return time ? t('item.appointment', { time, title: item.title }) : item.title;
}
