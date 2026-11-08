/**
 * The Medications tab's one-line summary (the counterpart of the Calendar's shifts summary; mobile
 * `utils/medicationsSummary`).
 *
 * Why it exists: the History tab always has a subtitle and the Medications tab had one only when
 * the recipient's zone differed, so switching tabs moved the control and everything under it.
 * Each tab now always owns exactly one line in that slot.
 *
 * `activeGroups` is the ACTIVE roster (one entry per medication; ended and discontinued series are
 * not in it). Returns an i18n key + options for the caller to translate.
 */
export function medicationsSummaryText(activeGroups: readonly { asNeeded: boolean }[]): {
  key: string;
  options?: { count?: number; scheduled?: number; asNeeded?: number };
} {
  const asNeeded = activeGroups.filter((g) => g.asNeeded).length;
  const scheduled = activeGroups.length - asNeeded;
  if (activeGroups.length === 0) return { key: 'meds:page.summary.none' };
  if (asNeeded === 0) return { key: 'meds:page.summary.scheduled', options: { count: scheduled } };
  if (scheduled === 0) return { key: 'meds:page.summary.asNeededOnly', options: { asNeeded } };
  return { key: 'meds:page.summary.mixed', options: { count: scheduled, scheduled, asNeeded } };
}
