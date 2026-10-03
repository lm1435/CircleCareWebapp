import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { CareNote, CareNoteMood } from '@/api/careNotes';
import {
  formatDateForDisplay,
  getDayOfWeek,
  getWeekDays,
  getWeekdayName,
  startOfWeek,
} from '@/components/calendar/dateMath';

// Mood week strip (docs/plans/notes-first-class.md, Slice 3 — Decision 6 /
// User Flow step 6). Sunday-first row of 7 day buttons for the week
// CONTAINING `today` (never the machine's local week — `today` is the
// recipient-timezone value the Notes page already resolved from the server,
// and every date computed off it goes through dateMath's UTC-anchored
// helpers, never device-local Date getters).
//
// One dot per mood-HAVING note (a day with two notes in the same mood shows
// two dots — Decision 6: "every mood logged shows"), up to 3, then a "+N"
// overflow marker. Dots and the overflow marker are decorative (aria-hidden):
// the day button's accessible name already carries the real counts in text
// ("Tuesday, September 22: 1 good, 1 tough"), so nothing here depends on
// color alone (WCAG 1.4.1). There is no established per-mood color mapping
// anywhere in the app (mobile or web — both only ever render mood as a
// neutral `dusk`-tinted text pill, see NoteRow.tsx), so dots reuse that same
// single `dusk` token rather than inventing a new one.
//
// The week summary line counts NOTES (not days) by mood, great→good→okay→
// tough, only moods actually present that week — never a single verdict per
// day. An empty week still renders the 7 cells; only the summary text
// changes to "No moods logged this week" (UI States: "Never hidden — it
// teaches the feature").

export interface MoodWeekStripProps {
  /** Every currently loaded care note (any window) — filtered here to the
   *  week containing `today`. No new request: the Notes page already has
   *  this data loaded for its own list. */
  notes: CareNote[];
  /** Today's YYYY-MM-DD in the care recipient's timezone (server-resolved —
   *  the same value the Notes page's day-grouping already uses). */
  today: string;
  onSelectDay: (date: string) => void;
}

const MOOD_ORDER: CareNoteMood[] = ['great', 'good', 'okay', 'tough'];
const MAX_VISIBLE_DOTS = 3;

/** Static per-mood key lookup — keeps every `t()` call site a literal string
 *  (no `t(\`moodStrip.count_${mood}\`)`), so the i18n key-parity audit
 *  (`src/i18n/__tests__/translationKeys.test.ts`) can resolve it statically
 *  instead of counting it as a new "dynamic" call site. */
function moodCountLabel(mood: CareNoteMood, count: number, t: TFunction): string {
  switch (mood) {
    case 'great':
      return t('moodStrip.count_great', { count });
    case 'good':
      return t('moodStrip.count_good', { count });
    case 'okay':
      return t('moodStrip.count_okay', { count });
    case 'tough':
      return t('moodStrip.count_tough', { count });
  }
}

/** "3 great, 1 okay, 2 tough" — counts BY NOTE, only moods present, in the
 *  canonical great→good→okay→tough order. Empty string when none present. */
function moodCountList(notesWithMood: CareNote[], t: TFunction): string {
  const counts: Record<CareNoteMood, number> = { great: 0, good: 0, okay: 0, tough: 0 };
  for (const note of notesWithMood) {
    if (note.mood) counts[note.mood] += 1;
  }
  return MOOD_ORDER.filter((mood) => counts[mood] > 0)
    .map((mood) => moodCountLabel(mood, counts[mood], t))
    .join(', ');
}

export function MoodWeekStrip({ notes, today, onSelectDay }: MoodWeekStripProps): ReactElement {
  const { t } = useTranslation('notes');

  const weekDays = useMemo(() => getWeekDays(startOfWeek(today)), [today]);
  const weekDaySet = useMemo(() => new Set(weekDays), [weekDays]);

  const weekSummary = useMemo(
    () => moodCountList(notes.filter((n) => n.mood !== null && weekDaySet.has(n.note_date)), t),
    [notes, weekDaySet, t]
  );

  return (
    <div className="px-5">
      <div className="grid grid-cols-7 gap-1">
        {weekDays.map((date) => {
          // Every mood-having note for the day, in canonical order (so the
          // first 3 dots shown — and the "+N" overflow — are deterministic
          // rather than depending on fetch/insert order).
          const dayMoodNotes = MOOD_ORDER.flatMap((mood) =>
            notes.filter((n) => n.note_date === date && n.mood === mood)
          );
          const visibleDots = dayMoodNotes.slice(0, MAX_VISIBLE_DOTS);
          const overflow = dayMoodNotes.length - visibleDots.length;
          const isToday = date === today;

          const dateLabel = formatDateForDisplay(date, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          });
          const daySummary = moodCountList(dayMoodNotes, t);
          const accessibleName = daySummary
            ? t('moodStrip.dayA11y', { day: dateLabel, summary: daySummary })
            : dateLabel;

          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDay(date)}
              aria-label={accessibleName}
              aria-current={isToday ? 'date' : undefined}
              className={`flex min-h-[44px] flex-col items-center justify-center gap-1 rounded-lg py-2 transition-colors ${
                isToday ? 'bg-ink' : 'hover:bg-bg-2'
              }`}
            >
              <span
                aria-hidden="true"
                className={`text-xs font-medium uppercase ${isToday ? 'text-cream' : 'text-ink-3'}`}
              >
                {getWeekdayName(getDayOfWeek(date), 'narrow')}
              </span>
              <span
                aria-hidden="true"
                className={`text-sm font-semibold ${isToday ? 'text-cream' : 'text-ink'}`}
              >
                {formatDateForDisplay(date, { day: 'numeric' })}
              </span>
              <span aria-hidden="true" className="flex h-2 items-center gap-0.5">
                {visibleDots.map((note) => (
                  <span key={note.id} className="h-1.5 w-1.5 rounded-full bg-dusk" />
                ))}
                {overflow > 0 && (
                  <span
                    className={`text-2xs leading-none ${isToday ? 'text-cream' : 'text-ink-3'}`}
                  >
                    +{overflow}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-ink-3">
        {weekSummary ? t('moodStrip.summary', { list: weekSummary }) : t('moodStrip.empty')}
      </p>
    </div>
  );
}

export default MoodWeekStrip;
