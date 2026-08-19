// PORT of mobile/src/utils/timeline.ts `resolveOverlaps`, with the same
// grouping rule and the same equal-column layout — a morning med pass that
// renders five chips side by side on the phone renders five on the web.
//
// Without this the web timeline positioned every chip at `inset-x-0.5`, so
// events sharing a start time landed exactly on top of each other and only the
// last one painted was visible: five 8:00 AM medications read as one.
//
// NOTE on the mobile source: its `OverlapInfo` doc comments describe a
// "max 2 columns, column -1 = hidden, +N overflow" design that the function
// never actually implements (nothing produces -1 or reads `overflow`). This
// port follows the REAL behaviour — N columns for N overlapping events — so
// the two surfaces agree. If the capped design is ever built, build it on both.

export interface OverlapInfo {
  /** 0-based lane within the collision group. */
  column: number;
  /** How many lanes the group was split into. */
  totalColumns: number;
}

/** Same fallback mobile's resolveOverlaps uses when duration_minutes is unset. */
const DEFAULT_DURATION_MINUTES = 30;

interface OverlappableEvent {
  id: string;
  scheduled_date?: string;
  scheduled_time?: string | null;
  duration_minutes?: number | null;
}

/**
 * Key for the returned map. Deliberately NOT the bare `id`: a virtual
 * recurring instance's id is `${parentId}_${YYYY-MM-DD}`, so two doses of the
 * same parent on the same day share one id. Matches the chip's React key.
 */
export function overlapKey(event: OverlappableEvent): string {
  return `${event.id}_${event.scheduled_date ?? ''}_${event.scheduled_time ?? 'allday'}`;
}

function startMinutes(time: string): number {
  const [hours = '0', minutes = '0'] = time.split(':');
  return Number.parseInt(hours, 10) * 60 + Number.parseInt(minutes, 10);
}

function endMinutes(event: OverlappableEvent): number {
  return (
    startMinutes(event.scheduled_time as string) +
    (event.duration_minutes || DEFAULT_DURATION_MINUTES)
  );
}

/**
 * Split a day's timed events into collision groups and assign each event a
 * lane. Events are walked in start-time order; an event joins the current
 * group when it starts before the group's latest end, otherwise it opens a new
 * one. Every member of a group gets an equal share of the column width.
 */
export function resolveOverlaps(events: OverlappableEvent[]): Map<string, OverlapInfo> {
  const result = new Map<string, OverlapInfo>();

  const sorted = events
    .filter((event) => !!event.scheduled_time)
    .slice()
    .sort((a, b) => (a.scheduled_time as string).localeCompare(b.scheduled_time as string));

  const groups: OverlappableEvent[][] = [];
  let currentGroup: OverlappableEvent[] = [];

  for (const event of sorted) {
    if (currentGroup.length === 0) {
      currentGroup.push(event);
      continue;
    }
    const groupEnd = Math.max(...currentGroup.map(endMinutes));
    if (startMinutes(event.scheduled_time as string) < groupEnd) {
      currentGroup.push(event);
    } else {
      groups.push(currentGroup);
      currentGroup = [event];
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  for (const group of groups) {
    group.forEach((event, index) => {
      result.set(overlapKey(event), { column: index, totalColumns: group.length });
    });
  }

  return result;
}
