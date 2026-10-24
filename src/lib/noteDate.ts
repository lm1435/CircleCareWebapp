/**
 * Pure date helpers for care-note backdating (docs/plans/care-note-backdating.md).
 * Twin of mobile/src/utils/noteDate.ts (same names, same maths).
 *
 * Every value is a NAIVE 'YYYY-MM-DD' in the care recipient's timezone, compared
 * as strings or shifted with UTC math, so no browser / machine timezone can move
 * a day.
 */

/** The server's GET span cap, and the size of one "Show older notes" page. */
export const NOTE_PAGE_DAYS = 92;

/** Whole days from `earlier` to `later`; negative when later < earlier. */
export function daysBetween(earlier: string, later: string): number {
  const [ey, em, ed] = earlier.split('-').map(Number);
  const [ly, lm, ld] = later.split('-').map(Number);
  return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(ey, em - 1, ed)) / 86_400_000);
}

/** Shift a 'YYYY-MM-DD' back by N days (UTC math). */
export function shiftDateBack(dateString: string, days: number): string {
  const [year, month, day] = dateString.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * `from`/`to` of "older page" N (1-based). The base window is today-91 .. today;
 * page 1 is the 92 days before it, and so on, contiguous.
 */
export function olderPageRange(today: string, page: number): { from: string; to: string } {
  const to = shiftDateBack(today, NOTE_PAGE_DAYS * page);
  return { from: shiftDateBack(to, NOTE_PAGE_DAYS - 1), to };
}

/** How many older pages are needed so a note `daysBack` days ago is loaded. */
export function olderPagesNeeded(daysBack: number): number {
  const neededDays = daysBack + 1;
  return neededDays <= NOTE_PAGE_DAYS ? 0 : Math.ceil((neededDays - NOTE_PAGE_DAYS) / NOTE_PAGE_DAYS);
}
