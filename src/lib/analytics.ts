import posthog from 'posthog-js';
import { env } from './env';

/**
 * Typed analytics wrapper for the web companion — mirrors mobile's
 * `Analytics` object (mobile/src/services/analytics.ts) so the SAME event names
 * land in the SAME PostHog project, separated only by the `platform: 'web'`
 * super-property registered in lib/posthog.ts.
 *
 * PHI RULES (match mobile):
 * - Event properties carry ONLY ids (circle_id, event_id), counts, enums
 *   (role, event_type, method, status, category, vital_type), booleans, and
 *   short error codes/messages.
 * - NEVER names, emails, DOB, medication names, health conditions, note/message
 *   text, or AI prompt/response text.
 *
 * OPTIONAL: PostHog has no API key in many environments. `capture` no-ops
 * safely when uninitialized (guarded on `env.VITE_POSTHOG_KEY`, the same signal
 * `initAnalytics` uses), so every call below is safe to make unconditionally.
 */
function capture(event: string, props?: Record<string, unknown>): void {
  if (!env.VITE_POSTHOG_KEY) return;
  posthog.capture(event, props);
}

type AuthMethod = 'email' | 'google' | 'apple';
type MedicationStatus = 'taken' | 'taken_late' | 'skipped';

export const Analytics = {
  // --- Auth ---
  signupStarted: (method: AuthMethod) => capture('signup_started', { method }),
  signupCompleted: (method: AuthMethod) => capture('signup_completed', { method }),
  signupFailed: (method: AuthMethod, error: string) => capture('signup_failed', { method, error }),

  loginStarted: (method: AuthMethod) => capture('login_started', { method }),
  loginCompleted: (method: AuthMethod) => capture('login_completed', { method }),
  loginFailed: (method: AuthMethod, error: string) => capture('login_failed', { method, error }),

  logout: () => capture('logout'),

  // --- Circles ---
  circleCreationStarted: () => capture('circle_creation_started'),
  circleCreated: (isSelfCare: boolean) => capture('circle_created', { is_self_care: isSelfCare }),
  circleCreationFailed: (error: string) => capture('circle_creation_failed', { error }),
  circleViewed: (circleId: string) => capture('circle_viewed', { circle_id: circleId }),

  // --- Invites ---
  inviteStarted: (circleId: string) => capture('invite_started', { circle_id: circleId }),
  inviteSent: (circleId: string, role: string) =>
    capture('invite_sent', { circle_id: circleId, role }),
  inviteFailed: (circleId: string, error: string) =>
    capture('invite_failed', { circle_id: circleId, error }),
  inviteAccepted: (circleId: string) => capture('invite_accepted', { circle_id: circleId }),

  // --- Medications ---
  medicationConfirmed: (circleId: string, status: MedicationStatus) =>
    capture('medication_confirmed', { circle_id: circleId, status }),

  // --- Calendar & events ---
  eventCreated: (circleId: string, eventType: string, recurring: boolean) =>
    capture('event_created', { circle_id: circleId, event_type: eventType, recurring }),
  taskCompleted: (circleId: string) => capture('task_completed', { circle_id: circleId }),
  taskUndone: (circleId: string) => capture('task_undone', { circle_id: circleId }),
  appointmentCompleted: (circleId: string) =>
    capture('appointment_completed', { circle_id: circleId }),
  calendarViewed: (circleId: string, view: string) =>
    capture('calendar_viewed', { circle_id: circleId, view }),

  // --- Documents (web-new) ---
  documentUploaded: (circleId: string, category: string, fileType: string) =>
    capture('document_uploaded', { circle_id: circleId, category, file_type: fileType }),

  // --- Vitals (web-new) ---
  vitalLogged: (circleId: string, vitalType: string) =>
    capture('vital_logged', { circle_id: circleId, vital_type: vitalType }),

  // --- AI (web-new) — NEVER include message text. ---
  aiChatMessageSent: (circleId: string) => capture('ai_chat_message_sent', { circle_id: circleId }),
};

export default Analytics;
