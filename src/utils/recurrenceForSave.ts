/**
 * The recurrence keys of a calendar-event save. PORT of mobile's
 * `recurrenceForSave` (mobile/src/utils/recurrenceFormat.ts) — same rules, so
 * "Repeat: Once" and a cleared repeat end date mean the same on both clients.
 *
 * ABSENT AND NULL ARE DIFFERENT INSTRUCTIONS. An update is a partial patch: an
 * absent key means "leave unchanged", only `null` clears. The web form used to
 * omit `recurrence_rule` when the user chose Once and `recurrence_end_date` when
 * they cleared the end date, so the backend kept the series (or its end) while
 * the app said "Saved" (sweep 2026-11-08). The backend has accepted `null` for
 * both on PATCH since the "Repeat: Never" fix, clears `recurrence_days` and the
 * end date with a cleared rule, and prunes the children generated from it.
 *
 * `clearing` is the caller saying a stored value can be removed — i.e. this is
 * an EDIT. A create never sends null.
 */
export function recurrenceForSave(
  rule: string | null | undefined,
  endDate: string | null | undefined,
  options?: { clearing?: boolean }
): { recurrence_rule?: string | null; recurrence_end_date?: string | null } {
  if (!options?.clearing) {
    if (!rule) return { recurrence_rule: undefined, recurrence_end_date: undefined };
    return { recurrence_rule: rule, recurrence_end_date: endDate ?? undefined };
  }
  // Clearing the RULE clears the end date with it (an end date without a rule
  // is meaningless; the server does the same for `recurrence_days`).
  if (!rule) return { recurrence_rule: null, recurrence_end_date: null };
  // Clearing only the END DATE: the series keeps running, indefinitely.
  return { recurrence_rule: rule, recurrence_end_date: endDate ?? null };
}
