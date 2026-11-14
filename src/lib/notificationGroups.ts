/**
 * Notification settings: 8 per-key switches collapsed into 6 groups.
 * Spec: docs/plans/notification-settings-4-groups.md (section 4).
 *
 * Storage is unchanged (per-key JSON on `users.notification_preferences`); a
 * group is a view over its child keys. Absent key = ON (`!== false`).
 * Twin of mobile/src/utils/notificationGroups.ts: same names, same tests.
 *
 * Legacy keys (`medication_reminders`, `activity_updates`, `chat_messages`) are
 * deliberately NOT in any group, so no group write can ever touch them.
 */

/**
 * 1.4.2 (docs/plans/cognitive-overload-1-4-2.md item 2): the old Medications group is TWO
 * switches. "Doses taken" (`medication_confirmations`) is the volume; "Doses not marked"
 * (`missed_medications`) is the safety alert. Each reads its own stored key, so every user
 * keeps exactly what they had (no migration; the backend already reads them per key).
 */
export type NotificationGroup =
  | 'doses_taken'
  | 'doses_not_marked'
  | 'tasks'
  | 'notes'
  | 'tips'
  | 'shifts';

export type NotificationPrefs = Partial<Record<string, boolean>>;

export const NOTIFICATION_GROUP_ORDER: readonly NotificationGroup[] = [
  'doses_taken',
  'doses_not_marked',
  'tasks',
  'notes',
  'tips',
  'shifts',
] as const;

export const GROUPS = {
  doses_taken: ['medication_confirmations'],
  doses_not_marked: ['missed_medications'],
  tasks: ['task_assignments', 'appointment_reminders', 'note_nudges'],
  notes: ['event_notes', 'care_notes'],
  tips: ['tips_and_suggestions'],
  // Care shifts (docs/plans/care-shifts.md). Absent = ON. Push is mobile-only; the
  // switch is stored per user, so it applies to the phone either way.
  shifts: ['shift_alerts'],
} as const satisfies Record<NotificationGroup, readonly string[]>;

/** Absent = ON. */
export const childOn = (prefs: NotificationPrefs, key: string): boolean => prefs[key] !== false;

/** A group is ON if ANY child is on. */
export const groupOn = (prefs: NotificationPrefs, group: NotificationGroup): boolean =>
  GROUPS[group].some((k) => childOn(prefs, k));

/** ON but with at least one child explicitly off (history or an old client). */
export const groupMixed = (prefs: NotificationPrefs, group: NotificationGroup): boolean =>
  groupOn(prefs, group) && GROUPS[group].some((k) => prefs[k] === false);

/**
 * The partial PATCH body for tapping a group: every child key set to `next`.
 * The Tasks body also pins `event_notes` to its stored value, because the
 * backend's legacy shim (users.ts) mirrors `note_nudges` onto `event_notes`
 * when a request carries the former without the latter. The Notes body sends
 * `event_notes` + `care_notes` and never `note_nudges`.
 */
export function groupPatchBody(
  prefs: NotificationPrefs,
  group: NotificationGroup,
  next: boolean
): Record<string, boolean> {
  const body: Record<string, boolean> = {};
  for (const key of GROUPS[group]) body[key] = next;
  if (group === 'tasks') body.event_notes = prefs.event_notes !== false;
  return body;
}
