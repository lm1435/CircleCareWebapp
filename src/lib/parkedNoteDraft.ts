// BH-024: a care note whose POST fails AFTER the user left the Notes page has nowhere to
// restore into (the composer is unmounted). The draft is parked here, in memory only (care
// notes are health content: never storage), and the next NotesPage mount for the same circle
// AND the same signed-in user takes it back exactly once, within the same 30-minute window the
// stored session draft uses (lib/sessionDraft DRAFT_TTL_MS).
//
// Privacy: a parked draft belongs to one person. Parking needs a signed-in user (a post that
// failed because the session died parks nothing: PK9's sessionStorage draft covers that case,
// with its own user + TTL checks), taking it needs the SAME user, and every session end drops
// them all (store/authStore clearLocalSession).
import type { NoteDraft } from '@/components/notes/NoteComposer';
import { DRAFT_TTL_MS } from '@/lib/sessionDraft';

type Parked = { draft: NoteDraft; userId: string; parkedAt: number };

const parked = new Map<string, Parked>();

/** No-op without a signed-in user. */
export function parkNoteDraft(
  circleId: string,
  userId: string | null | undefined,
  draft: NoteDraft
): void {
  if (!userId) return;
  parked.set(circleId, { draft, userId, parkedAt: Date.now() });
}

/**
 * Read and delete: a parked draft is restored at most once. Null (and still deleted) when it
 * belongs to another user or is older than DRAFT_TTL_MS.
 */
export function takeParkedNoteDraft(
  circleId: string,
  userId: string | null | undefined
): NoteDraft | null {
  const p = parked.get(circleId);
  parked.delete(circleId);
  if (!p || !userId || p.userId !== userId) return null;
  if (Date.now() - p.parkedAt >= DRAFT_TTL_MS) return null;
  return p.draft;
}

// Event notes (appointment / dose / task notes) park the same way, keyed per circle AND event
// occurrence (1.4.3 audit item 1). Twin of mobile/src/utils/parkedNoteDraft.ts.
type ParkedEvent = { body: string; userId: string; parkedAt: number };
const parkedEvent = new Map<string, ParkedEvent>();

const eventKey = (circleId: string, eventId: string, scheduledDate: string | null | undefined) =>
  `${circleId}|${eventId}|${scheduledDate ?? ''}`;

/** No-op without a signed-in user or with an empty body. */
export function parkEventNoteDraft(
  circleId: string,
  eventId: string,
  scheduledDate: string | null | undefined,
  userId: string | null | undefined,
  body: string
): void {
  if (!userId || !body.trim()) return;
  parkedEvent.set(eventKey(circleId, eventId, scheduledDate), { body, userId, parkedAt: Date.now() });
}

/** Read and delete; null when it belongs to another user or is older than DRAFT_TTL_MS. */
export function takeParkedEventNoteDraft(
  circleId: string,
  eventId: string,
  scheduledDate: string | null | undefined,
  userId: string | null | undefined
): string | null {
  const key = eventKey(circleId, eventId, scheduledDate);
  const p = parkedEvent.get(key);
  parkedEvent.delete(key);
  if (!p || !userId || p.userId !== userId) return null;
  if (Date.now() - p.parkedAt >= DRAFT_TTL_MS) return null;
  return p.body;
}

export function clearParkedNoteDrafts(): void {
  parked.clear();
  parkedEvent.clear();
}
