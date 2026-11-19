import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CalendarEvent } from '@/api/calendarEvents';
import { useCompleteEvent } from '@/hooks/useCalendarEvents';
import { queryKeys } from '@/lib/queryKeys';
import { withRefetchCap } from '@/lib/refetchCap';
import { Analytics } from '@/lib/analytics';
import { keepalivePost } from '@/lib/keepalivePost';
import { startUndoTimer, type UndoTimer } from '@/lib/undoTimer';
import {
  confirmFailureOutcome,
  verifyCompletionLanded,
  type OccurrenceRef,
} from '@/lib/confirmVerify';
import {
  cancelWriteRetry,
  enqueueWriteRetry,
  isRetryableTransportFailure,
} from '@/lib/writeRetryQueue';
import { failureContext } from '@/lib/apiErrors';

/** Refetch every list that draws a task row. */
function invalidateTaskQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string
): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks(circleId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) }),
  ]);
}

/** The occurrence a completion verifies against: the row that was tapped. */
function occurrenceOf(task: CalendarEvent): OccurrenceRef & { title?: string } {
  return {
    id: task.id,
    scheduled_date: task.scheduled_date,
    scheduled_time: task.scheduled_time ?? null,
    parent_event_id: task.parent_event_id ?? null,
    event_type: task.event_type,
    title: task.title,
  };
}

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
  /**
   * What the request addresses. A PHYSICAL row (the Tasks tab, Today) is posted by its own id with
   * no body. A VIRTUAL occurrence (the shift detail reads GET /events, which expands a repeating
   * shift task) has a composite id no row matches: it is addressed by its root plus the day, the
   * same address `EventDetailActions` uses.
   */
  target: { eventId: string; scheduledDate?: string };
  /**
   * The row that was tapped, for verify-before-alert: an ambiguous rejection
   * (timeout / network / 5xx) re-reads its day before anything is reported
   * (`useCompleteEvent`'s `occurrence`, lib/confirmVerify.ts).
   */
  occurrence: OccurrenceRef & { title?: string };
  /** The task was added to a shift (docs/plans/shift-tasks.md): its completion is measured. */
  shiftLinked: boolean;
  /** Holdable: paused while the badge is hovered / focused (`lib/undoTimer`). */
  timer: UndoTimer;
  /** The circle the tap was made in — every send path uses THIS, never the
   * circle being rendered when the commit happens. */
  circleId: string;
}

/** What a commit needs, whichever path sends it (timer, flush, queued retry). */
interface CommitJob {
  /** The tapped row's id: the key of `pendingIds`. */
  rowId: string;
  target: PendingCompletion['target'];
  occurrence: PendingCompletion['occurrence'];
  shiftLinked: boolean;
  circleId: string;
}

/** `task_complete:${circle}:${root}:${date}`: one queue entry per occurrence. */
const retryKeyOf = (job: Pick<CommitJob, 'circleId' | 'target'>): string =>
  `task_complete:${job.circleId}:${job.target.eventId}:${job.target.scheduledDate ?? ''}`;

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
export type TaskCompletionSurface = 'tasks' | 'today' | 'shift_detail' | 'calendar';

