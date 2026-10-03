// PK9 draft identity for an entry in one of the emergency-info LISTS: an
// emergency contact, an additional doctor, an insurance plan. Mirrors
// mobile/src/utils/emergencyDraftKey.ts -- keep the two identical.
//
// WHY NOT THE ARRAY INDEX. These entries have no id (they are rows of a JSONB
// array that every editor rewrites whole), and the drafts were keyed by index.
// A draft survives a forced sign-out for up to 30 minutes, and the list can
// change in that window: another member deletes the contact before the one being
// edited and the SAME slot now holds somebody else. The restored draft then
// filled that other person's editor, and the stale-edit check (`if_match`)
// cannot catch it because its base is read fresh when the form mounts.
//
// So the key names the entry itself: a hash of the fields that identify it,
// read from the snapshot the form was SEEDED from (never the live cache, which a
// refetch can move under a form that is still open). Properties:
//   - stable under changes elsewhere in the list (an earlier entry deleted or
//     added: the entry keeps its key, and its draft restores into it at its new
//     position);
//   - a slot that now holds a different entry has a different key, so it gets no
//     draft at all;
//   - identical entries (same fields) are told apart by their order among their
//     twins, so one is never given the other's draft;
//   - if another member rewrites one of the identifying fields before sign-in,
//     the key changes and the draft is NOT restored (the safe direction: we never
//     guess which entry it belonged to);
//   - flags and volatile fields (`is_primary`, `photo_url`, scan data) are left
//     out, so toggling the primary flag elsewhere does not orphan a draft.
// The key holds a hash, never the field values.

export const CONTACT_DRAFT_FIELDS = ['name', 'relationship', 'phone', 'country_code'] as const;
export const DOCTOR_DRAFT_FIELDS = ['name', 'specialty', 'phone', 'country_code', 'address'] as const;
export const INSURANCE_DRAFT_FIELDS = [
  'label',
  'carrier',
  'policy_number',
  'group_number',
  'phone',
  'country_code',
] as const;

/** FNV-1a over the UTF-16 code units of `s`, as 8 hex digits. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function fingerprint(entry: object, fields: readonly string[]): string {
  const values = fields.map((field) => {
    const v = (entry as Record<string, unknown>)[field];
    // null, undefined and '' are the same "not set" on every read path.
    return v === null || v === undefined ? '' : String(v).trim();
  });
  return fnv1a(JSON.stringify(values));
}

/**
 * The draft identity of `list[index]`, or `'new'` for an add form (`index`
 * undefined), or null when there is no such entry (nothing to restore into).
 */
export function emergencyEntryDraftId<T extends object>(
  list: readonly T[] | null | undefined,
  index: number | undefined,
  fields: readonly string[]
): string | null {
  if (index === undefined) return 'new';
  const entry = list?.[index];
  if (!list || !entry) return null;
  const own = fingerprint(entry, fields);
  let twinsBefore = 0;
  for (let i = 0; i < index; i++) {
    if (fingerprint(list[i], fields) === own) twinsBefore++;
  }
  return `${own}.${twinsBefore}`;
}
