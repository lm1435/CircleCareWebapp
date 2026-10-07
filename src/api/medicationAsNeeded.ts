import { apiClient } from '@/lib/api';

// As-needed (PRN) medication doses — docs/plans/prn-api-contract.md.
//
// A PRN medication has NO schedule: a person logging a dose is the event. There
// are NO limits by owner decision (2026-10-05): no minimum interval, no
// maximum, no counters. The summary carries only the last live dose.
//
// `given_at` is a real INSTANT. Render it in the CARE RECIPIENT's zone with the
// app's own helpers, never the browser's.
//
// apiClient's response interceptor unwraps axios' response.data, so every
// resolved value IS the `{ success, data }` envelope, and a rejection IS the
// backend envelope (`err.error.code`).

export interface AsNeededPerson {
  id: string;
  first_name: string | null;
  last_name: string | null;
  /** Absent for a person who has left the circle (and on `removed_by_user`). */
  email?: string | null;
}

export interface AsNeededDose {
  id: string;
  event_id: string;
  circle_id: string;
  /** ISO instant the dose was given. */
  given_at: string;
  given_by: string;
  note: string | null;
  client_request_id: string;
  created_at: string;
  removed_at: string | null;
  removed_by: string | null;
  given_by_user?: AsNeededPerson | null;
  removed_by_user?: AsNeededPerson | null;
}

export interface AsNeededLastDose {
  id: string;
  given_at: string;
  given_by: { id: string; first_name: string | null; last_name: string | null };
  note: string | null;
}

/** Per-medication summary: ONLY the last live dose. No counters, no limits. */
export interface AsNeededSummary {
  last_dose: AsNeededLastDose | null;
}

export interface LogAsNeededDoseRequest {
  /** Idempotency key. REQUIRED: generated when the dialog opens, reused on every retry. */
  client_request_id: string;
  /** ISO instant; omitted = now. Server accepts [now-48h, now+2min]. */
  given_at?: string;
  note?: string | null;
  /** The newest live dose id this client rendered (null when it showed none). */
  known_last_dose_id?: string | null;
  /** True after the user saw the "just logged" prompt and chose to log another. */
  acknowledge_recent?: boolean;
}

export interface LogAsNeededDoseResult {
  dose: AsNeededDose;
  summary: AsNeededSummary;
  /** True when the server recognised the `client_request_id` (no second write, no push). */
  replayed: boolean;
}

export interface AsNeededDoseWithEvent extends AsNeededDose {
  event?: {
    id: string;
    title: string;
    medication_name: string | null;
    medication_dosage: string | null;
  };
}

export interface AsNeededDosesPage {
  doses: AsNeededDose[];
  hasMore: boolean;
}

export interface AsNeededDosesParams {
  /** YYYY-MM-DD, recipient zone. */
  start_date?: string;
  end_date?: string;
  limit?: number;
  offset?: number;
  includeRemoved?: boolean;
}

export const AS_NEEDED_BACKDATE_LIMIT_HOURS = 48;

interface Envelope<T> {
  success: boolean;
  data: T;
}

/** GET /medications/as-needed/summary → one entry per ACTIVE as-needed medication. */
export async function getAsNeededSummaries(
  circleId: string
): Promise<Record<string, AsNeededSummary>> {
  const response = (await apiClient.get(
    `/circles/${circleId}/medications/as-needed/summary`
  )) as unknown as Envelope<{ summaries: Record<string, AsNeededSummary> }>;
  return response.data.summaries ?? {};
}

/** POST /medications/:eventId/as-needed-doses */
export async function logAsNeededDose(
  circleId: string,
  eventId: string,
  body: LogAsNeededDoseRequest
): Promise<LogAsNeededDoseResult> {
  const response = (await apiClient.post(
    `/circles/${circleId}/medications/${eventId}/as-needed-doses`,
    body
  )) as unknown as Envelope<{ dose: AsNeededDose; summary: AsNeededSummary; replayed?: boolean }>;
  return {
    dose: response.data.dose,
    summary: response.data.summary,
    replayed: response.data.replayed === true,
  };
}

