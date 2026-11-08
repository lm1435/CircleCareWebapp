import { addDays, daysBetween, getDayOfWeek } from '@/components/calendar/dateMath';

// Days on / days off rotations (`cycle:N:M`) for shifts: parsing, the form's
// 6-week preview and the "Day n of N" position line. Pure date-string math, no
// clock and no timezone (shift dates are recipient-frame `YYYY-MM-DD`).

export const CYCLE_MIN = 1;
export const CYCLE_MAX = 999;
/** Weeks the form's preview shows. */
export const PREVIEW_WEEKS = 6;

export interface CycleParts {
  on: number;
  off: number;
}

/** `cycle:14:7` -> `{ on: 14, off: 7 }`; null for anything else (or out-of-range counts). */
export function parseCycleRule(rule: string | null | undefined): CycleParts | null {
  const m = /^cycle:(\d{1,3}):(\d{1,3})$/.exec(rule ?? '');
  if (!m) return null;
  const on = Number(m[1]);
  const off = Number(m[2]);
  if (on < CYCLE_MIN || on > CYCLE_MAX || off < CYCLE_MIN || off > CYCLE_MAX) return null;
  return { on, off };
}

/** A whole number in 1..999 from the typed text, or null (integers only: "1.5", "", "0", "1e2" are null). */
export function parseCycleCount(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= CYCLE_MIN && n <= CYCLE_MAX ? n : null;
}

export function cycleRule(on: number, off: number): string {
  return `cycle:${on}:${off}`;
}

export interface PreviewCell {
  date: string;
  /** Day of month. */
  day: number;
  /** 1..12 on the 1st of a month (the cell carries a month label), else null. */
  firstOfMonth: number | null;
  /** The cell also names its month ("Nov 7"): the 1st of a month, and the FIRST cell of the preview. */
  labelled: boolean;
  on: boolean;
}

export interface CyclePreview {
  /** Empty cells before the first day so the columns line up with the weekday header. */
  leading: number;
  cells: PreviewCell[];
}

/** `PREVIEW_WEEKS * 7` days starting AT `startDate` (day 1 of the rotation). `weekStart` = 0 Sun / 1 Mon. */
export function buildCyclePreview(
  startDate: string,
  on: number,
  off: number,
  weekStart = 0
): CyclePreview {
  const period = on + off;
  const cells: PreviewCell[] = [];
  for (let i = 0; i < PREVIEW_WEEKS * 7; i++) {
    const date = addDays(startDate, i);
    const day = Number(date.slice(8, 10));
    cells.push({
      date,
      day,
      firstOfMonth: day === 1 ? Number(date.slice(5, 7)) : null,
      labelled: day === 1 || i === 0,
      on: i % period < on,
    });
  }
  return { leading: (getDayOfWeek(startDate) - weekStart + 7) % 7, cells };
}

/** First and last day of the preview and whether they sit in different years (the caption then names the years). */
export function previewRange(startDate: string): { from: string; to: string; crossesYear: boolean } {
  const to = addDays(startDate, PREVIEW_WEEKS * 7 - 1);
  return { from: startDate, to, crossesYear: startDate.slice(0, 4) !== to.slice(0, 4) };
}

export interface RotationPosition {
  /** 1-based position in the on-block. */
  day: number;
  on: number;
  /** The first date of the next on-block. */
  backOn: string;
}

/**
 * Where `date` sits in a rotation anchored at `anchorDate` (the series root's
 * date = day 1). Null on an off day, before the anchor, or for a non-cycle rule.
 */
export function rotationPosition(
  rule: string | null | undefined,
  anchorDate: string,
  date: string
): RotationPosition | null {
  const parts = parseCycleRule(rule);
  if (!parts || !anchorDate || !date) return null;
  const offset = daysBetween(anchorDate, date);
  if (offset < 0) return null;
  const period = parts.on + parts.off;
  const pos = offset % period;
  if (pos >= parts.on) return null;
  return { day: pos + 1, on: parts.on, backOn: addDays(date, period - pos) };
}

export type CycleBucket = '1-3' | '4-7' | '8-14' | '15+';

export function cycleBucket(n: number): CycleBucket {
  if (n <= 3) return '1-3';
  if (n <= 7) return '4-7';
  if (n <= 14) return '8-14';
  return '15+';
}
