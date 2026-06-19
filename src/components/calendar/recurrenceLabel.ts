import type { CalendarEvent } from '@/api/calendarEvents';
import { getWeekdayName } from './dateMath';

// Local translate-fn type (mirrors mobile/src/utils/recurrenceFormat.ts) —
// avoids coupling to i18next's generic TFunction signature.
type TranslateFn = (key: string, opts?: Record<string, unknown>) => string;

/**
 * Human-readable recurrence label. PORT of mobile's
 * mobile/src/utils/recurrenceFormat.ts extended with weekly day names.
 *
 * recurrence_rule values (backend/src/routes/calendarEvents.ts):
 *   'daily' | 'every_other_day' | 'weekly' | 'custom:N'
 * recurrence_days: 0=Sun..6=Sat — NEVER convert Sunday 0→7.
 * Weekday names come from Intl with the active locale, not hand-written arrays.
 */
export function formatRecurrenceLabel(
  event: Pick<CalendarEvent, 'recurrence_rule' | 'recurrence_days'>,
  t: TranslateFn,
  locale: string
): string | null {
  const rule = event.recurrence_rule;
  if (!rule) return null;

  if (rule === 'daily') return t('calendar:recurrence.daily');
  if (rule === 'every_other_day') return t('calendar:recurrence.everyOtherDay');

  if (rule === 'weekly') {
    const days = event.recurrence_days;
    if (days && days.length > 0) {
      const names = [...days]
        .filter((d) => d >= 0 && d <= 6)
        .sort((a, b) => a - b)
        .map((d) => getWeekdayName(d, locale, 'short'))
        .join(', ');
      if (names) return t('calendar:recurrence.weeklyOn', { days: names });
    }
    return t('calendar:recurrence.weekly');
  }

  if (rule.startsWith('custom:')) {
    const n = Number.parseInt(rule.split(':')[1] ?? '', 10);
    if (!Number.isNaN(n) && n > 0) return t('calendar:recurrence.everyNDays', { count: n });
  }

  // Unknown rule — show it raw rather than hiding the fact that it repeats.
  return rule;
}
