/**
 * Notification settings: 8 per-key switches collapsed into 4 groups.
 * Spec: docs/plans/notification-settings-4-groups.md (section 4).
 *
 * Storage is unchanged (per-key JSON on `users.notification_preferences`); a
 * group is a view over its child keys. Absent key = ON (`!== false`).
 * Twin of mobile/src/utils/notificationGroups.ts: same names, same tests.
 *
 * Legacy keys (`medication_reminders`, `activity_updates`, `chat_messages`) are
 * deliberately NOT in any group, so no group write can ever touch them.
 */

export type NotificationGroup = 'medications' | 'tasks' | 'notes' | 'tips';

export type NotificationPrefs = Partial<Record<string, boolean>>;

export const NOTIFICATION_GROUP_ORDER: readonly NotificationGroup[] = [
  'medications',
  'tasks',
  'notes',
  'tips',
] as const;

export const GROUPS = {
  medications: ['medication_confirmations', 'missed_medications'],
  tasks: ['task_assignments', 'appointment_reminders', 'note_nudges'],
  notes: ['event_notes', 'care_notes'],
  tips: ['tips_and_suggestions'],
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
