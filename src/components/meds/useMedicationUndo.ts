import { useCallback, useEffect, useRef, useState } from 'react';
import { devError } from '@/constants/config';
import { useConfirmMedication } from '@/hooks/useMedConfirmation';
import type {
  ConfirmableStatus,
  TodaysMedication,
} from '@/api/medicationConfirmations';
import type { MedicationConfirmSource } from '@/lib/analytics';

/**
 * Optimistic "confirm with a 5-second undo window" for medication doses — the
 * web port of mobile's `useMedicationUndo`.
 *
 *   1. `confirm(med, status)` starts a timer and records the dose as pending;
 *      the row swaps its Take/Skip pair for an `UndoBadge`.
 *   2. `undo(id)` cancels the timer BEFORE it fires — no request is ever sent.
 *   3. When the timer fires the mutation runs. The pending entry is cleared
 *      only once the request settles: clearing it first would restore Take/Skip
 *      mid-flight and invite a duplicate answer on a slow link.
 *   4. Every still-pending confirmation is FLUSHED on unmount, on `pagehide`
 *      and on the document going hidden. Without that, navigating away (or
 *      closing the tab) inside the undo window drops a dose the UI already said
 *      was taken, and the reminder cron later auto-misses it.
 *
 *      THE UNLOAD FLUSH IS BEST-EFFORT, NOT A GUARANTEE. It is an ordinary
 *      `fetch` through the axios client with no `keepalive`, so a browser that
 *      tears the page down before the request leaves will drop it — exactly the
 *      case `pagehide` exists for. `visibilitychange` -> hidden is the half that
 *      usually saves it, because it fires while the page is still alive (tab
 *      switch, app switch, screen lock) and is the last reliable signal mobile
 *      Safari gives before the OS may reclaim the tab. The 5-second window is
 *      short for the same reason: the smaller it is, the less there is to lose.
 *
 * Pending state is keyed by event id, so answering dose B while dose A is
 * still counting down never disturbs A.
 */

export const MEDICATION_UNDO_DELAY_MS = 5000;

interface PendingEntry {
  med: TodaysMedication;
  status: ConfirmableStatus;
  scheduledTime: string;
  timer: ReturnType<typeof setTimeout>;
  /**
   * Set the instant the timer fires and the request goes out — BEFORE it
   * settles. It separates "still counting down" (undoable, flushable) from
   * "already in flight" (neither). Without it, a flush on unmount would re-send
   * a confirmation that was already away, and Undo would clear a badge for a
   * dose the server had already recorded.
   */
  fired: boolean;
}

export interface UseMedicationUndoOptions {
  circleId: string;
  /** Which surface answered the dose — see Analytics.medicationConfirmed. */
  source: MedicationConfirmSource;
  /** The confirmation landed. Surfaces use it for the success toast. */
  onConfirmed?: (status: ConfirmableStatus, med: TodaysMedication) => void;
  /**
   * The POST failed. WITHOUT this the caregiver gets no feedback at all: the
   * row says "Taken", then silently reverts on the next refetch while the dose
   * stays unrecorded.
   */
  onError?: (error: unknown, status: ConfirmableStatus, med: TodaysMedication) => void;
}

export interface UseMedicationUndoResult {
  /** event id → the status it is pending in. Drives the UndoBadge. */
  pending: Record<string, ConfirmableStatus>;
  confirm: (med: TodaysMedication, status: ConfirmableStatus) => void;
  /** `true` when it actually cancelled — `false` once the request is away. */
  undo: (eventId: string) => boolean;
}

