import { newClientRequestId } from '@/lib/asNeeded';

/**
 * The note `client_request_id`, held WITH THE DRAFT (1.4.3 item 7, review W4).
 *
 * Minted per submit, a manual re-save after a save that FAILED to report but
 * actually landed would write the note twice. Now the id lives per draft scope
 * (circle + event/day), keyed to the draft's content: a re-save of the SAME text
 * reuses the id (the server answers 200 `replayed: true`), changed text gets a
 * new one, and success clears it. In memory only; sign-out clears it.
 */
const held = new Map<string, { fingerprint: string; id: string }>();

export function requestIdForDraft(scope: string, fingerprint: string): string {
  const current = held.get(scope);
  if (current && current.fingerprint === fingerprint) return current.id;
  const id = newClientRequestId();
  held.set(scope, { fingerprint, id });
  return id;
}

/**
 * The save landed: the next note in this scope is a new one. Only clears when the id that landed is
 * still the one held: a slow earlier save finishing after the user started (and keyed) a newer draft in
 * the same scope must not wipe the newer draft's id.
 */
export function clearDraftRequestId(scope: string, id?: string): void {
  const current = held.get(scope);
  if (id !== undefined && current && current.id !== id) return;
  held.delete(scope);
}

export function clearAllDraftRequestIds(): void {
  held.clear();
}
