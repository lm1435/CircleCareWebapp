import type { CalendarEvent } from '@/api/calendarEvents';
import type { TodaysMedication } from '@/api/medicationConfirmations';
import { doseNeedsAnswer } from '@/utils/medicationDose';
import { getCurrentHoursInTimezone, isEventPastDue } from '@/utils/timezone';

// Today's "Next up" list (docs/plans/simple-ui-1-3-1.md): today's doses,
// appointments and tasks merged in time order. Pure, so the ordering and the
// "late" rule are testable without a render.

export type NextUpType = 'medication' | 'appointment' | 'task';

export interface NextUpItem {
  /** Stable React key: type + id. */
  key: string;
  type: NextUpType;
  id: string;
  title: string;
  /** Dose / place, or null. */
  detail: string | null;
  /** HH:MM[:SS] in the care recipient's zone, or null for an untimed item. */
  time: string | null;
  date: string;
  /** Past its scheduled moment and still open. Always shown in TEXT. */
  late: boolean;
  /** Whole hours late when it is today's and at least an hour late, else null. */
  lateHours: number | null;
  med?: TodaysMedication;
  event?: CalendarEvent;
}

function minutesOf(time: string): number | null {
  const [h, m] = time.split(':').map((p) => parseInt(p, 10));
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function lateHoursFor(
  date: string,
  time: string | null,
  today: string,
  timezone: string,
  now: Date
): number | null {
  if (!time || date !== today) return null;
  const at = minutesOf(time);
  if (at === null) return null;
  const diff = Math.round(getCurrentHoursInTimezone(timezone, now) * 60) - at;
  return diff >= 60 ? Math.floor(diff / 60) : null;
}

export interface BuildNextUpInput {
  meds: readonly TodaysMedication[];
  /** Calendar events for today onward (appointments are filtered here). */
  events: readonly CalendarEvent[];
  /** Open tasks (any date; due today or earlier are kept). */
  tasks: readonly CalendarEvent[];
  timezone: string;
  today: string;
  now: Date;
}

export function buildNextUp({
  meds,
  events,
  tasks,
  timezone,
  today,
  now,
}: BuildNextUpInput): NextUpItem[] {
  const items: NextUpItem[] = [];

  for (const med of meds) {
    if (med.as_needed === true || !doseNeedsAnswer(med.confirmation)) continue;
    const time = med.scheduled_time ?? null;
    items.push({
      key: `medication:${med.id}`,
      type: 'medication',
      id: med.id,
      title: med.medication_name || med.title,
      detail: med.medication_dosage || null,
      time,
      date: med.scheduled_date,
      late: isEventPastDue(med.scheduled_date, time, timezone, now),
      lateHours: lateHoursFor(med.scheduled_date, time, today, timezone, now),
      med,
    });
  }

  for (const e of events) {
    if (e.event_type !== 'appointment' || e.completed_at || e.scheduled_date !== today) continue;
    const time = e.scheduled_time ?? null;
    // An appointment that already happened is not "next up".
    if (isEventPastDue(e.scheduled_date, time, timezone, now)) continue;
    items.push({
      key: `appointment:${e.id}`,
      type: 'appointment',
      id: e.id,
      title: e.title,
      detail: e.location ?? null,
      time,
      date: e.scheduled_date,
      late: false,
      lateHours: null,
      event: e,
    });
  }

  for (const task of tasks) {
    if (task.completed_at || task.scheduled_date > today) continue;
    const time = task.scheduled_time ?? null;
    items.push({
      key: `task:${task.id}`,
      type: 'task',
      id: task.id,
      title: task.title,
      detail: null,
      time,
      date: task.scheduled_date,
      late: isEventPastDue(task.scheduled_date, time, timezone, now),
      lateHours: lateHoursFor(task.scheduled_date, time, today, timezone, now),
      event: task,
    });
  }

  const sortKey = (i: NextUpItem): string => `${i.date}T${i.time ?? '99:99:99'}`;
  return items.sort((a, b) => {
    const ak = sortKey(a);
    const bk = sortKey(b);
    if (ak !== bk) return ak < bk ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}
