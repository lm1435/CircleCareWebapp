import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CalendarEvent } from '@/api/calendarEvents';
import { useCompleteEvent } from '@/hooks/useCalendarEvents';
import { queryKeys } from '@/lib/queryKeys';
import { withRefetchCap } from '@/lib/refetchCap';
import { keepalivePost } from '@/lib/keepalivePost';
import { startUndoTimer, type UndoTimer } from '@/lib/undoTimer';

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

/** One task inside its undo window. */
interface PendingCompletion {
  /** Holdable: paused while the badge is hovered / focused (`lib/undoTimer`). */
  timer: UndoTimer;
  /** The circle the tap was made in — every send path uses THIS, never the
   * circle being rendered when the commit happens. */
  circleId: string;
}

export interface UseTaskCompletionResult {
  /** Ids inside the 5s undo window — checked in the UI, not yet committed. */
  pendingIds: Set<string>;
  /** Start the undo window for a task. */
  handleComplete: (task: CalendarEvent) => void;
  /** Cancel a pending completion — nothing is committed. */
  handleUndo: (eventId: string) => void;
  /**
   * Pause (`true`) or resume (`false`) a pending completion's countdown — the
   * badge calls it while the pointer is over it or keyboard focus is inside it
   * (WCAG 2.2.1). No-op once the completion has been sent.
   */
  handleHoldUndo: (eventId: string, held: boolean) => void;
  /** Commit every still-pending completion now (e.g. before a list teardown). */
  flushPending: (viaKeepalive?: boolean) => void;
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
  const queryClient = useQueryClient();

  // ── Undo grace period (mirrors mobile OpenTasks) ──────────────────────────
  // Tasks the user checked but that haven't committed yet. Each maps to the
  // pending commit timer so undo can cancel it. Keep a ref alongside the state
  // so the unmount cleanup sees the latest timers without re-subscribing.
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const timersRef = useRef<Map<string, PendingCompletion>>(new Map());
  const completeMutationRef = useRef(completeMutation);
  completeMutationRef.current = completeMutation;
  // Read ONLY at tap time (`handleComplete`, a `useCallback([])` whose closure
  // is fixed at mount), to stamp the circle onto the new pending entry. No send
  // path reads it: the commit may happen up to 5s later — on the timer or in a
  // flush — and a re-render with another circle in between (a route change
  // with no remount) must not redirect a completion tapped in circle A to
  // `/circles/B/...`, where the backend's circle scoping 404s it and A's task
  // is silently lost. Each entry carries its own `circleId` for the request,
  // its analytics, its invalidation and the tasks-refetch-and-wait (mobile's
  // useCompletionUndo does the same — plan mobile-e2e-parity, "P-H2 follow-up").
  const circleIdRef = useRef(circleId);
  circleIdRef.current = circleId;

