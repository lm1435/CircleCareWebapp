import type { EventType } from '@/api/calendarEvents';

/**
 * The one-line "Reminders" summary the simple add / edit forms show OUTSIDE the folded More
 * details (owner 2026-11-10, approved design "Summary line outside").
 *
 * Reminders are the setting people misread: a customer saw every box unchecked and believed the
 * medication was silent while the follow-up escalations (15 / 30 / 60 minutes late) still fired,
 * because those hang off `notifications_enabled` ALONE. So the summary states what WILL happen,
 * derived from exactly the state the Reminders card edits, and for a medication it always names
 * the follow-ups while notifications are on.
 *
 * A PORT of mobile/src/utils/reminderSummary.ts: same logic, same output. The web strings live
 * under `addEvent.reminders.summary.*` in the calendar namespace.
 */

export type ReminderSummaryState =
  /** Master switch off: nothing at all is sent for this entry. */
  | 'off'
  /** Task / appointment, master on but nothing selected: silent. */
  | 'none'
  /** Medication, master on, nothing at the time and nothing earlier: only the follow-ups fire. */
  | 'follow_ups_only'
  /** At least one reminder (at the time and/or earlier) is set. */
  | 'set';

export type ReminderSummaryItem = 'h24' | 'h1' | 'm30' | 'm15' | 'atTime';

export interface ReminderSummary {
  state: ReminderSummaryState;
  /** Earliest first, the at-time alert last ("1 hour before, at the scheduled time"). */
  items: ReminderSummaryItem[];
  /** Medication with notifications on: the follow-up escalations run. */
  followUps: boolean;
}

export interface ReminderSummaryInput {
  eventType: EventType;
  notificationsEnabled: boolean;
  reminderAtDue: boolean;
  reminder24h: boolean;
  reminder1h: boolean;
  reminder30m: boolean;
  reminder15m: boolean;
}

export function reminderSummary(input: ReminderSummaryInput): ReminderSummary {
  const isMedication = input.eventType === 'medication';
  if (!input.notificationsEnabled) return { state: 'off', items: [], followUps: false };
  const items: ReminderSummaryItem[] = [];
  if (input.reminder24h) items.push('h24');
  if (input.reminder1h) items.push('h1');
  if (input.reminder30m) items.push('m30');
  if (input.reminder15m) items.push('m15');
  if (input.reminderAtDue) items.push('atTime');
  if (items.length === 0) {
    return isMedication
      ? { state: 'follow_ups_only', items, followUps: true }
      : { state: 'none', items, followUps: false };
  }
  return { state: 'set', items, followUps: isMedication };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function capitalizeFirst(text: string, locale: string): string {
  if (!text) return text;
  try {
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
  } catch {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
}

/**
 * The summary's value (the row's second line): "At the scheduled time · follow-ups on",
 * "1 hour before, at the scheduled time", "off", "Follow-ups only · nothing at the scheduled time".
 * Literal keys on purpose: a translation-coverage scan can only verify a key it can read.
 */
export function reminderSummaryText(t: Translate, summary: ReminderSummary, locale: string): string {
  if (summary.state === 'off') return t('addEvent.reminders.summary.off');
  if (summary.state === 'none') return t('addEvent.reminders.summary.none');
  if (summary.state === 'follow_ups_only') {
    return capitalizeFirst(
      `${t('addEvent.reminders.summary.followUpsOnly')} · ${t('addEvent.reminders.summary.nothingAtTime')}`,
      locale
    );
  }
  const label: Record<ReminderSummaryItem, string> = {
    h24: t('addEvent.reminders.summary.h24'),
    h1: t('addEvent.reminders.summary.h1'),
    m30: t('addEvent.reminders.summary.m30'),
    m15: t('addEvent.reminders.summary.m15'),
    atTime: t('addEvent.reminders.summary.atTime'),
  };
  const list = summary.items.map((item) => label[item]).join(', ');
  // A medication with earlier reminders but nothing AT the time still escalates when late: say both
  // ("1 hour before · nothing at the scheduled time · follow-ups on"), owner 2026-11-10.
  const noAtTime = summary.followUps && !summary.items.includes('atTime')
    ? ` · ${t('addEvent.reminders.summary.nothingAtTime')}`
    : '';
  const text = summary.followUps ? `${list}${noAtTime} · ${t('addEvent.reminders.summary.followUpsOn')}` : list;
  return capitalizeFirst(text, locale);
}

/** The full sentence for screen readers ("Reminders: 1 hour before, at the scheduled time"). */
export function reminderSummaryLabel(t: Translate, summary: ReminderSummary, locale: string): string {
  return t('addEvent.reminders.summary.label', { value: reminderSummaryText(t, summary, locale) });
}
