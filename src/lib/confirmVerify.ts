import {
  getTodaysMedications,
  type ConfirmableStatus,
  type ConfirmationStatus,
  type TodaysMedication,
} from '@/api/medicationConfirmations';
import { getEvents, type CalendarEvent } from '@/api/calendarEvents';

/**
 * VERIFY BEFORE ALERT — the web port of mobile's
 * (mobile/src/hooks/useMedicationUndo.ts `isAmbiguousConfirmFailure`,
 * `confirmVerdict`, `verifyConfirmLanded`). Test-gap audit 2026-09-29 #3.
 *
 * Production, 2026-09-10/11 (mobile): every "failed to confirm" alert in two
 * days was for a dose the server HAD recorded — the POST landed and only the
 * RESPONSE was lost (timeout, dropped connection, a 5xx after the write). Web
 * had no check at all and said "Couldn't save. Please try again." — an
 * invitation to give a second dose. Now an AMBIGUOUS rejection re-reads the
 * dose's day first:
 *
 *   recorded     -> it is not a failure: the mutation resolves (success toast).
 *   not_recorded -> the write evidently did not land: the usual error.
 *   unverified   -> we could not tell: "We couldn't check whether … was
 *                   recorded" (mobile's copy), never a claimed failure.
 *
 * A definitive refusal (any string `error.code` other than the 5xx family —
 * DOSE_ALREADY_RECORDED, MEDICATION_DISCONTINUED, VIEW_ONLY …) is reported as
 * it is, with no re-read: nothing was written.
 */
export type ConfirmFailureOutcome = 'not_recorded' | 'unverified';

/** Backend codes that do NOT prove nothing was written (mobile's set, verbatim). */
const AMBIGUOUS_SERVER_CODES: ReadonlySet<string> = new Set([
  'SERVER_ERROR',
  'INTERNAL_ERROR',
  'UPSTREAM_TIMEOUT',
]);

/**
 * True when a rejected confirm leaves the dose's fate UNKNOWN. No code at all
 * (timeout, network, a thrown client error, an edge page with a NUMERIC code)
 * or a 5xx-family code. Never throws; unreadable means ambiguous.
 */
export function isAmbiguousConfirmFailure(error: unknown): boolean {
  try {
    const code = (error as { error?: { code?: unknown } } | null | undefined)?.error?.code;
    if (typeof code === 'string' && code) return AMBIGUOUS_SERVER_CODES.has(code);
    return true;
  } catch {
    return true;
  }
}

/** The server statuses that prove what we SENT landed (`missed` never does). */
const RECORDED_AS: Record<ConfirmableStatus, ReadonlyArray<ConfirmationStatus>> = {
  taken: ['taken', 'taken_late'],
  taken_late: ['taken', 'taken_late'],
  skipped: ['skipped'],
};

/** What the server row identifying ONE dose needs: its id, day, time and series. */
export interface DoseRef {
  id: string;
  scheduled_date: string;
  scheduled_time?: string | null;
  parent_event_id?: string | null;
}

const seriesOf = (e: { id: string; parent_event_id?: string | null }): string =>
  e.parent_event_id || e.id;

/**
 * What one re-read day says about `dose` (mobile's `confirmVerdict`): the exact
 * id, or the same series on the same date (a virtual row is materialized into a
 * child with a NEW id by the confirm itself). Time narrows the match when it
 * can; a single same-series candidate at another time is still this dose.
 */
export function confirmVerdict(
  events: readonly TodaysMedication[],
  dose: DoseRef,
  status: ConfirmableStatus
): 'recorded' | ConfirmFailureOutcome {
  const root = seriesOf(dose);
  const candidates = events.filter(
    (e) =>
      e != null &&
      (e.id === dose.id ||
        (seriesOf(e) === root && e.scheduled_date === dose.scheduled_date))
  );
  const sameTime = candidates.filter((e) => e.scheduled_time === dose.scheduled_time);
  const pool = sameTime.length > 0 ? sameTime : candidates.length === 1 ? candidates : [];
  if (pool.length === 0) return 'unverified';
  const accepted = RECORDED_AS[status] ?? [];
  return pool.some((e) => e.confirmation != null && accepted.includes(e.confirmation.status))
    ? 'recorded'
    : 'not_recorded';
}

/**
 * Re-read the dose's day and say whether it landed. NEVER rejects: a failed
 * or unreadable re-read is 'unverified'. Returns the matching row when
 * recorded, so the caller can hand back a real confirmation.
 */
export async function verifyConfirmLanded(
  circleId: string,
  dose: DoseRef,
  status: ConfirmableStatus
): Promise<{ verdict: 'recorded' | ConfirmFailureOutcome; row?: TodaysMedication }> {
  try {
    if (!dose.scheduled_date) return { verdict: 'unverified' };
    const events = await getTodaysMedications(circleId, dose.scheduled_date);
    if (!Array.isArray(events)) return { verdict: 'unverified' };
    const verdict = confirmVerdict(events, dose, status);
    const row =
      verdict === 'recorded'
        ? events.find(
            (e) =>
              (e.id === dose.id ||
                (seriesOf(e) === seriesOf(dose) && e.scheduled_date === dose.scheduled_date)) &&
              e.confirmation != null
          )
        : undefined;
    return { verdict, row };
  } catch {
    return { verdict: 'unverified' };
  }
}

