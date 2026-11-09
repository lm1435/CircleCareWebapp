/**
 * THE EDIT-PATCH RULE for a field a form lets the user EMPTY.
 *
 * SAME FILE, SAME SEMANTICS on mobile (`mobile/src/utils/editPatch.ts`) and web
 * (`webapp/src/utils/editPatch.ts`); both are pinned by an identical unit test.
 *
 * WHY. An update is a PARTIAL patch server-side: an ABSENT key means "leave the
 * stored value alone" and only an explicit `null` clears it. The forms used to
 * build these keys as `value.trim() || undefined`, which turns "the user emptied
 * the field" into "no key" — so the server kept the old notes / place / dose /
 * end / time, the app said "Saved", and the old value came back (sweep
 * 2026-11-08, "can't clear on edit"). The backend accepts `null` on PATCH for
 * every field routed through here.
 *
 * THE RULE:
 *   - CREATE: a value is sent, an empty field is OMITTED. Never null: there is
 *     nothing stored to clear, and a create schema need not accept null.
 *   - EDIT, value unchanged from the stored one: OMITTED (nothing to say).
 *   - EDIT, stored value emptied: `null` (clear it).
 *   - EDIT, new value: the new value.
 * "Empty" is null, undefined, or a string that trims to ''. Strings are sent
 * TRIMMED and compared trimmed.
 */

export type Patched<T> = T | null | undefined;

export interface EditPatchOptions {
  /** True on an edit of a stored row; false on a create. */
  isEditing: boolean;
  /**
   * Compare as equal after this mapping (e.g. `HH:MM` vs a stored `HH:MM:SS`).
   * Applied to non-empty values only.
   */
  normalize?: (value: string | number) => unknown;
}

function emptyToNull<T extends string | number>(value: T | null | undefined): T | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : (trimmed as T);
  }
  return value;
}

/** Differ-only patch value; see the file comment. */
export function editPatch<T extends string | number>(
  stored: T | null | undefined,
  next: T | null | undefined,
  options: EditPatchOptions
): Patched<T> {
  const n = emptyToNull(next);
  if (!options.isEditing) return n === null ? undefined : n;
  const s = emptyToNull(stored);
  const norm = options.normalize ?? ((v: string | number) => v);
  if (n === null) return s === null ? undefined : null;
  if (s !== null && norm(s) === norm(n)) return undefined;
  return n;
}

/**
 * CLEAR-ONLY patch value, for a field that must keep TRAVELLING when it is set
 * because it is derived together with another one (`scheduled_time` with
 * `scheduled_date`: both are re-expressed into the care recipient's frame from
 * the same instant, and the server compares the time normalized, so an
 * unchanged echo is a no-op there). Differs from `editPatch` only in that a
 * present value is always sent:
 *   - a value: sent (create or edit);
 *   - EDIT, stored value emptied: `null`;
 *   - otherwise: omitted.
 */
export function clearOnEdit<T extends string | number>(
  stored: T | null | undefined,
  next: T | null | undefined,
  options: Pick<EditPatchOptions, 'isEditing'>
): Patched<T> {
  const n = emptyToNull(next);
  if (n !== null) return n;
  return options.isEditing && emptyToNull(stored) !== null ? null : undefined;
}
