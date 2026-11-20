import type { CareNote } from '@/api/careNotes';

/**
 * Names for the "Seen by" caption: the note's readers EXCLUDING the viewer and the author, in the
 * order the server sent them. A reader with no first name gets `fallback` (the generic member
 * label). Empty when `seen_by` is absent or holds nobody else: callers then render nothing.
 */
export function seenByNames(
  note: Pick<CareNote, 'author_id' | 'seen_by'>,
  viewerId: string | undefined,
  fallback: string
): string[] {
  if (!Array.isArray(note.seen_by)) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const r of note.seen_by) {
    // A null/undefined entry is skipped; a repeated user_id counts once (first occurrence wins).
    if (!r) continue;
    if (r.user_id === viewerId || r.user_id === note.author_id) continue;
    if (seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    names.push(r.first_name?.trim() || fallback);
  }
  return names;
}