export function useTaskCompletion(
  circleId: string,
  /** Where the Done was tapped: rides on `shift_task_completed` for a task that belongs to a shift. */
  surface: TaskCompletionSurface = 'tasks'
): UseTaskCompletionResult {
  const completeMutation = useCompleteEvent(circleId);
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
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

  /** Row ids whose completion is waiting in the quiet-retry queue (id -> queue key). */
  const queuedRef = useRef<Map<string, { key: string; circleId: string }>>(new Map());

  /** Drop one id from `pendingIds`, if it is still there. */
  const clearPendingId = useCallback((eventId: string) => {
    setPendingIds((prev) => {
      if (!prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  /**
   * Send one completion. `holdForRefetch`: success keeps the pending id until the task rows
   * themselves have refetched (the timer path). A TRANSPORT failure (timeout / network_error)
   * is not reported: it is queued for the quiet retry (lib/writeRetryQueue.ts) with the row
   * still showing done, and one aggregated notice follows only if it never lands. Anything
   * else is a real refusal, reported by `useCompleteEvent` exactly as before.
   */
  const commitJob = useCallback(
    (job: CommitJob, holdForRefetch: boolean): void => {
      const { rowId, target, occurrence, shiftLinked, circleId: sentCircleId } = job;
      const onCompleted = (): void => {
        if (shiftLinked) Analytics.shiftTaskCompleted({ surface: surfaceRef.current });
        queuedRef.current.delete(rowId);
        if (!holdForRefetch) {
          clearPendingId(rowId);
          return;
        }
        const rowsRefetched = queryClient.refetchQueries(
          { queryKey: queryKeys.tasks(sentCircleId), type: 'active' },
          { cancelRefetch: false }
        );
        // Capped (withRefetchCap): an offline-paused refetch must not strand the row.
        void withRefetchCap(rowsRefetched).then(() => clearPendingId(rowId));
      };
      // mutateAsync, never mutate(vars, {callbacks}): the observer is shared, so a second
      // mutate() replaces the first call's per-call callbacks (BH-009).
      const vars = {
        ...target,
        circleId: sentCircleId,
        source: 'tasks' as const,
        occurrence,
        quietRetry: true,
      };
      completeMutationRef.current.mutateAsync(vars).then(onCompleted, (error: unknown) => {
        if (!isRetryableTransportFailure(error)) {
          // Refused for real: useCompleteEvent's onError already reported it.
          clearPendingId(rowId);
          return;
        }
        const key = retryKeyOf(job);
        queuedRef.current.set(rowId, { key, circleId: sentCircleId });
        // The row keeps its done look ("Completing... Undo") while it waits.
        setPendingIds((prev) => (prev.has(rowId) ? prev : new Set(prev).add(rowId)));
        enqueueWriteRetry({
          key,
          kind: 'task_complete',
          circleId: sentCircleId,
          // Through the mutation, so a refusal on a retry is reported as today and a
          // success runs the same analytics + invalidations as the first attempt.
          send: () => completeMutationRef.current.mutateAsync(vars),
          // The first attempt's response may have been lost AFTER it landed: ask before resending.
          landed: async () => (await verifyCompletionLanded(sentCircleId, occurrence)).verdict === 'recorded',
          onSettled: (via) => {
            if (via === 'landed') {
              Analytics.taskCompleted(sentCircleId);
              void invalidateTaskQueries(queryClient, sentCircleId);
            }
            onCompleted();
          },
          onRefused: () => {
            queuedRef.current.delete(rowId);
            clearPendingId(rowId);
          },
          onGaveUp: () => {
            queuedRef.current.delete(rowId);
            clearPendingId(rowId);
            // Counted under the same event name the immediate path always used, with the
            // verdict of the FIRST attempt's re-read (not_recorded / unverified).
            const outcome = confirmFailureOutcome(error);
            Analytics.errorOccurred('tasks', 'tasks_update_failed', {
              circle_id: sentCircleId,
              ...failureContext('tasks', 'update', error),
              ...(outcome ? { outcome } : {}),
            });
            // Show the truth: the row is not completed.
            void invalidateTaskQueries(queryClient, sentCircleId);
          },
        });
      });
    },
    [clearPendingId, queryClient]
  );
  const commitJobRef = useRef(commitJob);
  commitJobRef.current = commitJob;

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
    timers.forEach(({ timer, circleId: sentCircleId, target, occurrence, shiftLinked }, rowId) => {
      timer.clear();
      const { eventId, scheduledDate } = target;
      const job: CommitJob = { rowId, target, occurrence, shiftLinked, circleId: sentCircleId };
      const request = keepalive
        ? keepalivePost(
            `/circles/${sentCircleId}/events/${eventId}/complete`,
            scheduledDate ? { scheduled_date: scheduledDate } : undefined
          )
        : null;
      if (!request) {
        commitJobRef.current(job, false);
        return;
      }
      request.then(
        (response) => {
          if (response.ok) {
            if (shiftLinked) Analytics.shiftTaskCompleted({ surface: surfaceRef.current });
            // Landed: refresh what the rows read in case the tab comes back.
            void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(sentCircleId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(sentCircleId) });
          } else {
            // Refused while the page is alive: the ordinary path reports it.
            commitJobRef.current(job, false);
          }
        },
        // The keepalive request itself failed (network): the ordinary path sends it,
        // and queues it for the quiet retry if that fails on the network too.
        () => commitJobRef.current(job, false)
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
    // Already waiting in the quiet-retry queue: a second tap is a mis-click, never a second send.
    if (queuedRef.current.has(eventId)) return;
    // EXCEPT a virtual occurrence (shift detail): root + day, see `PendingCompletion.target`.
    const virtual = task.is_virtual === true;
    const target = virtual
      ? { eventId: task.parent_event_id ?? task.id, scheduledDate: task.scheduled_date }
      : { eventId: task.id };
    const shiftLinked = !!task.shift && task.shift.status !== 'outside';
    const occurrence = occurrenceOf(task);
    const existing = timersRef.current.get(eventId);
    if (existing) existing.timer.clear();
    // The circle this tap was made in — see `circleIdRef`.
    const sentCircleId = circleIdRef.current;

    const timer = startUndoTimer(() => {
      timersRef.current.delete(eventId);
      // SUCCESS: hold the pending id until the TASK ROWS THEMSELVES have refetched, not until
      // the POST settles (useCompleteEvent's onSuccess invalidates fire-and-forget, so clearing
      // on POST would flash the Done button over stale rows). `cancelRefetch: false` joins the
      // in-flight refetch instead of restarting it; `type: 'active'` = only mounted lists.
      // See `commitJob` for the failure paths.
      commitJob(
        { rowId: eventId, target, circleId: sentCircleId, occurrence, shiftLinked },
        true
      );
    }, UNDO_DELAY_MS);

    timersRef.current.set(eventId, { timer, circleId: sentCircleId, target, occurrence, shiftLinked });
    setPendingIds((prev) => {
      const next = new Set(prev);
      next.add(eventId);
      return next;
    });
  }, [commitJob]);

  // Cancel the pending completion — nothing is committed.
  const handleUndo = useCallback((eventId: string): void => {
    // Taken back while it waits for a quiet retry: the latest intent wins, nothing is sent.
    // (An attempt already in flight cannot be recalled; if it lands, the refetch shows it.)
    const waiting = queuedRef.current.get(eventId);
    if (waiting) {
      queuedRef.current.delete(eventId);
      if (cancelWriteRetry(waiting.key)) {
        Analytics.taskUndone(waiting.circleId);
        clearPendingId(eventId);
        void invalidateTaskQueries(queryClient, waiting.circleId);
        return;
      }
    }
    const entry = timersRef.current.get(eventId);
    if (entry) {
      entry.timer.clear();
      // The user took the completion back inside the grace period (mobile
      // parity). Counted only when a completion was actually pending.
      Analytics.taskUndone(entry.circleId);
    }
    timersRef.current.delete(eventId);
    setPendingIds((prev) => {
      if (!prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, [clearPendingId, queryClient]);

  const handleHoldUndo = useCallback((eventId: string, held: boolean): void => {
    timersRef.current.get(eventId)?.timer.hold(held);
  }, []);

  return { pendingIds, handleComplete, handleUndo, handleHoldUndo, flushPending };
}