/**
 * The verdict a failed confirm was reported with, read off the rejection.
 * `undefined` for a rejection that was never verified (a definitive refusal).
 */
const OUTCOMES = new WeakMap<object, ConfirmFailureOutcome>();

export function markConfirmFailure(error: unknown, outcome: ConfirmFailureOutcome): unknown {
  const carrier: object =
    typeof error === 'object' && error !== null ? error : new Error(String(error));
  OUTCOMES.set(carrier, outcome);
  return carrier;
}

export function confirmFailureOutcome(error: unknown): ConfirmFailureOutcome | undefined {
  return typeof error === 'object' && error !== null ? OUTCOMES.get(error) : undefined;
}

// ---------------------------------------------------------------------------
// TASK / APPOINTMENT COMPLETION — the same verify-before-alert rule, for Done.
//
// Production, 1.4.0 iOS, 2026-11-09: a task completion whose RESPONSE was lost
// (timeout / dropped connection) told the caregiver it failed, with no re-read
// of whether the completion had landed — exactly the shape doses had until
// 1.3.0. Mobile now verifies in `mobile/src/utils/confirmVerify.ts`
// (`verifyCompletionLanded`); this is the web port. Browsers do not suspend a
// page the way iOS suspends JS, but a hidden tab can be frozen (mobile Safari,
// Chrome's tab freezing), so the re-read also waits for the page to be visible
// and retries once, like mobile's.
//
// Same classifier (`isAmbiguousConfirmFailure`): a definite refusal — VIEW_ONLY,
// NOT_FOUND, INVALID_OCCURRENCE_DATE, SUBSCRIPTION_REQUIRED … — is reported as
// it is, with no re-read.
// ---------------------------------------------------------------------------

/** The occurrence a completion was for: the row the caregiver pressed. */
export interface OccurrenceRef {
  /** The row's own id — a composite `${rootId}_${date}` for a virtual occurrence. */
  id: string;
  scheduled_date: string;
  scheduled_time?: string | null;
  parent_event_id?: string | null;
  event_type?: CalendarEvent['event_type'];
}

/**
 * What one re-read day says about `occurrence`'s completion. Same matching as
 * `confirmVerdict`: the exact id (a one-off or a physical row), or the same
 * series on the same `scheduled_date` — completing a VIRTUAL occurrence
 * materializes it into a child with a NEW id. The series ROOT is never mistaken
 * for a later day's occurrence: its own `scheduled_date` is its start date.
 */
export function completionVerdict(
  events: readonly CalendarEvent[],
  occurrence: OccurrenceRef
): { verdict: 'recorded' | ConfirmFailureOutcome; row?: CalendarEvent } {
  const root = seriesOf(occurrence);
  const candidates = events.filter(
    (e) =>
      e != null &&
      (e.id === occurrence.id ||
        (seriesOf(e) === root && e.scheduled_date === occurrence.scheduled_date))
  );
  const sameTime = candidates.filter(
    (e) => (e.scheduled_time ?? null) === (occurrence.scheduled_time ?? null)
  );
  const pool = sameTime.length > 0 ? sameTime : candidates.length === 1 ? candidates : [];
  if (pool.length === 0) return { verdict: 'unverified' };
  const row = pool.find((e) => e.completed_at != null);
  return row ? { verdict: 'recorded', row } : { verdict: 'not_recorded' };
}

/** Wait after a failed re-read before the single retry (the network coming back). */
const COMPLETION_RETRY_DELAY_MS =
  typeof process !== 'undefined' && process.env?.VITEST ? 0 : 2000;

/** Resolve once the page is visible (immediately if it is). No timeout. */
function waitUntilVisible(): Promise<void> {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden') {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

/**
 * Re-read the occurrence's day and say whether the completion landed. NEVER
 * rejects: a failed (twice) or unreadable re-read is 'unverified'.
 */
export async function verifyCompletionLanded(
  circleId: string,
  occurrence: OccurrenceRef,
  options: { retryDelayMs?: number } = {}
): Promise<{ verdict: 'recorded' | ConfirmFailureOutcome; row?: CalendarEvent }> {
  try {
    if (!occurrence.scheduled_date) return { verdict: 'unverified' };
    await waitUntilVisible();
    const params = {
      start_date: occurrence.scheduled_date,
      end_date: occurrence.scheduled_date,
      ...(occurrence.event_type === 'task' || occurrence.event_type === 'appointment'
        ? { event_type: occurrence.event_type }
        : {}),
    };
    let events: CalendarEvent[];
    try {
      events = await getEvents(circleId, params);
    } catch {
      const delay = options.retryDelayMs ?? COMPLETION_RETRY_DELAY_MS;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      events = await getEvents(circleId, params);
    }
    if (!Array.isArray(events)) return { verdict: 'unverified' };
    return completionVerdict(events, occurrence);
  } catch {
    return { verdict: 'unverified' };
  }
}
