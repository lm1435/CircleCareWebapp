import { getCurrentUser, updateProfile } from '../api/users';
import { devLog, devError } from '../constants/config';

// VERBATIM PORT of mobile/src/utils/timezone.ts (Intl-based — 20 timezone bugs
// were fixed on mobile; web must not re-earn those scars).
// Only adaptation: getDeviceTimezone uses Intl.resolvedOptions() instead of
// expo-localization.
//
// NEVER use `new Date().getHours()` to compare with scheduled times,
// `.split('T')[0]` on UTC ISO strings, or `toLocaleDateString()` without a
// `timeZone` param — always convert to the care recipient's timezone first.

/**
 * Timezone abbreviation map for common US timezones
 */
const TIMEZONE_ABBREVIATIONS: Record<string, string> = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Los_Angeles': 'PT',
  'America/Phoenix': 'AZ',
  'America/Anchorage': 'AKT',
  'Pacific/Honolulu': 'HT',
  'America/Detroit': 'ET',
  'America/Indiana/Indianapolis': 'ET',
  'America/Boise': 'MT',
};

/**
 * Full timezone labels for display
 */
const TIMEZONE_LABELS: Record<string, string> = {
  'America/New_York': 'Eastern Time',
  'America/Chicago': 'Central Time',
  'America/Denver': 'Mountain Time',
  'America/Los_Angeles': 'Pacific Time',
  'America/Phoenix': 'Arizona Time',
  'America/Anchorage': 'Alaska Time',
  'Pacific/Honolulu': 'Hawaii Time',
};

/**
 * Get the device's (browser's) current IANA timezone
 */
export function getDeviceTimezone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

/**
 * Get short timezone abbreviation (e.g., "MT", "CT")
 */
export function getTimezoneAbbreviation(timezone: string): string {
  return TIMEZONE_ABBREVIATIONS[timezone] || timezone.split('/').pop() || timezone;
}

/**
 * Get full timezone label (e.g., "Mountain Time")
 */
export function getTimezoneLabel(timezone: string): string {
  return TIMEZONE_LABELS[timezone] || timezone;
}

/**
 * Get the UTC offset in minutes for a timezone at a specific date
 * Positive = ahead of UTC, Negative = behind UTC
 * Uses Intl.DateTimeFormat for reliable cross-platform support
 */
export function getTimezoneOffsetMinutes(timezone: string, date: Date = new Date()): number {
  try {
    // Get the hour and minute in the target timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

    // Get the hour and minute in UTC
    const utcFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const utcParts = utcFormatter.formatToParts(date);
    const utcHour = parseInt(utcParts.find((p) => p.type === 'hour')?.value || '0', 10);
    const utcMinute = parseInt(utcParts.find((p) => p.type === 'minute')?.value || '0', 10);

    // Calculate offset in minutes
    let offsetMinutes = hour * 60 + minute - (utcHour * 60 + utcMinute);

    // Handle day boundary (offset should be between -12 and +14 hours)
    if (offsetMinutes > 12 * 60) {
      offsetMinutes -= 24 * 60;
    } else if (offsetMinutes < -12 * 60) {
      offsetMinutes += 24 * 60;
    }

    return offsetMinutes;
  } catch {
    return 0;
  }
}

/**
 * Convert a time from one timezone to another
 * @param hours - Hours (0-23)
 * @param minutes - Minutes (0-59)
 * @param fromTimezone - Source IANA timezone
 * @param toTimezone - Target IANA timezone
 * @param date - Reference date (for DST calculation)
 * @returns Object with converted hours, minutes, and day offset (-1, 0, or +1)
 */
export function convertTimeBetweenTimezones(
  hours: number,
  minutes: number,
  fromTimezone: string,
  toTimezone: string,
  date: Date = new Date()
): { hours: number; minutes: number; dayOffset: number } {
  try {
    // Get offsets for both timezones
    const fromOffset = getTimezoneOffsetMinutes(fromTimezone, date);
    const toOffset = getTimezoneOffsetMinutes(toTimezone, date);

    // Calculate the difference (positive means toTimezone is ahead)
    const offsetDiff = toOffset - fromOffset;

    // Convert to total minutes and add offset
    let totalMinutes = hours * 60 + minutes + offsetDiff;

    // Handle day wraparound
    let dayOffset = 0;
    if (totalMinutes < 0) {
      dayOffset = -1;
      totalMinutes += 24 * 60;
    } else if (totalMinutes >= 24 * 60) {
      dayOffset = 1;
      totalMinutes -= 24 * 60;
    }

    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      dayOffset,
    };
  } catch {
    return { hours, minutes, dayOffset: 0 };
  }
}

