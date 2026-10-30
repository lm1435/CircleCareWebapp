import { getTimezoneOffsetMinutes } from './timezone';

export interface ZoneGap {
  /** The recipient's clock relative to the viewer's: 'behind' = earlier on the clock. */
  direction: 'behind' | 'ahead';
  /** Whole or fractional hours (5.5 for India vs UTC), always > 0. */
  hours: number;
}

/**
 * How far the care recipient's clock is from the viewer's, or null when they read
 * the same. Compared by OFFSET at `at` (never by zone name: aliases such as
 * Asia/Kolkata vs Asia/Calcutta are the same clock). Drives the single
 * "Times are Mom's time · 7 hours behind you" line on the Medications page.
 */
export function zoneGap(
  viewerTimezone: string,
  recipientTimezone: string,
  at: Date = new Date()
): ZoneGap | null {
  const minutes =
    getTimezoneOffsetMinutes(recipientTimezone, at) - getTimezoneOffsetMinutes(viewerTimezone, at);
  if (minutes === 0) return null;
  return {
    direction: minutes < 0 ? 'behind' : 'ahead',
    hours: Math.round((Math.abs(minutes) / 60) * 100) / 100,
  };
}
