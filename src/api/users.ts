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
  notification_preferences: NotificationPreferences;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  email_digest_enabled?: boolean;
  email_digest_day?: number; // 0=Sunday, 1=Monday, etc.
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
export const updateQuietHoursSchema = z.object({
  quiet_hours_start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
  quiet_hours_end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
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
