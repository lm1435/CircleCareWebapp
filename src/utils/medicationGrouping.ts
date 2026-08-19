import type { CalendarEvent } from '@/api/calendarEvents';
import { getDateInTimezone } from '@/utils/timezone';

// PORT of mobile/src/utils/medicationGrouping.ts (verbatim semantics). The web
// Medications page and DiscontinueMedDialog group/act on medications with these
// exact keys so mobile and web always agree on what "one medication" is.

/**
 * Composite grouping key for a medication: name + dosage, normalized.
 *
 * Same name + same dosage (at any number of scheduled times / series) is ONE
 * medication. Same name + a DIFFERENT dosage is a separate medication. This is
 * the key the Medications page groups/dedups by, and the key discontinue/
 * reactivate act on so all series of one medication toggle together.
 *
 * Internal whitespace is REMOVED (not just collapsed) before lowercasing so
 * "10mg", "10 mg", and "10  mg" all normalize to the same dose — otherwise one
 * real medication splits into two cards (the "discontinue one, the other stays
 * active" confusion). Removal (vs collapse-to-single-space) is required because
 * "10mg" (no space) and "10 mg" (one space) must match.
 */
const normalize = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

export function getMedKey(
  event: Pick<CalendarEvent, 'medication_name' | 'title' | 'medication_dosage'>
): string {
  const name = normalize(event.medication_name || event.title || '');
  const dose = normalize(event.medication_dosage || '');
  return `${name}|${dose}`;
}

/**
 * Series-root id for a single event: the parent series root when the event is a
 * child/virtual instance, otherwise its own id. Discontinue/reactivate target
 * the root (the backend also resolves the root from any child id).
 */
export function getSeriesRoot(event: Pick<CalendarEvent, 'id' | 'parent_event_id'>): string {
  return event.parent_event_id ?? event.id;
}

// NOTE — there is deliberately no `getSeriesRootsForMed` here any more.
// Enumerating a medication's sibling series CLIENT-side could only ever read
// the loaded pool (a calendar week/month window, or the roster), so a series
// outside that pool was silently skipped while the UI reported success. Whole-
// medication discontinue/reactivate is now ONE request with
// `scope: 'medication'` and the server — which has no window — resolves every
// matching root by the same normalized name+dosage key `getMedKey` builds.

// ---------------------------------------------------------------------------
// Analytics facts (PHI-safe by construction)
// ---------------------------------------------------------------------------
//
// PORT of mobile/src/utils/medicationGrouping.ts's getMedSeriesAnalyticsFacts —
// same inputs, same outputs, so `medication_discontinued` means the same thing
// whichever platform sent it.

/**
 * Everything the medication-lifecycle analytics events need to describe a
 * discontinue/reactivate WITHOUT touching any free text.
 *
 * A whole-day duration and a boolean only — never the medication name, dosage,
 * title or notes. See `Analytics.medicationDiscontinued`.
 *
 * `series_count` is deliberately NOT here: it now comes back from the
 * medication-status response (`scope: 'medication'`), which counts the roots
 * the SERVER mutated rather than the ones a loaded window happened to hold.
 */
export interface MedSeriesAnalyticsFacts {
  /**
   * Whole days from the earliest KNOWN scheduled date of this medication to
   * today, evaluated in the care recipient's timezone. Never negative.
   */
  daysActive: number;
  /**
   * Whether any LOADED occurrence of this medication carries a dose
   * confirmation.
   *
   * Honest floor, not proof of absence: it is derived from the same event pool
   * that resolves the series roots (a calendar window, or the Medications
   * roster), so a med whose only confirmations fall outside that pool reports
   * `false`. Deliberate — the alternative is an extra round-trip inside a
   * mutation path, and "is real history being preserved?" is answered well
   * enough by a lower bound.
   */
  hadConfirmations: boolean;
}

/** A YYYY-MM-DD string we are willing to do date math on. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse "YYYY-MM-DD" -> Date at UTC noon (avoids any DST / offset edge). */
function toUTCNoon(dateStr: string): Date {
  return new Date(dateStr + 'T12:00:00Z');
}

/** Whole-day difference (endStr - startStr), UTC-anchored and DST-proof. */
function daysBetween(startStr: string, endStr: string): number {
  return Math.round(
    (toUTCNoon(endStr).getTime() - toUTCNoon(startStr).getTime()) / (1000 * 60 * 60 * 24)
  );
}

/**
 * Derive the PHI-safe analytics facts for a discontinue/reactivate of `medEvent`.
 *
 * `allEvents` is whatever pool the caller has loaded (a calendar window or the
 * medication roster) — it bounds `hadConfirmations` and the earliest known
 * start date, and nothing else. The series COUNT comes from the server.
 *
 * Timezone rule (project-wide): scheduled dates are naive local dates in the
 * care recipient's timezone, so "today" must be resolved with
 * `getDateInTimezone` and the difference taken with the UTC-anchored
 * `daysBetween` — never `getHours()`, `split('T')[0]` or `toLocaleDateString`.
 *
 * Never throws: analytics must not be able to break a mutation, so anything
 * unexpected degrades to zeros/false rather than propagating.
 */
export function getMedSeriesAnalyticsFacts(
  allEvents: CalendarEvent[] | undefined,
  medEvent: CalendarEvent,
  careRecipientTimezone: string
): MedSeriesAnalyticsFacts {
  try {
    const targetKey = getMedKey(medEvent);
    const matching: CalendarEvent[] = [medEvent];
    (allEvents || []).forEach((e) => {
      if (e.event_type !== 'medication') return;
      if (getMedKey(e) !== targetKey) return;
      matching.push(e);
    });

    const hadConfirmations = matching.some((e) => !!e.confirmation);

    // YYYY-MM-DD sorts lexicographically, so the earliest start needs no Date.
    const startDates = matching
      .map((e) => e.scheduled_date)
      .filter((d): d is string => typeof d === 'string' && ISO_DATE.test(d))
      .sort();
    const earliest = startDates[0];

    const today = getDateInTimezone(careRecipientTimezone);
    const rawDays =
      earliest && ISO_DATE.test(today) ? Math.max(0, daysBetween(earliest, today)) : 0;

    return {
      daysActive: Number.isFinite(rawDays) ? rawDays : 0,
      hadConfirmations,
    };
  } catch {
    return { daysActive: 0, hadConfirmations: false };
  }
}
