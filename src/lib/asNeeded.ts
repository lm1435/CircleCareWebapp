import {
  formatTimeOfDay,
  getCachedDateTimeFormat,
  getDateInTimezone,
  getRelativeDateLabel,
  getTimezoneSuffix,
  type TimeLanguage,
} from '@/utils/timezone';
import { clockInZone } from '@/utils/recipientEventDate';
import type { HourCycle } from '@/utils/hourCycle';
import type { AsNeededLastDose } from '@/api/medicationAsNeeded';
import { isMedicationDiscontinuedError, isPermissionDeniedError } from '@/lib/apiErrors';

// Display + decision helpers for as-needed (PRN) doses.
//
// EVERY clock reading here is in the CARE RECIPIENT's zone (`given_at` is an
// INSTANT; the viewer's browser zone must never leak in). Only the 12h/24h
// presentation and the language are the viewer's.

/** The recipient-zone wall clock of an instant, in the viewer's 12h/24h style. */
export function formatInstantClock(
  instant: Date,
  timezone: string,
  cycle: HourCycle,
  language: TimeLanguage
): string {
  const [hh, mm] = clockInZone(instant, timezone).split(':').map(Number);
  return formatTimeOfDay(hh, mm, cycle, language);
}

export interface WhenLabels {
  today: string;
  yesterday: string;
}

/**
 * "2:15 PM" (today) · "Yesterday, 9:10 PM" · "Oct 1, 9:10 PM", in the recipient's
 * frame, with the zone NAMED only when the viewer is not standing in it.
 */
export function formatGivenWhen(
  iso: string,
  timezone: string,
  cycle: HourCycle,
  language: TimeLanguage,
  labels: WhenLabels,
  now: Date = new Date()
): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const clock = formatInstantClock(at, timezone, cycle, language);
  const suffix = getTimezoneSuffix(timezone, at, { language });
  const day = getDateInTimezone(timezone, at);
  const relative = getRelativeDateLabel(day, timezone, now);
  if (relative === 'today') return `${clock}${suffix}`;
  const dayLabel =
    relative === 'yesterday'
      ? labels.yesterday
      : getCachedDateTimeFormat(language, {
          month: 'short',
          day: 'numeric',
          // Anchored at noon UTC and formatted IN UTC: a naive date must not be
          // shifted by the browser's own zone.
          timeZone: 'UTC',
        }).format(new Date(`${day}T12:00:00Z`));
  return `${dayLabel}, ${clock}${suffix}`;
}

interface PersonLike {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
}

/** A person's first name for a sentence ("by Jennie"); null when there is none. */
export function firstNameOf(person: PersonLike | null | undefined): string | null {
  const first = person?.first_name?.trim();
  if (first) return first;
  const email = person?.email?.trim();
  if (email) return email.split('@')[0] || null;
  return null;
}

/** "Jennie Ruiz" · "Jennie" · null — for the dose log, where the full name fits. */
export function fullNameOf(person: PersonLike | null | undefined): string | null {
  const full = [person?.first_name, person?.last_name]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(' ');
  if (full) return full;
  return firstNameOf(person);
}

/** Another member logged within this many minutes ⇒ ask before logging a second dose. */
export const RECENT_DOSE_WINDOW_MINUTES = 30;

/**
 * The CLIENT-SIDE half of the coordination check: the card already shows that
 * someone ELSE logged this medication in the last 30 minutes, so ask first.
 * (The server repeats the check at write time for a stale cache.) Your own dose
 * never prompts. Returns the dose to name, or null.
 */
export function recentDoseByOther(
  last: AsNeededLastDose | null | undefined,
  myUserId: string | null | undefined,
  now: Date = new Date()
): AsNeededLastDose | null {
  if (!last) return null;
  if (myUserId && last.given_by.id === myUserId) return null;
  const given = new Date(last.given_at).getTime();
  if (Number.isNaN(given)) return null;
  const minutes = (now.getTime() - given) / 60000;
  return minutes <= RECENT_DOSE_WINDOW_MINUTES ? last : null;
}

/** Whole minutes between an instant and now, never negative. */
export function minutesAgo(iso: string, now: Date = new Date()): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / 60000));
}

/** A fresh idempotency key. One per dialog open; reused on every retry of that dose. */
export function newClientRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Non-secure contexts (plain http on a LAN) have no randomUUID.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex
    .slice(8, 10)
    .join('')}-${hex.slice(10).join('')}`;
}

// ---------------------------------------------------------------------------
// Analytics bucketing — pure, so the edges are unit-tested. Whole-minute
// inputs; lower bound inclusive (60 min is "1-4h", not "<1h").
// ---------------------------------------------------------------------------

export type BackdatedBucket = 'none' | '<1h' | '1-4h' | '4-12h' | '>12h';
export type MinutesSinceLastBucket = 'first' | '<1h' | '1-4h' | '4-12h' | '12-24h' | '>24h';
export type RemovedAgeBucket = '<1h' | '<24h' | 'older';

/** How far in the past a dose was logged. 0 / undefined / non-finite = 'none'. */
export function backdatedBucket(minutes: number | null | undefined): BackdatedBucket {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) {
    return 'none';
  }
  if (minutes < 60) return '<1h';
  if (minutes < 240) return '1-4h';
  if (minutes < 720) return '4-12h';
  return '>12h';
}

/** Gap since the previous live dose, known at log time. null = no previous dose. */
export function minutesSinceLastBucket(minutes: number | null | undefined): MinutesSinceLastBucket {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return 'first';
  if (minutes < 60) return '<1h';
  if (minutes < 240) return '1-4h';
  if (minutes < 720) return '4-12h';
  if (minutes < 1440) return '12-24h';
  return '>24h';
}

/** Age of a dose (given_at) at the moment it is removed. */
export function removedAgeBucket(minutes: number): RemovedAgeBucket {
  if (!Number.isFinite(minutes)) return 'older';
  if (minutes < 60) return '<1h';
  if (minutes < 1440) return '<24h';
  return 'older';
}

export type LogFailureReason = 'network' | 'discontinued' | 'permission' | 'error';

/**
 * The analytics bucket for a failed dose log. No server envelope at all (timeout,
 * dropped connection) is 'network'; a coded refusal is classified by code.
 */
export function logFailureReason(error: unknown): LogFailureReason {
  const code = (error as { error?: { code?: unknown } } | null | undefined)?.error?.code;
  if (typeof code !== 'string' || !code) return 'network';
  if (isPermissionDeniedError(error)) return 'permission';
  if (isMedicationDiscontinuedError(error)) return 'discontinued';
  return 'error';
}
