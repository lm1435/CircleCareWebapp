import { useCallback, useEffect, useRef, useState } from 'react';
import { devError } from '@/constants/config';
import { keepalivePost } from '@/lib/keepalivePost';
import { startUndoTimer, type UndoTimer } from '@/lib/undoTimer';
import { useLogAsNeededDose } from '@/hooks/useAsNeeded';
import {
  asNeededRecentlyLogged,
  type LogAsNeededDoseRequest,
  type LogAsNeededDoseResult,
  type RecentlyLoggedConflict,
} from '@/api/medicationAsNeeded';
import { isAmbiguousConfirmFailure } from '@/lib/confirmVerify';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { MEDICATION_UNDO_DELAY_MS } from './useMedicationUndo';

/**
 * "Gave a dose" with the SAME 5-second undo window as a scheduled dose
 * (`useMedicationUndo`), for as-needed medications.
 *
 *   1. `log(entry)` records the dose as pending and arms a 5 s timer. The card
 *      swaps "Gave a dose" for an `UndoBadge`. NOTHING has been sent.
 *   2. `undo(eventId)` cancels the timer — no request, no push, no feed row.
 *   3. When the timer fires the POST goes out. The pending entry is cleared only
 *      once it SETTLES (clearing it first would put the button back mid-flight
 *      and invite a second dose on a slow link).
 *   4. Still-pending entries are flushed on unmount, `pagehide` and the document
 *      going hidden (a keepalive POST on the last two) — a dose the card already
 *      said was logged must not be lost with the tab. Every send carries the
 *      entry's `client_request_id`, so the keepalive attempt and the ordinary
 *      fallback can overlap without ever writing two doses (the server replays).
 *
 * A 409 `AS_NEEDED_DOSE_RECENTLY_LOGGED` is NOT a failure: another member logged
 * the same medication moments ago. `onRecentlyLogged` hands the caller the entry
 * and who/when; on "Log another" the caller re-sends it through `logNow` with
 * `acknowledge_recent: true` and the SAME `client_request_id`.
 */

export interface AsNeededLogEntry {
  eventId: string;
  /** For toasts and accessible names only — never sent. */
  name: string;
  /** The circle the dose was logged in; every send path posts to THIS circle. */
  circleId: string;
  body: LogAsNeededDoseRequest;
}

interface PendingEntry extends AsNeededLogEntry {
  /** Holdable: paused while the badge is hovered / focused (`lib/undoTimer`). */
  timer: UndoTimer | null;
  fired: boolean;
}

export interface UseAsNeededUndoOptions {
  circleId: string;
  onLogged?: (entry: AsNeededLogEntry, result: LogAsNeededDoseResult) => void;
  onRecentlyLogged?: (entry: AsNeededLogEntry, conflict: RecentlyLoggedConflict) => void;
  onError?: (error: unknown, entry: AsNeededLogEntry) => void;
}

export interface UseAsNeededUndoResult {
  /** eventIds whose dose is counting down or in flight. */
  pending: Record<string, true>;
  /** eventIds whose POST has already left (Undo is no longer possible). */
  inFlight: Record<string, true>;
  /** Start the 5 s window. */
  log: (entry: Omit<AsNeededLogEntry, 'circleId'>) => void;
  /** Send immediately, no undo window (the user already confirmed twice). */
  logNow: (entry: AsNeededLogEntry) => void;
  /** `true` when it actually cancelled; `false` once the request is away. */
  undo: (eventId: string) => boolean;
  /**
   * Pause (`true`) or resume (`false`) this item's countdown — the badge calls
   * it while the pointer is over it or keyboard focus is inside it (WCAG 2.2.1).
   * No-op once the request is away or the item is gone.
   */
  hold: (eventId: string, held: boolean) => void;
}

