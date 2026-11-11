import { shiftEnd } from '@/components/shifts/shiftUtils';
import type { HourCycle } from '@/utils/hourCycle';
import { clockInZone } from '@/utils/recipientEventDate';
import { formatTimeOfDay } from '@/utils/timezone';
import { wallTimeToInstant } from '@/utils/wallTimeToInstant';

/** An `HH:MM` as the viewer reads it (12 / 24 hour). */
export function clockText(hhmm: string, cycle: HourCycle): string {
  const [h, m] = hhmm.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? formatTimeOfDay(h, m, cycle) : hhmm;
}

/** "11:00 – 11:30 AM": the shared AM / PM said once when both ends have it (else both in full). */
export function clockRangeText(from: string, to: string, cycle: HourCycle): string {
  const a = clockText(from, cycle);
  const b = clockText(to, cycle);
  const split = (text: string): [string, string] => {
    const match = /^(\d{1,2}[:.]\d{2})(.*)$/.exec(text);
    return match ? [match[1], match[2]] : [text, ''];
  };
  const [aDigits, aSuffix] = split(a);
  const [, bSuffix] = split(b);
  return aSuffix.trim() !== '' && aSuffix === bSuffix ? `${aDigits} – ${b}` : `${a} – ${b}`;
}

/**
 * The viewer's clock for an appointment / task range, as the zone caption shows it (BC-4).
 *
 * `duration_minutes` is WALL-CLOCK minutes on the CIRCLE's clock: the stored end is "circle start wall + duration",
 * resolved in the circle zone. So the viewer's end is that circle end wall time turned into an instant and read on
 * the viewer's clock, NOT the viewer's start clock plus the duration (the two differ by an hour when exactly one of
 * the zones changes clocks inside the span). The start is the circle start's instant on the viewer's clock.
 */
export function viewerRangeForCaption(input: {
  scheduledDate: string;
  startHm: string;
  durationMinutes: number;
  circleZone: string;
  viewerZone: string;
  cycle: HourCycle;
}): string {
  const { scheduledDate, startHm, durationMinutes, circleZone, viewerZone, cycle } = input;
  const start = wallTimeToInstant(scheduledDate, startHm, circleZone);
  const end = shiftEnd(scheduledDate, startHm, durationMinutes);
  const endInstant = wallTimeToInstant(end.date, end.time, circleZone);
  return clockRangeText(clockInZone(start, viewerZone), clockInZone(endInstant, viewerZone), cycle);
}
