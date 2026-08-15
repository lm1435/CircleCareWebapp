import { useCallback, useEffect, useRef, useState } from 'react';
import type { CalendarEvent } from '@/api/calendarEvents';
import { useCompleteEvent } from '@/hooks/useCalendarEvents';

// Shared task-completion orchestration — the undo grace period every task
// surface uses. Extracted from TasksPage so the Overview "Open tasks" card gets
// the IDENTICAL behavior instead of a second copy that drifts (same reason
// mobile pulled its version into useCompletionUndo, shared by the Tasks tab and
// the home-screen OpenTasks card).

// Grace period before a completed task is actually committed. Mirrors mobile's
// 5s undo window (mobile/src/components/tasks/OpenTasks.tsx UNDO_DELAY_MS): the
// checkbox flips to checked, the row shows a draining "Completing… Undo"
// affordance, and the complete mutation only fires once this elapses. Undo
// before then cancels with nothing committed.
export const UNDO_DELAY_MS = 5000;

export interface UseTaskCompletionResult {
  /** Ids inside the 5s undo window — checked in the UI, not yet committed. */
  pendingIds: Set<string>;
  /** Start the undo window for a task. */
  handleComplete: (task: CalendarEvent) => void;
  /** Cancel a pending completion — nothing is committed. */
  handleUndo: (eventId: string) => void;
  /** Commit every still-pending completion now (e.g. before a list teardown). */
  flushPending: () => void;
}

/**
 * Owns the 5s undo window for task completion: pending ids, their commit
 * timers, and every path that must not silently drop a completion (unmount,
 * page-hide, tab backgrounding). Completion itself goes through
 * `useCompleteEvent` — parity with mobile, which completes a task via
 * completeEvent.
 */
export function useTaskCompletion(circleId: string): UseTaskCompletionResult {
  const completeMutation = useCompleteEvent(circleId);

  // ── Undo grace period (mirrors mobile OpenTasks) ──────────────────────────
  // Tasks the user checked but that haven't committed yet. Each maps to the
  // pending commit timer so undo can cancel it. Keep a ref alongside the state
  // so the unmount cleanup sees the latest timers without re-subscribing.
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const completeMutationRef = useRef(completeMutation);
  completeMutationRef.current = completeMutation;

  /** Commit every still-pending completion now and drop its timer. */
  const flushPending = useCallback(() => {
    const timers = timersRef.current;
    if (timers.size === 0) return;
    // Capture before clearing — used below to drop exactly these ids from
    // pendingIds, without disturbing any id whose timer already fired
    // naturally and is mid-flight toward its own onSettled cleanup.
    const flushedIds = Array.from(timers.keys());
    timers.forEach((timerId, eventId) => {
      clearTimeout(timerId);
      completeMutationRef.current.mutate(eventId);
    });
    timers.clear();
    // WB2: flushing without clearing pendingIds left a committed task stuck
    // showing the "Completing… Undo" affordance forever — a dead Undo button
    // for a task that had already been sent to the server.
    setPendingIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      flushedIds.forEach((id) => next.delete(id));
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const flushPendingRef = useRef(flushPending);
  flushPendingRef.current = flushPending;

  // On unmount: no leaked setTimeout, no silently-dropped completion.
  useEffect(() => {
    return () => {
      flushPendingRef.current();
    };
  }, []);

  // ...and on the page going away, which unmount does NOT cover on web.
  //
  // Closing the tab, navigating to another site, or (on mobile Safari) the OS
  // reclaiming a backgrounded tab does not reliably run React cleanup, so a
  // task marked done inside the grace window was simply lost — the user saw it
  // struck through and it stayed open on the server. `pagehide` is the event
  // that actually fires in the bfcache/tab-close path; `visibilitychange` covers
  // backgrounding. This is the web counterpart of the AppState flush the mobile
  // completion hook does.
  useEffect(() => {
    const onHide = () => flushPendingRef.current();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPendingRef.current();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Start the undo window: flip the row to checked and schedule the real
  // commit for UNDO_DELAY_MS later. The commit clears its own pending entry so
  // a fresh fetch (post-invalidation) can take over.
  const handleComplete = useCallback((task: CalendarEvent): void => {
    const eventId = task.id;
    const existing = timersRef.current.get(eventId);
    if (existing) clearTimeout(existing);

    const timerId = setTimeout(() => {
      timersRef.current.delete(eventId);
      completeMutationRef.current.mutate(eventId, {
        onSettled: () => {
          setPendingIds((prev) => {
            if (!prev.has(eventId)) return prev;
            const next = new Set(prev);
            next.delete(eventId);
            return next;
          });
        },
      });
    }, UNDO_DELAY_MS);

    timersRef.current.set(eventId, timerId);
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
  }, []);

  // Cancel the pending completion — nothing is committed.
  const handleUndo = useCallback((eventId: string): void => {
    const timerId = timersRef.current.get(eventId);
    if (timerId) clearTimeout(timerId);
    timersRef.current.delete(eventId);
    setPendingIds((prev) => {
      if (!prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  return { pendingIds, handleComplete, handleUndo, flushPending };
}