/**
 * Format a time for display with AM/PM
 */
export function formatTimeDisplay(hours: number, minutes: number): string {
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Format time with timezone abbreviation (e.g., "8:40 PM MT")
 */
export function formatTimeWithTimezone(hours: number, minutes: number, timezone: string): string {
  return `${formatTimeDisplay(hours, minutes)} ${getTimezoneAbbreviation(timezone)}`;
}

/**
 * Format dual timezone display (e.g., "8:40 PM MT / 9:40 PM CT")
 * Shows user's local time first, then care recipient's time
 */
export function formatDualTimezoneDisplay(
  hours: number,
  minutes: number,
  userTimezone: string,
  careRecipientTimezone: string
): string {
  // If same timezone, just show one time
  if (userTimezone === careRecipientTimezone) {
    return formatTimeWithTimezone(hours, minutes, userTimezone);
  }

  // Convert user's time to care recipient's time
  const converted = convertTimeBetweenTimezones(
    hours,
    minutes,
    userTimezone,
    careRecipientTimezone
  );

  const userTime = formatTimeWithTimezone(hours, minutes, userTimezone);
  const recipientTime = formatTimeWithTimezone(
    converted.hours,
    converted.minutes,
    careRecipientTimezone
  );

  return `${userTime} / ${recipientTime}`;
}

/**
 * Convert a Date object's time from device timezone to care recipient's timezone
 * Returns hours and minutes in the care recipient's timezone
 */
export function convertDateToRecipientTimezone(
  date: Date,
  careRecipientTimezone: string
): { hours: number; minutes: number; dayOffset: number } {
  const deviceTimezone = getDeviceTimezone();
  return convertTimeBetweenTimezones(
    date.getHours(),
    date.getMinutes(),
    deviceTimezone,
    careRecipientTimezone,
    date
  );
}

/**
 * Check if two timezones are different
 */
export function timezonesAreDifferent(tz1: string, tz2: string): boolean {
  if (tz1 === tz2) return false;

  // Also check if they have the same offset (some timezones are aliases)
  const offset1 = getTimezoneOffsetMinutes(tz1);
  const offset2 = getTimezoneOffsetMinutes(tz2);

  return offset1 !== offset2;
}

/**
 * Format an event time for display throughout the app.
 * Times are stored in care recipient's timezone (already converted on save).
 * Shows: "2:00 PM CT" or "2:00 PM CT / 1:00 PM MT" if viewer is in different TZ
 *
 * @param timeString - Time from database (HH:MM or HH:MM:SS format) - already in care recipient's TZ
 * @param careRecipientTimezone - The care recipient's IANA timezone
 * @param showDualTimezone - Whether to show viewer's local time too (optional, auto-detects)
 * @param referenceDate - Optional date for DST calculations (defaults to today)
 * @returns Formatted time string with timezone(s)
 */
export function formatEventTimeForDisplay(
  timeString: string,
  careRecipientTimezone: string,
  showDualTimezone?: boolean,
  referenceDate?: Date
): string {
  try {
    // Parse time string (HH:MM or HH:MM:SS) - this is already in care recipient's timezone
    const [hoursStr, minutesStr] = timeString.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    if (isNaN(hours) || isNaN(minutes)) {
      return timeString; // Return original if parsing fails
    }

    const deviceTimezone = getDeviceTimezone();
    const shouldShowDual =
      showDualTimezone ?? timezonesAreDifferent(deviceTimezone, careRecipientTimezone);

    // Format care recipient's time directly (no conversion - it's already in their TZ)
    const period = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    const recipientTime = `${hour12}:${minutes.toString().padStart(2, '0')} ${period} ${getTimezoneAbbreviation(careRecipientTimezone)}`;

    if (!shouldShowDual) {
      return recipientTime;
    }

    // For viewer's time, we need to convert FROM care recipient's TZ TO viewer's TZ
    const refDate = referenceDate || new Date();

    // Get the UTC time for this moment
    const recipientOffset = getTimezoneOffsetMinutes(careRecipientTimezone, refDate);
    const utcMinutes = hours * 60 + minutes - recipientOffset;

    // Convert to viewer's timezone
    const viewerOffset = getTimezoneOffsetMinutes(deviceTimezone, refDate);
    let viewerTotalMinutes = utcMinutes + viewerOffset;

    // Handle day wraparound
    if (viewerTotalMinutes < 0) {
      viewerTotalMinutes += 24 * 60;
    } else if (viewerTotalMinutes >= 24 * 60) {
      viewerTotalMinutes -= 24 * 60;
    }

    const viewerHours = Math.floor(viewerTotalMinutes / 60);
    const viewerMinutes = viewerTotalMinutes % 60;
    const viewerPeriod = viewerHours >= 12 ? 'PM' : 'AM';
    const viewerHour12 = viewerHours % 12 || 12;
    const viewerTime = `${viewerHour12}:${viewerMinutes.toString().padStart(2, '0')} ${viewerPeriod} ${getTimezoneAbbreviation(deviceTimezone)}`;

    return `${recipientTime} / ${viewerTime}`;
  } catch {
    // Fallback to simple format if Intl fails
    return timeString;
  }
}

/**
 * Get event time parts for stacked display (primary = care recipient's TZ, secondary = viewer's TZ)
 * Use this when you want to render times on separate lines instead of "10:00 AM CT / 9:00 AM MT"
 *
 * @param timeString - Time from database (HH:MM or HH:MM:SS format) - already in care recipient's TZ
 * @param careRecipientTimezone - The care recipient's IANA timezone
 * @param referenceDate - Optional date for DST calculations (defaults to today)
 * @returns Object with primaryTime (recipient's TZ) and secondaryTime (viewer's TZ, null if same TZ)
 */
export function getEventTimeParts(
  timeString: string,
  careRecipientTimezone: string,
  referenceDate?: Date
): { primaryTime: string; secondaryTime: string | null } {
  try {
    const [hoursStr, minutesStr] = timeString.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    if (isNaN(hours) || isNaN(minutes)) {
      return { primaryTime: timeString, secondaryTime: null };
    }

    const deviceTimezone = getDeviceTimezone();
    const tzAbbr = getTimezoneAbbreviation(careRecipientTimezone);

    // Format care recipient's time
    const period = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    const primaryTime = `${hour12}:${minutes.toString().padStart(2, '0')} ${period} ${tzAbbr}`;

    // Check if we need viewer's time
    if (!timezonesAreDifferent(deviceTimezone, careRecipientTimezone)) {
      return { primaryTime, secondaryTime: null };
    }

    // Convert to viewer's timezone
    const refDate = referenceDate || new Date();
    const recipientOffset = getTimezoneOffsetMinutes(careRecipientTimezone, refDate);
    const utcMinutes = hours * 60 + minutes - recipientOffset;
    const viewerOffset = getTimezoneOffsetMinutes(deviceTimezone, refDate);
    let viewerTotalMinutes = utcMinutes + viewerOffset;

    // Handle day wraparound
    if (viewerTotalMinutes < 0) {
      viewerTotalMinutes += 24 * 60;
    } else if (viewerTotalMinutes >= 24 * 60) {
      viewerTotalMinutes -= 24 * 60;
    }

    const viewerHours = Math.floor(viewerTotalMinutes / 60);
    const viewerMinutes = viewerTotalMinutes % 60;
    const viewerPeriod = viewerHours >= 12 ? 'PM' : 'AM';
    const viewerHour12 = viewerHours % 12 || 12;
    const viewerTzAbbr = getTimezoneAbbreviation(deviceTimezone);
    const secondaryTime = `${viewerHour12}:${viewerMinutes.toString().padStart(2, '0')} ${viewerPeriod} ${viewerTzAbbr}`;

    return { primaryTime, secondaryTime };
  } catch {
    return { primaryTime: timeString, secondaryTime: null };
  }
}

/**
 * Format an event time for compact display (e.g., in calendar cards)
 * Shows just the time with timezone abbreviation: "2:00 PM CT"
 *
 * @param timeString - Time from database (HH:MM or HH:MM:SS format) - already in care recipient's TZ
 * @param careRecipientTimezone - The care recipient's IANA timezone
 * @returns Formatted time string with timezone abbreviation
 */
export function formatEventTimeCompact(
  timeString: string,
  careRecipientTimezone: string
): string {
  try {
    const [hoursStr, minutesStr] = timeString.split(':');
    const hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);

    if (isNaN(hours) || isNaN(minutes)) {
      return timeString;
    }

    // Format directly - time is already in care recipient's timezone
    const period = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${period} ${getTimezoneAbbreviation(careRecipientTimezone)}`;
  } catch {
    return timeString;
  }
}

/**
 * Syncs the device timezone to the user's profile.
 * Only sets timezone if user doesn't have one set (null).
 *
 * This is a fallback for users who registered before we added timezone to signup.
 * New users get their timezone set during registration.
 * Users can change their timezone from the profile page.
 */
export async function syncDeviceTimezone(): Promise<void> {
  try {
    const deviceTimezone = getDeviceTimezone();

    if (!deviceTimezone) {
      devLog('[Timezone] Could not detect device timezone');
      return;
    }

    // Check if user already has a timezone set
    const currentUser = await getCurrentUser();
    if (currentUser.timezone) {
      devLog(`[Timezone] User already has timezone set: ${currentUser.timezone}, skipping sync`);
      return;
    }

    // Only set if null - this handles legacy users who registered before timezone was captured
    devLog(`[Timezone] No timezone set, setting to device timezone: ${deviceTimezone}`);
    await updateProfile({ timezone: deviceTimezone });
    devLog('[Timezone] Successfully set timezone');
  } catch (error) {
    // Non-critical - don't fail auth if timezone sync fails
    devError('[Timezone] Failed to sync timezone:', error);
  }
}

/**
 * Determine if a date string represents "today", "yesterday", or neither
 * in the care recipient's timezone.
 *
 * Used for section headers in medication history. The date strings come from
 * scheduled_date which is in the care recipient's timezone. We must compare
 * with "today" and "yesterday" IN THAT TIMEZONE, not in the device's local time.
 *
 * @param dateString - YYYY-MM-DD date in care recipient's timezone
 * @param careRecipientTimezone - IANA timezone of the care recipient
 * @param now - Current time (defaults to new Date())
 * @returns 'today' | 'yesterday' | null
 */
export function getRelativeDateLabel(
  dateString: string,
  careRecipientTimezone: string,
  now: Date = new Date()
): 'today' | 'yesterday' | null {
  try {
    // Get today's date in the care recipient's timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: careRecipientTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayInRecipientTZ = formatter.format(now); // YYYY-MM-DD

    if (dateString === todayInRecipientTZ) return 'today';

    // Get yesterday in the care recipient's timezone
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayInRecipientTZ = formatter.format(yesterday);

    if (dateString === yesterdayInRecipientTZ) return 'yesterday';

    return null;
  } catch {
    return null;
  }
}

/**
 * Get the YYYY-MM-DD date string for a given moment in a specific timezone.
 * Uses Intl.DateTimeFormat with 'en-CA' locale which produces YYYY-MM-DD format.
 *
 * @param timezone - IANA timezone string
 * @param date - Date to convert (defaults to now)
 * @returns Date string in YYYY-MM-DD format
 */
export function getDateInTimezone(timezone: string, date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    // Fallback to device-local
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

/**
 * Check if an event is past due, comparing times in the care recipient's timezone.
 *
 * Times in the database (scheduled_date, scheduled_time) are stored in the
 * care recipient's timezone. To determine "past due" we must compare the
 * current time IN THAT TIMEZONE — not in the device's local time.
 *
 * @param scheduledDate - YYYY-MM-DD in care recipient's timezone
 * @param scheduledTime - HH:MM or HH:MM:SS in care recipient's timezone, or null for all-day
 * @param careRecipientTimezone - IANA timezone of the care recipient
 * @param now - Current time (defaults to new Date())
 * @returns true if the event's scheduled time has passed in the care recipient's timezone
 */
export function isEventPastDue(
  scheduledDate: string,
  scheduledTime: string | null,
  careRecipientTimezone: string,
  now: Date = new Date()
): boolean {
  try {
    // Get today's date in the care recipient's timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: careRecipientTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayInRecipientTZ = formatter.format(now); // YYYY-MM-DD

    // If scheduled date is in the future, not past due
    if (scheduledDate > todayInRecipientTZ) return false;

    // If scheduled date is in the past, it's past due
    if (scheduledDate < todayInRecipientTZ) {
      return true;
    }

    // scheduledDate === today in recipient's timezone
    if (!scheduledTime) {
      // All-day event on today — not past due yet
      return false;
    }

    // Get current time in care recipient's timezone
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: careRecipientTimezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = timeFormatter.formatToParts(now);
    const currentHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const currentMinute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    // Parse scheduled time
    const [hoursStr, minutesStr] = scheduledTime.split(':');
    const scheduledTotalMinutes = parseInt(hoursStr, 10) * 60 + parseInt(minutesStr, 10);

    // Past due if current time is strictly after scheduled time
    return currentTotalMinutes > scheduledTotalMinutes;
  } catch {
    return false;
  }
}

/**
 * Get the current time as fractional hours in a specific timezone.
 * E.g., 14:30 → 14.5. Used for positioning the current-time indicator
 * on the schedule view.
 *
 * @param timezone - IANA timezone string
 * @param now - Current time (defaults to new Date())
 * @returns Fractional hours (0–23.999...)
 */
export function getCurrentHoursInTimezone(timezone: string, now: Date = new Date()): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);

    // Handle hour 24 (midnight) returned by some Intl implementations
    const normalizedHour = hour === 24 ? 0 : hour;

    return normalizedHour + minute / 60;
  } catch {
    // Fallback to device local time
    return now.getHours() + now.getMinutes() / 60;
  }
}

// ─── WRITE-SIDE FORMATTERS ─────────────────────────────────────────────────
// Times/dates a form SENDS must be the care recipient's local naive value, never
// device-local. These mirror mobile's AddEventScreen handleSubmit (~lines
// 925-948) — read the instant `date` AS SEEN IN `timeZone` via
// Intl.DateTimeFormat formatToParts. NEVER use `new Date(`${d}T${t}`)`,
// `.getHours()`, `.split('T')[0]`, or `toLocaleDateString()` without `timeZone`.

/**
 * Format the time-of-day of an instant AS SEEN IN a timezone, for the API.
 *
 * Returns a 24-hour `"HH:MM"` string. The backend stores scheduled_time as a
 * naive local TIME in the care recipient's timezone, so we render the instant
 * `date` in that timezone rather than the device's local time.
 *
 * @param date - The instant to format
 * @param timeZone - IANA timezone to render the instant in
 * @returns Time string in "HH:MM" (24h) format
 */
export function formatTimeForAPI(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(date);

  let hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';

  // Some engines emit "24" for midnight under hour12:false — normalize to "00".
  if (hour === '24') {
    hour = '00';
  }

  return `${hour}:${minute}`;
}

/**
 * Format BOTH the date (YYYY-MM-DD) and time (HH:MM) of an instant AS SEEN IN a
 * timezone, for the API.
 *
 * Both halves are recomputed from the SAME instant `date` in `timeZone`, so a
 * timezone shift that crosses midnight is handled correctly: e.g. 9:00 PM on
 * date D in America/Denver is the next calendar day in America/New_York, and the
 * returned `scheduled_date` reflects D+1 (not D).
 *
 * @param date - The combined date+time instant to format
 * @param timeZone - The care recipient's IANA timezone
 * @returns `{ scheduled_date, scheduled_time }` both in the recipient's timezone
 */
export function formatDateTimeForAPI(
  date: Date,
  timeZone: string
): { scheduled_date: string; scheduled_time: string } {
  return {
    scheduled_date: getDateInTimezone(timeZone, date),
    scheduled_time: formatTimeForAPI(date, timeZone),
  };
}
