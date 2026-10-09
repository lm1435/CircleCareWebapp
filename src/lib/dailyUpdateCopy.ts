import type { TFunction } from 'i18next';
import type { DailyUpdateData, DailyUpdateDoseDetail } from '@/api/dailyUpdate';
import type { HourCycle } from '@/utils/hourCycle';
import { formatTimeOfDay, getCachedDateTimeFormat, type TimeLanguage } from '@/utils/timezone';

/**
 * Sentence building for the daily update, design v2 "B2"
 * (docs/plans/daily-update.md, "Design v2 B2"; prototype
 * e2e/harness/dailyUpdateDirections.tsx `buildSummary()` / `clausesOf()`).
 * Built by code from the server's COUNTS, never by a model; every word comes
 * from the `dailyUpdate` namespace so plurals follow each locale's rules.
 *
 * Rules the tests pin:
 * - A zero count is never rendered (also keeps pt, where 0 selects `_one`,
 *   from ever reading "0 dose tomada").
 * - Skipped is its own clause, never folded into taken, never "Taken at".
 * - Nothing says "missed".
 */
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

// ---------------------------------------------------------------------------
// B2: counts → lead sentence, detail clauses, page glance line.
// Same keys, order and fallbacks as mobile `src/utils/dailyUpdate.ts`, so the
// two platforms say exactly the same thing.
// ---------------------------------------------------------------------------

export interface DailyUpdateCounts {
  taken: number;
  late: number;
  skipped: number;
  notMarked: number;
  upcoming: number;
  given: number;
  tasksDone: number;
  appointments: number;
  notes: number;
  /** Resolvable note authors (first names), in first-note order. */
  authors: string[];
  /** Further distinct authors, including ones whose name could not be resolved. */
  moreAuthors: number;
}

const n0 = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

export function countsOf(data: DailyUpdateData): DailyUpdateCounts {
  return {
    taken: n0(data.doses?.taken),
    late: n0(data.doses?.taken_late),
    skipped: n0(data.doses?.skipped),
    notMarked: n0(data.doses?.not_marked),
    upcoming: n0(data.doses?.upcoming),
    given: data.as_needed ? n0(data.as_needed.given) : 0,
    tasksDone: n0(data.tasks?.done),
    appointments: n0(data.appointments?.past_count),
    notes: n0(data.notes?.count),
    authors: Array.isArray(data.notes?.authors) ? data.notes.authors : [],
    moreAuthors: n0(data.notes?.more_authors),
  };
}

/** Doses that were due so far: taken (on time or late), skipped, not marked. */
export function dueOf(c: DailyUpdateCounts): number {
  return c.taken + c.late + c.skipped + c.notMarked;
}

export type DailyUpdateLeadKind = 'nothing' | 'quiet' | 'smooth' | 'steady' | 'mixed';

/**
 * Which lead sentence (the "was today OK?" moment):
 *   nothing recorded at all          nothing (today: "yet today" / past)
 *   no dose was due (tasks/notes)    quiet   (today: "so far" / past)
 *   nothing skipped/unmarked/late    smooth
 *   taken (+late) ≥ 2/3 of due       steady
 *   otherwise                        mixed
 */
export function leadKindOf(c: DailyUpdateCounts): DailyUpdateLeadKind {
  const due = dueOf(c);
  const anything = due + c.given + c.tasksDone + c.appointments + c.notes > 0;
  if (!anything) return 'nothing';
  if (due === 0) return 'quiet';
  if (c.skipped + c.notMarked === 0 && c.late === 0) return 'smooth';
  if ((c.taken + c.late) / due >= 2 / 3) return 'steady';
  return 'mixed';
}

/** The recipient's name as the sentences use it (trimmed), or "your loved one". */
export function recipientNameFor(data: Pick<DailyUpdateData, 'recipient_name'>, t: T): string {
  const name = data.recipient_name?.trim();
  return name ? name : t('names.lovedOne');
}

export function buildLead(data: DailyUpdateData, t: T, past: boolean): string {
  const name = recipientNameFor(data, t);
  // Literal keys (no `lead.${kind}`): the translation-key scanner checks each.
  switch (leadKindOf(countsOf(data))) {
    case 'nothing':
      return past ? t('lead.nothingPast', { name }) : t('lead.nothingToday', { name });
    case 'quiet':
      return past ? t('lead.quietPast', { name }) : t('lead.quietToday', { name });
    case 'smooth':
      return t('lead.smooth', { name });
    case 'steady':
      return t('lead.steady', { name });
    default:
      return t('lead.mixed', { name });
  }
}

/**
 * "Ana", "Ana and Luis", "Ana, Luis and 2 others". `authors` lists up to two
 * NAMED authors; an unnamed (departed) one is counted in `moreAuthors`, so with
 * fewer than two names the first of the "more" fills the slot as "a former member".
 */
