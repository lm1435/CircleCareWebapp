// Time-of-day vocabulary for the simple medication UI (docs/plans/simple-ui-1-3-1.md).
// ONE module so the add form's four time chips and the Medications page's
// MORNING / MIDDAY / EVENING / BEDTIME groups can never disagree about what
// "evening" means. Mobile mirrors these exact values.

/** The four quick times offered under "When?". `time` is a viewer-frame HH:MM. */
export const MED_TIME_CHIPS = [
  { id: 'morning', time: '08:00' },
  { id: 'midday', time: '12:00' },
  { id: 'evening', time: '18:00' },
  { id: 'bedtime', time: '21:00' },
] as const;

export type MedTimeChipId = (typeof MED_TIME_CHIPS)[number]['id'];

/** The chip whose time is exactly `time` (HH:MM or HH:MM:SS), or null ("Other time"). */
export function chipForTime(time: string | null | undefined): MedTimeChipId | null {
  if (!time) return null;
  const hhmm = time.slice(0, 5);
  return MED_TIME_CHIPS.find((chip) => chip.time === hhmm)?.id ?? null;
}

/** Groups on the Medications page, in display order. */
export const MED_DAY_PARTS = ['morning', 'midday', 'evening', 'bedtime'] as const;
export type MedDayPart = (typeof MED_DAY_PARTS)[number];

/**
 * Where each group starts, in minutes after midnight, on the DOSE'S OWN CLOCK
 * (the care recipient's, since stored times are recipient-frame):
 *
 *   MORNING  05:00 - 10:59
 *   MIDDAY   11:00 - 15:59
 *   EVENING  16:00 - 20:59
 *   BEDTIME  21:00 - 04:59   (wraps midnight: a 1:00 AM dose is a late night, not an early morning)
 *
 * The four chips (8:00, 12:00, 18:00, 21:00) each land in the group of their own name.
 */
export const DAY_PART_START_MINUTES: Record<MedDayPart, number> = {
  morning: 5 * 60,
  midday: 11 * 60,
  evening: 16 * 60,
  bedtime: 21 * 60,
};

/** Minutes after midnight for an HH:MM[:SS] string, or null when unparseable. */
export function minutesOfDay(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  const h = Number(match[1]) % 24; // "24:00" is stored midnight on some old rows
  const m = Number(match[2]);
  if (m > 59) return null;
  return h * 60 + m;
}

/** The group a dose time belongs to. Unparseable input falls back to morning. */
export function dayPartForTime(time: string): MedDayPart {
  const minutes = minutesOfDay(time);
  if (minutes === null) return 'morning';
  if (minutes >= DAY_PART_START_MINUTES.bedtime || minutes < DAY_PART_START_MINUTES.morning) {
    return 'bedtime';
  }
  if (minutes >= DAY_PART_START_MINUTES.evening) return 'evening';
  if (minutes >= DAY_PART_START_MINUTES.midday) return 'midday';
  return 'morning';
}

/**
 * Sort key that follows the day as a person lives it: starts at 05:00, so the
 * after-midnight doses sort AFTER 11:00 PM inside BEDTIME.
 */
export function doseSortKey(time: string): number {
  const minutes = minutesOfDay(time) ?? 0;
  return (minutes - DAY_PART_START_MINUTES.morning + 1440) % 1440;
}

export interface TimedRow<T> {
  /** HH:MM, recipient frame. */
  time: string;
  item: T;
}

/**
 * Bucket rows (one per medication per time) into the four groups, each sorted by
 * time then by `tiebreak` (e.g. name). Empty groups are omitted.
 */
export function groupByDayPart<T>(
  rows: ReadonlyArray<TimedRow<T>>,
  tiebreak: (a: T, b: T) => number = () => 0
): Array<{ part: MedDayPart; rows: Array<TimedRow<T>> }> {
  const buckets = new Map<MedDayPart, Array<TimedRow<T>>>();
  for (const row of rows) {
    const part = dayPartForTime(row.time);
    const list = buckets.get(part) ?? [];
    list.push(row);
    buckets.set(part, list);
  }
  return MED_DAY_PARTS.filter((part) => buckets.has(part)).map((part) => ({
    part,
    rows: [...(buckets.get(part) ?? [])].sort(
      (a, b) => doseSortKey(a.time) - doseSortKey(b.time) || tiebreak(a.item, b.item)
    ),
  }));
}
