import { z } from 'zod';
import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/users.ts + mobile/src/hooks/useUnitPreferences.ts.
// The apiClient response interceptor already unwraps to the
// `{ success, data, error }` envelope, so `response.data.user` is the payload.
//
// Web-side Zod schemas DUPLICATE the inline backend route schemas
// (backend/src/routes/users.ts) so the client and server agree on field rules.

export interface NotificationPreferences {
  medication_confirmations: boolean;
  missed_medications: boolean;
  task_assignments: boolean;
  appointment_reminders: boolean;
  activity_updates: boolean;
  chat_messages: boolean;
  note_nudges: boolean;
  tips_and_suggestions?: boolean;
}

export interface User {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  timezone?: string;
  language?: string; // User's preferred language (en, es)
  // Device 12/24-hour clock, synced by the user's PHONE (expo-localization).
  // NULL/absent = never synced → resolveHourCycle() falls back to inference.
  // The web can never set this: no browser API exposes the OS clock toggle.
  uses_24h_clock?: boolean | null;
  notification_preferences: NotificationPreferences;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  email_digest_enabled?: boolean;
  email_digest_day?: number; // 0=Sunday, 1=Monday, etc.
  /**
   * THE ACCOUNT'S half of the analytics consent decision. `GET /users/me` has
   * returned both columns all along (backend/src/routes/users.ts, the
   * `/users/me` select list) — `getCurrentUser` is an untyped passthrough, so
   * they have been arriving and being discarded.
   *
   * THREE STATES, and the third is the reason these are typed as they are:
   *   - a STRING is a stamp: the account withdrew / granted at that moment.
   *   - `null` is the backend answering "no stamp".
   *   - `undefined` is the backend NOT ANSWERING — a build that predates the
   *     columns. It is NOT "no decision", and reading it as one lets a stale
   *     backend overwrite a real decision on every page load.
   *
   * Never read these with a falsy check. `lib/analyticsConsentServerReconcile`
   * is the one place that interprets them; go through `deriveServerConsent`.
   */
  analytics_consent_withdrawn_at?: string | null;
  analytics_consent_granted_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UnitPreferences {
  weight_unit: 'lbs' | 'kg';
  glucose_unit: 'mg/dL' | 'mmol/L';
}

// ---------------------------------------------------------------------------
// Web Zod schemas — mirror backend/src/routes/users.ts inline schemas exactly.
// ---------------------------------------------------------------------------

// updateProfileSchema (backend lines ~61-66)
export const updateProfileSchema = z.object({
  first_name: z.string().min(1).max(50).optional(),
  last_name: z.string().max(50).optional(),
  timezone: z.string().optional(),
  language: z.enum(['en', 'es']).optional(),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;

// updateNotificationPreferencesSchema (backend lines ~69-77). Every field is an
// optional boolean — only the flags the user toggled are sent.
export const updateNotificationPreferencesSchema = z.object({
  medication_reminders: z.boolean().optional(),
  medication_confirmations: z.boolean().optional(),
  missed_medications: z.boolean().optional(),
  task_assignments: z.boolean().optional(),
  appointment_reminders: z.boolean().optional(),
  note_nudges: z.boolean().optional(),
  tips_and_suggestions: z.boolean().optional(),
});
export type UpdateNotificationPreferencesRequest = z.infer<
  typeof updateNotificationPreferencesSchema
>;

// updateQuietHoursSchema (backend lines ~81-84). Both values nullable to disable.
//
// quiet_hours_start/end are Postgres TIME columns, so the API serializes them
// back as "22:00:00" (with seconds). Clients hydrate that value into local state
// and send it back UNCHANGED for whichever field the user did not edit, so this
// must accept HH:MM:SS as well as HH:MM — the old HH:MM-only regex is what made
// "edit one time, keep the other" fail with a 400. Mirrors the backend's
// `timeOfDay` (backend/src/routes/users.ts): the value is normalized back to
// HH:MM so the canonical form is what travels, and the hour/minute/second ranges
// are now enforced (the old \d{2}:\d{2} regex happily accepted "99:99").
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM or HH:MM:SS (24-hour)')
  .transform((v) => v.slice(0, 5));

export const updateQuietHoursSchema = z.object({
  quiet_hours_start: timeOfDay.nullable(),
  quiet_hours_end: timeOfDay.nullable(),
});
export type UpdateQuietHoursRequest = z.infer<typeof updateQuietHoursSchema>;

// updateUnitPreferencesSchema (backend lines ~55-58).
export const updateUnitPreferencesSchema = z.object({
  weight_unit: z.enum(['lbs', 'kg']).optional(),
  glucose_unit: z.enum(['mg/dL', 'mmol/L']).optional(),
});
export type UpdateUnitPreferencesRequest = z.infer<typeof updateUnitPreferencesSchema>;

// updateEmailDigestSchema (backend lines ~87-90).
export const updateEmailDigestSchema = z.object({
  enabled: z.boolean(),
  day: z.number().min(0).max(6).optional(), // 0=Sunday, 6=Saturday
});
export type UpdateEmailDigestRequest = z.infer<typeof updateEmailDigestSchema>;

interface UserEnvelope {
  success: boolean;
  data: { user: User };
}

interface UnitPreferencesEnvelope {
  success: boolean;
  data: UnitPreferences;
}

export async function getCurrentUser(): Promise<User> {
  const response = (await apiClient.get('/users/me')) as unknown as UserEnvelope;
  return response.data.user;
}

/** PATCH /users/me — name / timezone / language. */
export async function updateProfile(data: UpdateProfileRequest): Promise<User> {
  const response = (await apiClient.patch('/users/me', data)) as unknown as UserEnvelope;
  return response.data.user;
}

/** PATCH /users/me/notification-preferences — partial boolean flags. */
export async function updateNotificationPrefs(
  data: UpdateNotificationPreferencesRequest
): Promise<User> {
  const response = (await apiClient.patch(
    '/users/me/notification-preferences',
    data
  )) as unknown as UserEnvelope;
  return response.data.user;
}

/** PATCH /users/me/quiet-hours — both values nullable to disable. */
export async function updateQuietHours(data: UpdateQuietHoursRequest): Promise<User> {
  const response = (await apiClient.patch(
    '/users/me/quiet-hours',
    data
  )) as unknown as UserEnvelope;
  return response.data.user;
}

/** PUT /users/me/unit-preferences — returns the bare prefs (not a user). */
export async function updateUnitPreferences(
  data: UpdateUnitPreferencesRequest
): Promise<UnitPreferences> {
  const response = (await apiClient.put(
    '/users/me/unit-preferences',
    data
  )) as unknown as UnitPreferencesEnvelope;
  return response.data;
}

/** GET /users/me/unit-preferences. */
export async function getUnitPreferences(): Promise<UnitPreferences> {
  const response = (await apiClient.get(
    '/users/me/unit-preferences'
  )) as unknown as UnitPreferencesEnvelope;
  return response.data;
}

/**
 * PATCH /users/me/email-digest — Premium feature. Enabling on a FREE tier
 * rejects with 402 SUBSCRIPTION_REQUIRED (the hook surfaces "open the app to
 * upgrade"); disabling is always allowed.
 */
export async function updateEmailDigest(data: UpdateEmailDigestRequest): Promise<User> {
  const response = (await apiClient.patch(
    '/users/me/email-digest',
    data
  )) as unknown as UserEnvelope;
  return response.data.user;
}

/** DELETE /users/me — authenticated account deletion (soft-delete server-side). */
export async function deleteAccount(): Promise<void> {
  await apiClient.delete('/users/me');
}

/**
 * Tell the server the user withdrew analytics consent, so their PostHog person
 * and events are deleted server-side and every future server-originated
 * capture is suppressed (POST /users/me/withdraw-analytics-consent).
 *
 * Rides alongside a settings toggle — the local teardown (disableAnalytics +
 * writing the local flag) has already happened by the time this is called.
 * A privacy action must never surface an error, so this never throws; the
 * result IS reported (true/false) so `analyticsConsentSync` can tell delivery
 * from failure and retry rather than silently dropping the decision.
 */
export async function withdrawAnalyticsConsent(): Promise<boolean> {
  try {
    await apiClient.post('/users/me/withdraw-analytics-consent');
    return true;
  } catch {
    return false;
  }
}

/**
 * Tell the server the user granted analytics consent again, clearing the
 * `analytics_consent_withdrawn_at` stamp that suppresses server-side capture
 * (POST /users/me/restore-analytics-consent).
 *
 * Same shape as its sibling above: never throws, reports true/false so a
 * failed restore can be retried instead of silently lapsing.
 */
export async function restoreAnalyticsConsent(): Promise<boolean> {
  try {
    await apiClient.post('/users/me/restore-analytics-consent');
    return true;
  } catch {
    return false;
  }
}

/**
 * With `responseType: 'blob'` axios parses ERROR bodies as Blobs too, so the
 * response interceptor's rejection (`error.response.data`) is a Blob instead of
 * the usual `{ success, error: { code } }` envelope. Re-hydrate it so callers
 * can classify the failure (e.g. `isRateLimitError`).
 */
async function normalizeBlobRejection(err: unknown): Promise<unknown> {
  if (!(err instanceof Blob)) return err;
  try {
    return JSON.parse(await err.text()) as unknown;
  } catch {
    return err; // Not JSON — surface the original rejection.
  }
}

/**
 * GET /users/me/export — GDPR "download my data" export. The backend returns
 * the full export as a JSON attachment, so this requests a BLOB; the response
 * interceptor's envelope-unwrap (`response.data`) yields the Blob itself.
 * Rate-limited server-side (5 exports/day) — a 429 rejects with the
 * `RATE_LIMIT` envelope (see normalizeBlobRejection above).
 */
export async function exportUserData(): Promise<Blob> {
  try {
    return (await apiClient.get('/users/me/export', {
      responseType: 'blob',
    })) as unknown as Blob;
  } catch (err) {
    return Promise.reject(await normalizeBlobRejection(err));
  }
}