export function formatNoteAuthors(authors: string[], moreAuthors: number, t: T): string {
  // The list is always the SUBJECT of the notes clause, so the departed fallback
  // takes its subject form (de: "ein ehemaliges Mitglied", not the dative "einem").
  const former = t('names.formerSubject');
  const names = authors.map((a) => (a && a.trim() ? a.trim() : former)).slice(0, 2);
  let more = Math.max(0, Math.floor(moreAuthors || 0));
  while (names.length < 2 && more > 0) {
    names.push(former);
    more -= 1;
  }
  if (names.length === 0) return former;
  if (names.length === 1) return names[0];
  const [a, b] = names;
  if (more === 0) {
    return startsWithISound(b) ? t('names.twoBeforeI', { a, b }) : t('names.two', { a, b });
  }
  return t('names.many', { a, b, count: more });
}

/**
 * The detail clauses, in order: doses, not marked, as-needed, tasks,
 * appointments, notes. Zero counts are dropped.
 */
export function buildClauses(data: DailyUpdateData, t: T): string[] {
  const c = countsOf(data);
  const due = dueOf(c);
  const out: string[] = [];
  if (due > 0) {
    const ok = c.taken + c.late;
    if (c.skipped + c.notMarked === 0 && c.late === 0) out.push(t('clause.allOnTime'));
    else if (c.skipped + c.notMarked === 0) out.push(t('clause.everyTaken'));
    else if (ok / due >= 2 / 3) {
      out.push(c.late === 0 ? t('clause.mostOnTime') : t('clause.mostTaken'));
    } else out.push(t('clause.ofDue', { ok, count: due }));
    if (c.notMarked > 0) out.push(t('clause.notMarked', { count: c.notMarked }));
  }
  if (c.given > 0) out.push(t('asNeeded.given', { count: c.given }));
  if (c.tasksDone > 0) out.push(t('tasks.done', { count: c.tasksDone }));
  if (c.appointments > 0) out.push(t('clause.appointments', { count: c.appointments }));
  if (c.notes > 0) {
    const names = formatNoteAuthors(c.authors, c.moreAuthors, t);
    const people = Math.max(1, c.authors.length + c.moreAuthors);
    out.push(
      people === 1
        ? t('clause.notesOne', { names, count: c.notes })
        : t('clause.notesMany', { names })
    );
  }
  return out;
}

/** Upper-case the first letter, in the reader's language. */
export function capitalizeFirst(text: string, language?: string): string {
  if (!text) return text;
  const first = text.charAt(0);
  let upper = first.toUpperCase();
  try {
    if (language) upper = first.toLocaleUpperCase(language);
  } catch {
    // An unknown tag falls back to the default casing.
  }
  return upper + text.slice(1);
}

/** The card's muted detail line: clauses joined " · ", first letter capitalized. null when empty. */
export function buildDetailLine(data: DailyUpdateData, t: T, language?: string): string | null {
  const clauses = buildClauses(data, t);
  if (clauses.length === 0) return null;
  return capitalizeFirst(clauses.join(' · '), language);
}

/**
 * The full page's one plain summary line:
 * "2 of 3 doses taken so far · 1 skipped · 1 to come" (a past day: no "so
 * far"; "1 not marked"). Zero parts omitted; null when there is nothing to say.
 */
export function buildGlance(data: DailyUpdateData, t: T, past: boolean): string | null {
  const c = countsOf(data);
  const due = dueOf(c);
  const parts: string[] = [];
  if (due > 0) {
    const ok = c.taken + c.late;
    parts.push(past ? t('glance.ofDue', { ok, count: due }) : t('glance.ofDueSoFar', { ok, count: due }));
  }
  if (c.skipped > 0) parts.push(t('glance.skipped', { count: c.skipped }));
  if (c.notMarked > 0) parts.push(t('clause.notMarked', { count: c.notMarked }));
  if (!past && c.upcoming > 0) parts.push(t('glance.toCome', { count: c.upcoming }));
  if (c.given > 0) parts.push(t('asNeeded.given', { count: c.given }));
  return parts.length ? parts.join(' · ') : null;
}

const nameOr = (name: string | null | undefined, fallback: string): string =>
  name && name.trim() ? name.trim() : fallback;

/** A dose row's second line: "Taken by Ana" / "Taken by Luis at 2:10 PM, a little late" / ... */
export function doseStatusLine(
  dose: DailyUpdateDoseDetail,
  t: T,
  formatTime: (time: string | null) => string | null
): string {
  const name = nameOr(dose.marked_by_name, t('names.someone'));
  switch (dose.status) {
    case 'taken':
      return t('status.takenBy', { name });
    case 'taken_late': {
      const time = formatTime(dose.marked_at);
      return time ? t('status.takenLateAt', { name, time }) : t('status.takenLate', { name });
    }
    case 'skipped':
      return t('status.skippedBy', { name });
    case 'not_marked':
      return t('status.notMarked');
    default:
      return t('status.upcoming');
  }
}

/** "Done by Ana" (a departed completer: "Done by someone"). */
export function taskDoneLine(completedBy: string | null, t: T): string {
  return t('status.doneBy', { name: nameOr(completedBy, t('names.someone')) });
}

/** The page's note title: the author, or "A former member". */
export function noteAuthorTitle(author: string | null, t: T): string {
  return nameOr(author, t('names.formerTitle'));
}

/** The card's note row: "A note from Ana" / "A note from a former member". */
export function noteFromLine(author: string | null, t: T): string {
  return t('card.noteFrom', { name: nameOr(author, t('names.former')) });
}