export function useAsNeededUndo({
  circleId,
  onLogged,
  onRecentlyLogged,
  onError,
}: UseAsNeededUndoOptions): UseAsNeededUndoResult {
  const mutation = useLogAsNeededDose(circleId);
  const [pending, setPending] = useState<Record<string, true>>({});
  const [inFlight, setInFlight] = useState<Record<string, true>>({});

  const entriesRef = useRef(new Map<string, PendingEntry>());
  const mutateAsyncRef = useRef(mutation.mutateAsync);
  mutateAsyncRef.current = mutation.mutateAsync;
  const onLoggedRef = useRef(onLogged);
  onLoggedRef.current = onLogged;
  const onRecentRef = useRef(onRecentlyLogged);
  onRecentRef.current = onRecentlyLogged;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const mountedRef = useRef(true);

  const clearEntry = useCallback((eventId: string): void => {
    entriesRef.current.delete(eventId);
    if (!mountedRef.current) return;
    setPending((cur) => {
      if (!(eventId in cur)) return cur;
      const next = { ...cur };
      delete next[eventId];
      return next;
    });
    setInFlight((cur) => {
      if (!(eventId in cur)) return cur;
      const next = { ...cur };
      delete next[eventId];
      return next;
    });
  }, []);

  const sendViaMutation = useCallback(
    (entry: PendingEntry, retried = false): void => {
      // `mutateAsync` (per-call promise), never `mutate(vars, {onSuccess})` on a
      // shared observer: a second dose started while the first is open would
      // detach the first's callbacks and strand its badge. See useMedicationUndo.
      mutateAsyncRef
        .current({ eventId: entry.eventId, body: entry.body, circleId: entry.circleId })
        .then(
          (result) => {
            clearEntry(entry.eventId);
            onLoggedRef.current?.(entry, result);
          },
          (error: unknown) => {
            const conflict = asNeededRecentlyLogged(error);
            if (!conflict && !retried && isAmbiguousConfirmFailure(error)) {
              // AMBIGUOUS (timeout / network / 5xx): the dose may or may not have
              // landed. Retry ONCE with the SAME client_request_id — the server
              // replays a dose it already wrote instead of writing a second.
              sendViaMutation(entry, true);
              return;
            }
            clearEntry(entry.eventId);
            if (conflict) {
              onRecentRef.current?.(entry, conflict);
              return;
            }
            onErrorRef.current?.(error, entry);
          }
        )
        .catch(devError);
    },
    [clearEntry]
  );

  const send = useCallback(
    (entry: PendingEntry, viaKeepalive = false): void => {
      entry.fired = true;
      if (mountedRef.current) setInFlight((cur) => ({ ...cur, [entry.eventId]: true }));
      const request = viaKeepalive
        ? keepalivePost(
            `/circles/${entry.circleId}/medications/${entry.eventId}/as-needed-doses`,
            entry.body
          )
        : null;
      if (!request) {
        sendViaMutation(entry);
        return;
      }
      request.then(
        (response) => {
          if (!response.ok) {
            // Refused (a 409 prompt, a 403…) while the page is still alive: the
            // ordinary path classifies it and raises the right UI. Same
            // client_request_id, so a request that DID land is replayed.
            sendViaMutation(entry);
            return;
          }
          const qc = queryClient;
          void qc.invalidateQueries({ queryKey: queryKeys.asNeededSummary(entry.circleId) });
          void qc.invalidateQueries({ queryKey: queryKeys.asNeededDoses(entry.circleId) });
          void qc.invalidateQueries({ queryKey: queryKeys.activityFeed(entry.circleId) });
          clearEntry(entry.eventId);
        },
        () => sendViaMutation(entry)
      );
    },
    [clearEntry, sendViaMutation]
  );

  const log = useCallback(
    (input: Omit<AsNeededLogEntry, 'circleId'>): void => {
      // Counting down or in flight: a second click is a mis-click, never a second dose.
      if (entriesRef.current.has(input.eventId)) return;
      const entry: PendingEntry = {
        ...input,
        circleId,
        fired: false,
        timer: startUndoTimer(() => {
          const live = entriesRef.current.get(input.eventId);
          if (live) send(live);
        }, MEDICATION_UNDO_DELAY_MS),
      };
      entriesRef.current.set(input.eventId, entry);
      setPending((cur) => ({ ...cur, [input.eventId]: true }));
    },
    [send, circleId]
  );

  const logNow = useCallback(
    (input: AsNeededLogEntry): void => {
      if (entriesRef.current.has(input.eventId)) return;
      const entry: PendingEntry = { ...input, fired: false, timer: null };
      entriesRef.current.set(input.eventId, entry);
      setPending((cur) => ({ ...cur, [input.eventId]: true }));
      send(entry);
    },
    [send]
  );

  const undo = useCallback(
    (eventId: string): boolean => {
      const entry = entriesRef.current.get(eventId);
      if (!entry || entry.fired) return false;
      entry.timer?.clear();
      clearEntry(eventId);
      return true;
    },
    [clearEntry]
  );

  useEffect(() => {
    mountedRef.current = true;
    const entries = entriesRef.current;
    const flush = (viaKeepalive = false): void => {
      for (const entry of entries.values()) {
        if (entry.fired) continue;
        entry.timer?.clear();
        send(entry, viaKeepalive);
      }
    };
    const onPageHide = (): void => flush(true);
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      mountedRef.current = false;
      flush();
    };
  }, [send]);

  const hold = useCallback((eventId: string, held: boolean): void => {
    const entry = entriesRef.current.get(eventId);
    if (!entry || entry.fired) return;
    entry.timer?.hold(held);
  }, []);

  return { pending, inFlight, log, logNow, undo, hold };
}
