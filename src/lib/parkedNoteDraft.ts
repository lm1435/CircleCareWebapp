// BH-024: a care note whose POST fails AFTER the user left the Notes page has nowhere to
// restore into (the composer is unmounted). The draft is parked here, in memory only (care
// notes are health content: never storage), and the next NotesPage mount for the same circle
// takes it back exactly once.
import type { NoteDraft } from '@/components/notes/NoteComposer';

const parked = new Map<string, NoteDraft>();

export function parkNoteDraft(circleId: string, draft: NoteDraft): void {
  parked.set(circleId, draft);
}

/** Read and delete: a parked draft is restored at most once. */
export function takeParkedNoteDraft(circleId: string): NoteDraft | null {
  const d = parked.get(circleId) ?? null;
  parked.delete(circleId);
  return d;
}

export function clearParkedNoteDrafts(): void {
  parked.clear();
}
