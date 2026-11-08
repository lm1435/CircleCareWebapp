import type { CalendarEvent, EventType } from '@/api/calendarEvents';

/**
 * Week view slot grouping (owner 2026-11-07). Five morning meds at 8:00 AM used to split the day
 * column into five ~24px lanes that read "A.. A.. L.. M.. V..". Timed items of the SAME type that
 * start at the SAME minute now collapse into ONE chip ("5 meds") that opens a list of them. A lone
 * item stays its own chip, and items of different types at the same minute stay separate chips
 * (they still share lanes, at most one lane per type).
 */
export type SlotItem =
  | { kind: 'event'; event: CalendarEvent }
  | {
      kind: 'group';
      /** Stable per day: type + minute. */
      key: string;
      /** The first member's raw scheduled_time (HH:MM[:SS]). */
      time: string;
      type: EventType;
      events: CalendarEvent[];
    };

/** HH:MM of a naive scheduled_time. */
function minuteOf(time: string): string {
  return time.slice(0, 5);
}

/** Group one day's TIMED events by (start minute, type); groups of 2+ collapse. Order: first appearance. */
export function groupSlots(events: CalendarEvent[]): SlotItem[] {
  const buckets = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (!event.scheduled_time) continue;
    const key = `${event.event_type}@${minuteOf(event.scheduled_time)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(event);
    else buckets.set(key, [event]);
  }
  const items: SlotItem[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length === 1) {
      items.push({ kind: 'event', event: bucket[0] });
    } else {
      items.push({
        kind: 'group',
        key,
        time: bucket[0].scheduled_time as string,
        type: bucket[0].event_type,
        events: bucket,
      });
    }
  }
  return items;
}

/** What `resolveOverlaps` needs for a slot item: a group occupies one 30-minute block. */
export function slotOverlapInput(item: SlotItem): {
  id: string;
  scheduled_date?: string;
  scheduled_time: string;
  duration_minutes?: number | null;
} {
  if (item.kind === 'event') {
    return {
      id: item.event.id,
      scheduled_date: item.event.scheduled_date,
      scheduled_time: item.event.scheduled_time as string,
      duration_minutes: item.event.duration_minutes,
    };
  }
  return {
    id: `slot_${item.key}`,
    scheduled_date: item.events[0].scheduled_date,
    scheduled_time: item.time,
    duration_minutes: null,
  };
}