export function useMedicationUndo({
  circleId,
  source,
  onConfirmed,
  onError,
}: UseMedicationUndoOptions): UseMedicationUndoResult {
  // `circleId` is captured once per mount rather than read through a ref: safe
  // ONLY because `AppLayout` keys its route content on the pathname, so
  // switching circles remounts this hook (and flushes anything pending) instead
  // of leaving a live timer bound to the previous circle.
  const mutation = useConfirmMedication(circleId, source);
  const [pending, setPending] = useState<Record<string, ConfirmableStatus>>({});

  // Everything the timer callback touches is read through a ref, so a timer
  // armed on one render never fires against a stale closure — and so the
  // unmount flush can run without depending on any of them.
  const entriesRef = useRef(new Map<string, PendingEntry>());
  const mutateAsyncRef = useRef(mutation.mutateAsync);
  mutateAsyncRef.current = mutation.mutateAsync;
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const mountedRef = useRef(true);

  const clearEntry = useCallback((eventId: string): void => {
    entriesRef.current.delete(eventId);
    // A settle that lands after unmount (the flush path) must not set state.
    if (!mountedRef.current) return;
    setPending((current) => {
      if (!(eventId in current)) return current;
      const next = { ...current };
      delete next[eventId];
      return next;
    });
  }, []);

  const send = useCallback(
    (entry: PendingEntry): void => {
      // Marked fired BEFORE sending, by mutating the object already in the Map
      // — synchronous, so a flush (or `undo`) running in the same tick sees it
      // immediately, with no dependency on a state update having landed first.
      entry.fired = true;

      // `mutateAsync`, NOT `mutate(vars, { onSuccess, onError })`.
      //
      // This hook drives ONE shared `useMutation` observer, and per-call
      // options do not survive a second call on it. TanStack v5's
      // `MutationObserver.mutate` is:
      //
      //     mutate(variables, options) {
      //       this.#mutateOptions = options;
      //       this.#currentMutation?.removeObserver(this);
      //       this.#currentMutation = ...build(...);
      //       this.#currentMutation.addObserver(this);
      //       return this.#currentMutation.execute(variables);
      //     }
      //
      // so a second call OVERWRITES `#mutateOptions` and detaches the observer
      // from the first mutation. Both requests still leave — `execute` runs
      // every time — which is exactly why this is invisible in a screenshot:
      // the doses reach the server, but the FIRST one's callbacks never fire.
      // Its entry is never cleared, so its UndoBadge is stuck forever (and
      // `undo()` refuses to help, because `fired` is already true), and a
      // rejection on it raises no toast at all.
      //
      // Two doses overlap easily here: answering the Needs Attention list
      // starts one 5-second timer per dose, so a second dose answered a moment
      // after the first fires its POST while the first is still open. The
      // promise `mutateAsync` returns is per-CALL (`execute(variables)`), so
      // handlers bound to it are unaffected by the observer moving on.
      mutateAsyncRef
        .current({
          event_id: entry.med.id,
          status: entry.status,
          scheduled_time: entry.scheduledTime,
        })
        // `.then(onSuccess, onError)` — TWO ARGUMENTS, never `.then().catch()`.
        // A trailing `.catch()` also catches whatever the SUCCESS handler
        // throws, and `onConfirmed` is caller-supplied UI work (a toast); a
        // throw in it would be reported to the caregiver as a failed dose the
        // server had already recorded, inviting a duplicate confirmation.
        .then(
          () => {
            clearEntry(entry.med.id);
            onConfirmedRef.current?.(entry.status, entry.med);
          },
          (error: unknown) => {
            clearEntry(entry.med.id);
            onErrorRef.current?.(error, entry.status, entry.med);
          }
        )
        // A throw inside EITHER handler above lands here — logged in dev, never
        // re-reported to the caregiver. Chained AFTER the two-argument `.then`
        // so it cannot swallow a mutation rejection into the success path.
        .catch(devError);
    },
    [clearEntry]
  );

  const confirm = useCallback(
    (med: TodaysMedication, status: ConfirmableStatus): void => {
      if (!med.scheduled_time) return;
      // Already counting down (or in flight) — a second click is a mis-click,
      // never a second dose.
      if (entriesRef.current.has(med.id)) return;

      const entry: PendingEntry = {
        med,
        status,
        scheduledTime: med.scheduled_time,
        fired: false,
        timer: setTimeout(() => {
          const live = entriesRef.current.get(med.id);
          if (live) send(live);
        }, MEDICATION_UNDO_DELAY_MS),
      };
      entriesRef.current.set(med.id, entry);
      setPending((current) => ({ ...current, [med.id]: status }));
    },
    [send]
  );

  const undo = useCallback(
    (eventId: string): boolean => {
      const entry = entriesRef.current.get(eventId);
      // Past the window the request is already away; the badge stays until it
      // settles rather than lying about a dose the server is recording.
      if (!entry || entry.fired) return false;
      clearTimeout(entry.timer);
      clearEntry(eventId);
      return true;
    },
    [clearEntry]
  );

  useEffect(() => {
    mountedRef.current = true;
    const entries = entriesRef.current;

    const flush = (): void => {
      for (const entry of entries.values()) {
        if (entry.fired) continue;
        clearTimeout(entry.timer);
        send(entry);
      }
    };

    // `pagehide` (not `beforeunload`): it fires on bfcache navigation and on
    // tab close. `visibilitychange` -> hidden covers BACKGROUNDING, which
    // `pagehide` does not — a tab switch, an app switch or a screen lock never
    // unloads the page, and on mobile Safari that is where the OS may then
    // reclaim the tab without another event. Together they are the web
    // counterpart of mobile's AppState flush, and the same pair
    // `hooks/useTaskCompletion.ts` uses for the task grace window.
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      mountedRef.current = false;
      flush();
    };
  }, [send]);

  return { pending, confirm, undo };
}
