import { useEffect, useRef } from 'react';
import {
  MAX_SEEN_PER_REQUEST,
  markCareNotesSeen,
  type CareNote,
  type CareNoteSeenPair,
} from '@/api/careNotes';
import { isNotFoundError } from '@/lib/apiErrors';
import { isUuid } from '@/lib/notificationsInbox';
import { Analytics } from '@/lib/analytics';

// "Seen by" read receipts for Daily Care Notes. Used by the Notes PAGE only: `useCareNotes` also
// feeds the overview's QuickAccess and must never mark anything, which is why this is a separate
// hook rather than a side effect of the query.
//
// A note counts as seen when EITHER its row is at least 50% visible OR the visible part of the row
// covers at least 60% of the viewport height (a note taller than twice the viewport can never reach
// 50% of its own area), for 1 s while the tab is visible:
// ONE shared IntersectionObserver plus a dwell timer per row (cancelled when the row leaves).
// Newly seen (note_id, updated_at) pairs are debounced and sent in batches of at most 100.
//
// Rows are found through the `data-care-note-id` attribute NoteRow puts on its <li>.

/** Row must stay at least half visible this long. */
export const SEEN_DWELL_MS = 1000;
/** Quiet period after the last newly seen note before the batch is sent. */
export const SEEN_DEBOUNCE_MS = 1500;
export const SEEN_THRESHOLD = 0.5;
/** Or: the visible part of the row covers this share of the viewport height. */
export const SEEN_VIEWPORT_COVERAGE = 0.6;
/** Fine steps so a very tall row keeps producing callbacks while it scrolls. */
export const SEEN_THRESHOLDS: number[] = Array.from({ length: 21 }, (_, i) => i / 20);

/** True when the entry satisfies the 50%-of-row rule or the 60%-of-viewport rule. */
function countsAsViewed(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= SEEN_THRESHOLD) return true;
  const rootHeight = entry.rootBounds?.height ?? window.innerHeight;
  const visibleHeight = entry.intersectionRect?.height ?? 0;
  return rootHeight > 0 && visibleHeight >= SEEN_VIEWPORT_COVERAGE * rootHeight;
}
export const SEEN_ROW_ATTR = 'data-care-note-id';

// Session-level (module) state: leaving and re-entering the Notes page must not resend a pair,
// and an old backend (404) is not asked again until the app reloads.
const sentKeys = new Set<string>();
let latchedOff = false;

/** Test seam: clears the session state. */
export function resetMarkCareNotesSeenSession(): void {
  sentKeys.clear();
  latchedOff = false;
}

const pairKey = (viewerId: string, noteId: string, updatedAt: string): string =>
  `${viewerId}|${noteId}|${updatedAt}`;

interface Options {
  circleId: string;
  notes: CareNote[];
  viewerId: string | undefined;
  /** False while the list is placeholder data from a previously viewed circle (or not loaded). */
  enabled: boolean;
}