  /**
   * Commit every still-pending completion now and drop its timer.
   *
   * `viaKeepalive` (PK11): the page is going away or being hidden, so each
   * completion goes out as `fetch(..., { keepalive: true })` — one request per
   * task, the timer is cleared first so nothing can send it a second time —
   * which the browser finishes after unload (an axios XHR is cancelled). When
   * the keepalive request cannot be made, or fails while the page is still
   * alive, the ordinary mutation takes over. The unmount flush stays on axios.
   */
  const flushPending = useCallback((viaKeepalive: boolean | unknown = false) => {
    const keepalive = viaKeepalive === true;
    const timers = timersRef.current;
    if (timers.size === 0) return;
    // Capture before clearing — used below to drop exactly these ids from
    // pendingIds, without disturbing any id whose timer already fired
    // naturally and is mid-flight toward its own onSettled cleanup.
    const flushedIds = Array.from(timers.keys());
    timers.forEach(({ timer, circleId: sentCircleId }, eventId) => {
      timer.clear();
      const request = keepalive
        ? keepalivePost(`/circles/${sentCircleId}/events/${eventId}/complete`)
        : null;
      if (!request) {
        completeMutationRef.current.mutate({ eventId, circleId: sentCircleId });
        return;
      }
      request.then(
        (response) => {
          if (response.ok) {
            // Landed: refresh what the rows read in case the tab comes back.
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(sentCircleId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(sentCircleId) });
          } else {
            // Refused while the page is alive: the ordinary path reports it.
            completeMutationRef.current.mutate({ eventId, circleId: sentCircleId });
          }
        },
        () => completeMutationRef.current.mutate({ eventId, circleId: sentCircleId })
      );
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
    const onHide = () => flushPendingRef.current(true);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPendingRef.current(true);
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  /** Drop one id from `pendingIds`, if it is still there. */
  const clearPendingId = useCallback((eventId: string) => {
    setPendingIds((prev) => {
      if (!prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  // Start the undo window: flip the row to checked and schedule the real
  // commit for UNDO_DELAY_MS later. The commit clears its own pending entry so
  // a fresh fetch (post-invalidation) can take over.
  const handleComplete = useCallback((task: CalendarEvent): void => {
    // THE ROW'S OWN ID, AND NO `scheduledDate` — deliberately, not by omission.
    //
    // Both surfaces on this hook (TasksPage, OpenTasksCard) are fed by GET
    // /circles/:id/tasks, which reads PHYSICAL `calendar_events` rows and never
    // expands a recurrence: every task here already IS its own occurrence, so
    // the id addresses exactly the row to stamp and the request stays body-less.
    // Only the calendar can hand out a virtual occurrence, and that path
    // (EventDetailActions) resolves root + date itself. Mobile's Tasks tab draws
    // the same distinction.
    const eventId = task.id;
    const existing = timersRef.current.get(eventId);
    if (existing) existing.timer.clear();
    // The circle this tap was made in — see `circleIdRef`.
    const sentCircleId = circleIdRef.current;

    const timer = startUndoTimer(() => {
      timersRef.current.delete(eventId);
      completeMutationRef.current.mutate({ eventId, circleId: sentCircleId }, {
        // SUCCESS: hold the pending id until the TASK ROWS THEMSELVES have
        // refetched, not until the POST settles.
        //
        // `useCompleteEvent`'s own `onSuccess` (useCalendarEvents.ts) already
        // fires `void invalidateEventQueries(...)`, fire-and-forget, because it
        // is shared with callers (EventDetailActions) that must not be slowed
        // down by a refetch they never render. That left a gap here: this
        // hook's OWN onSettled used to clear the pending id the instant the
        // POST resolved, before that fire-and-forget refetch had landed —
        // pendingIds lost the row's "Completing…" entry AND the cached task
        // list was still the pre-completion snapshot, so the row's default
        // "Done" button flashed back for the length of one refetch (and could
        // be tapped again). Web's medication confirm hit the identical shape
        // (see useMedConfirmation.ts's `useConfirmMedication` onSuccess).
        //
        // `refetchQueries` rather than a second `invalidateQueries` — the
        // hook-level onSuccess above already started the tasks refetch (its
        // `invalidateQueries` call performs the same `refetchQueries` under
        // the hood). Calling `invalidateQueries` again here would race it:
        // `Query.fetch` (node_modules/@tanstack/query-core) cancels an
        // in-flight fetch and restarts it whenever `cancelRefetch` (the
        // default) is true — a second real request for the same list.
        // `cancelRefetch: false` takes the other branch instead: no cancel,
        // and `query.fetch` hands back the SAME in-flight promise, so this is
        // only ever waiting on the request `onSuccess` already began.
        // `type: 'active'` matches what `invalidateQueries` itself refetches —
        // only the list(s) actually mounted (OpenTasksCard's and/or
        // TasksPage's), never a background one nothing on screen reads.
        onSuccess: () => {
          const rowsRefetched = queryClient.refetchQueries(
            { queryKey: queryKeys.tasks(sentCircleId), type: 'active' },
            { cancelRefetch: false }
          );
          // Capped — see withRefetchCap: `networkMode: 'online'` pauses a
          // refetch started while offline, which would otherwise strand this
          // row in "Completing…" forever. On timeout the pending id clears
          // anyway, exactly the behavior that shipped before this wait existed.
          void withRefetchCap(rowsRefetched).then(() => clearPendingId(eventId));
        },
        // ERROR: unchanged — clear the pending id immediately. There is no
        // fresher row to wait for; the completion never happened, and
        // `useCompleteEvent`'s own onError already reports it (toast + refetch
        // of the current state).
        onError: () => clearPendingId(eventId),
      });
    }, UNDO_DELAY_MS);

    timersRef.current.set(eventId, { timer, circleId: sentCircleId });
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
  }, []);

  // Cancel the pending completion — nothing is committed.
  const handleUndo = useCallback((eventId: string): void => {
    const entry = timersRef.current.get(eventId);
    if (entry) entry.timer.clear();
    timersRef.current.delete(eventId);
    setPendingIds((prev) => {
      if (!prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  const handleHoldUndo = useCallback((eventId: string, held: boolean): void => {
    timersRef.current.get(eventId)?.timer.hold(held);
  }, []);

  return { pendingIds, handleComplete, handleUndo, handleHoldUndo, flushPending };
}