/** GET /medications/:eventId/as-needed-doses — newest first. */
export async function getAsNeededDoses(
  circleId: string,
  eventId: string,
  params?: AsNeededDosesParams
): Promise<AsNeededDosesPage> {
  const query: Record<string, string | number> = {};
  if (params?.start_date) query.start_date = params.start_date;
  if (params?.end_date) query.end_date = params.end_date;
  if (params?.limit) query.limit = params.limit;
  if (params?.offset) query.offset = params.offset;
  // The backend reads the literal 'true' only.
  if (params?.includeRemoved) query.includeRemoved = 'true';
  const response = (await apiClient.get(
    `/circles/${circleId}/medications/${eventId}/as-needed-doses`,
    { params: query }
  )) as unknown as Envelope<AsNeededDosesPage>;
  return { doses: response.data.doses ?? [], hasMore: response.data.hasMore === true };
}

/** GET /medications/as-needed-doses — every medication's doses, newest first. */
export async function getCircleAsNeededDoses(
  circleId: string,
  params?: AsNeededDosesParams
): Promise<{ doses: AsNeededDoseWithEvent[]; hasMore: boolean }> {
  const query: Record<string, string | number> = {};
  if (params?.start_date) query.start_date = params.start_date;
  if (params?.end_date) query.end_date = params.end_date;
  if (params?.limit) query.limit = params.limit;
  if (params?.offset) query.offset = params.offset;
  if (params?.includeRemoved) query.includeRemoved = 'true';
  const response = (await apiClient.get(`/circles/${circleId}/medications/as-needed-doses`, {
    params: query,
  })) as unknown as Envelope<{ doses: AsNeededDoseWithEvent[]; hasMore: boolean }>;
  return { doses: response.data.doses ?? [], hasMore: response.data.hasMore === true };
}

/** POST /medications/:eventId/as-needed-doses/:doseId/remove — tombstone. */
export async function removeAsNeededDose(
  circleId: string,
  eventId: string,
  doseId: string
): Promise<{ dose: AsNeededDose; summary: AsNeededSummary }> {
  const response = (await apiClient.post(
    `/circles/${circleId}/medications/${eventId}/as-needed-doses/${doseId}/remove`,
    {}
  )) as unknown as Envelope<{ dose: AsNeededDose; summary: AsNeededSummary }>;
  return response.data;
}

// ---------------------------------------------------------------------------
// Error classification (read `err.error.code`)
// ---------------------------------------------------------------------------

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    latest_dose?: {
      id?: string;
      given_at?: string;
      given_by?: { first_name?: string | null };
    };
  };
}

function code(err: unknown): string | undefined {
  const c = (err as ErrorEnvelope | null)?.error?.code;
  return typeof c === 'string' ? c : undefined;
}

export interface RecentlyLoggedConflict {
  /** First name of the member who logged the other dose (null when unknown). */
  firstName: string | null;
  /** ISO instant of that dose. */
  givenAt: string | null;
  doseId: string | null;
}

/**
 * 409 `AS_NEEDED_DOSE_RECENTLY_LOGGED`: another member logged this medication
 * within 30 minutes. Not a failure — the caller asks "Log another?" and, on yes,
 * re-sends the SAME `client_request_id` with `acknowledge_recent: true`.
 */
export function asNeededRecentlyLogged(err: unknown): RecentlyLoggedConflict | null {
  if (code(err) !== 'AS_NEEDED_DOSE_RECENTLY_LOGGED') return null;
  const latest = (err as ErrorEnvelope).error?.latest_dose;
  return {
    firstName: latest?.given_by?.first_name?.trim() || null,
    givenAt: typeof latest?.given_at === 'string' ? latest.given_at : null,
    doseId: typeof latest?.id === 'string' ? latest.id : null,
  };
}

export const isAsNeededAlreadyRemovedError = (err: unknown): boolean =>
  code(err) === 'ALREADY_REMOVED';
export const isAsNeededNotFoundError = (err: unknown): boolean => code(err) === 'NOT_FOUND';
export const isAsNeededTooOldError = (err: unknown): boolean => code(err) === 'GIVEN_AT_TOO_OLD';
export const isAsNeededFutureError = (err: unknown): boolean => code(err) === 'GIVEN_AT_IN_FUTURE';
export const isAsNeededImmutableError = (err: unknown): boolean =>
  code(err) === 'AS_NEEDED_IMMUTABLE';
export const isAsNeededUnscheduledError = (err: unknown): boolean =>
  code(err) === 'AS_NEEDED_UNSCHEDULED';