export function useMarkCareNotesSeen({ circleId, notes, viewerId, enabled }: Options): void {
  const notesRef = useRef(new Map<string, CareNote>());
  const ctxRef = useRef({ circleId, viewerId, enabled });
  ctxRef.current = { circleId, viewerId, enabled };

  const observerRef = useRef<IntersectionObserver | null>(null);
  const observedRef = useRef(new Map<Element, string>());
  const inViewRef = useRef(new Set<string>());
  const dwellRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingRef = useRef(new Map<string, CareNoteSeenPair & { key: string; circleId: string }>());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable helpers (they only read refs), created once.
  const apiRef = useRef<{
    startDwell: (id: string) => void;
    clearDwell: (id: string) => void;
    schedule: () => void;
  } | null>(null);
  if (!apiRef.current) {
    const isVisible = (): boolean => document.visibilityState === 'visible';

    const eligible = (note: CareNote | undefined): note is CareNote => {
      const ctx = ctxRef.current;
      if (!note || !ctx.viewerId || !ctx.enabled || latchedOff) return false;
      if (note.circle_id !== ctx.circleId) return false; // placeholder data from another circle
      if (note.author_id === ctx.viewerId) return false;
      if (!isUuid(note.id)) return false; // optimistic / temporary row
      if (note.seen_by?.some((r) => r.user_id === ctx.viewerId)) return false;
      return !sentKeys.has(pairKey(ctx.viewerId, note.id, note.updated_at));
    };

    const flush = async (): Promise<void> => {
      debounceRef.current = null;
      if (!isVisible() || latchedOff) return; // re-armed by the visibilitychange handler
      const { circleId: cid } = ctxRef.current;
      const all = [...pendingRef.current.values()];
      pendingRef.current.clear();
      // Pairs queued under another circle (the user switched) are forgotten, never sent here.
      const batch = all.filter((p) => p.circleId === cid);
      all.filter((p) => p.circleId !== cid).forEach((p) => sentKeys.delete(p.key));
      for (let i = 0; i < batch.length; i += MAX_SEEN_PER_REQUEST) {
        const chunk = batch.slice(i, i + MAX_SEEN_PER_REQUEST);
        if (latchedOff) {
          chunk.forEach((p) => sentKeys.delete(p.key));
          continue;
        }
        try {
          const { marked } = await markCareNotesSeen(
            cid,
            chunk.map(({ note_id, updated_at }) => ({ note_id, updated_at }))
          );
          if (marked > 0) Analytics.careNotesSeenRecorded({ count: marked });
        } catch (err) {
          // A read receipt has no user-visible save to fail, so this is a deliberate, documented
          // exception to the "every write retries" rule: NO toast, NO error analytics, NO retry
          // helper. The pairs are forgotten so a later view of the rows sends them again. An old
          // backend answers 404 (route unknown): stop asking for the rest of the session.
          chunk.forEach((p) => sentKeys.delete(p.key));
          if (isNotFoundError(err) || (err as { response?: { status?: number } })?.response?.status === 404) {
            latchedOff = true;
          }
        }
      }
    };

    const schedule = (): void => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void flush(), SEEN_DEBOUNCE_MS);
    };

    const clearDwell = (id: string): void => {
      const t = dwellRef.current.get(id);
      if (t) clearTimeout(t);
      dwellRef.current.delete(id);
    };

    const startDwell = (id: string): void => {
      if (dwellRef.current.has(id) || !isVisible()) return;
      if (!eligible(notesRef.current.get(id))) return;
      dwellRef.current.set(
        id,
        setTimeout(() => {
          dwellRef.current.delete(id);
          const note = notesRef.current.get(id);
          const { viewerId: vid } = ctxRef.current;
          if (!isVisible() || !inViewRef.current.has(id) || !vid || !eligible(note)) return;
          const key = pairKey(vid, note.id, note.updated_at);
          sentKeys.add(key);
          pendingRef.current.set(key, {
            key,
            circleId: note.circle_id,
            note_id: note.id,
            updated_at: note.updated_at,
          });
          schedule();
        }, SEEN_DWELL_MS)
      );
    };

    apiRef.current = { startDwell, clearDwell, schedule };
  }

  // Keep the latest notes addressable by id, observe the rendered rows, and (re)start dwell timers
  // for rows already in view (a note whose updated_at changed while on screen counts again).
  useEffect(() => {
    const api = apiRef.current!;
    const map = new Map<string, CareNote>();
    for (const n of notes) map.set(n.id, n);
    notesRef.current = map;

    if (typeof IntersectionObserver === 'undefined') return;
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const id = observedRef.current.get(entry.target) ?? entry.target.getAttribute(SEEN_ROW_ATTR);
            if (!id) continue;
            if (countsAsViewed(entry)) {
              inViewRef.current.add(id);
              api.startDwell(id);
            } else {
              inViewRef.current.delete(id);
              api.clearDwell(id);
            }
          }
        },
        { threshold: SEEN_THRESHOLDS }
      );
    }
    const observer = observerRef.current;

    const present = new Set<Element>();
    if (enabled) {
      document.querySelectorAll(`[${SEEN_ROW_ATTR}]`).forEach((el) => {
        const id = el.getAttribute(SEEN_ROW_ATTR);
        if (!id || !map.has(id)) return;
        present.add(el);
        if (!observedRef.current.has(el)) {
          observedRef.current.set(el, id);
          observer.observe(el);
        }
      });
    }
    for (const [el, id] of [...observedRef.current]) {
      if (present.has(el)) continue;
      observer.unobserve(el);
      observedRef.current.delete(el);
      inViewRef.current.delete(id);
      api.clearDwell(id);
    }
    for (const id of inViewRef.current) api.startDwell(id);
  }, [notes, circleId, viewerId, enabled]);

  // Background tab: stop the clocks; coming back, rows still in view start theirs again, and a
  // batch held back while hidden is sent.
  useEffect(() => {
    const api = apiRef.current!;
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        for (const id of inViewRef.current) api.startDwell(id);
        if (pendingRef.current.size > 0) api.schedule();
      } else {
        for (const id of [...dwellRef.current.keys()]) api.clearDwell(id);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Teardown: nothing observed, no timers, and pairs not yet sent are forgotten (so a later visit
  // sends them).
  useEffect(() => {
    const dwell = dwellRef.current;
    const pending = pendingRef.current;
    const observed = observedRef.current;
    const inView = inViewRef.current;
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      observed.clear();
      inView.clear();
      dwell.forEach((t) => clearTimeout(t));
      dwell.clear();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
      pending.forEach((p) => sentKeys.delete(p.key));
      pending.clear();
    };
  }, []);
}
