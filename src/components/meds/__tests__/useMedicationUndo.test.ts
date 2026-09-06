// The 5-second optimistic-confirm window (mobile parity, useMedicationUndo).
//
// THE MOCK MODELS TANSTACK'S SHARED OBSERVER, NOT JUST "a function that was
// called". `useConfirmMedication` returns ONE `useMutation` observer, and
// v5's `MutationObserver.mutate` is:
//
//     mutate(variables, options) {
//       this.#mutateOptions = options;
//       this.#currentMutation?.removeObserver(this);
//       this.#currentMutation = ...build(...);
//       this.#currentMutation.addObserver(this);
//       return this.#currentMutation.execute(variables);
//     }
//
// so a second `mutate` on the same observer overwrites `#mutateOptions` AND
// detaches the observer from the first mutation — the first call's
// `onSuccess`/`onError` never run, while its REQUEST still goes out. The fake
// below reproduces exactly that for `mutate`, and gives `mutateAsync` the
// per-call promise `execute(variables)` really returns. That is what makes the
// concurrency test below a real one: it passes on `mutateAsync` and fails on
// `mutate`.

import { act, renderHook } from '@testing-library/react';
import { MEDICATION_UNDO_DELAY_MS, useMedicationUndo } from '../useMedicationUndo';
import type { TodaysMedication } from '@/api/medicationConfirmations';

const observer = vi.hoisted(() => {
  interface Call {
    vars: Record<string, unknown>;
    options?: { onSuccess?: () => void; onError?: (e: unknown) => void };
    resolve: (value?: unknown) => void;
    reject: (error: unknown) => void;
  }

  const calls: Call[] = [];
  /** The observer's `#mutateOptions` — one slot, overwritten by every call. */
  let mutateOptions: Call['options'];
  /** The observer's `#currentMutation` — it observes only the latest. */
  let currentCall: Call | null = null;

  function record(vars: Record<string, unknown>): {
    call: Call;
    promise: Promise<unknown>;
  } {
    let resolve!: (value?: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = res as (value?: unknown) => void;
      reject = rej;
    });
    const call: Call = { vars, resolve, reject };
    calls.push(call);
    // Swallow the raw rejection: every consumer path below attaches its own
    // handlers, and an unhandled rejection here would fail the run.
    void promise.catch(() => {});
    return { call, promise };
  }

  const mutate = vi.fn((vars: Record<string, unknown>, options?: Call['options']) => {
    const { call, promise } = record(vars);
    call.options = options;
    mutateOptions = options;
    currentCall = call;
    // The observer notifies with whatever `#mutateOptions` holds AT SETTLE
    // TIME, and only while it is still attached to this mutation.
    void promise.then(
      () => {
        if (currentCall === call) mutateOptions?.onSuccess?.();
      },
      (error) => {
        if (currentCall === call) mutateOptions?.onError?.(error);
      }
    );
    return promise;
  });

  const mutateAsync = vi.fn((vars: Record<string, unknown>) => record(vars).promise);

  return {
    calls,
    mutate,
    mutateAsync,
    reset() {
      calls.length = 0;
      mutateOptions = undefined;
      currentCall = null;
      mutate.mockClear();
      mutateAsync.mockClear();
    },
    settle(index: number, ok = true): void {
      const call = calls[index];
      if (!call) throw new Error(`no call at ${index}`);
      if (ok) call.resolve({ id: `conf-${index}` });
      else call.reject({ success: false, error: { code: 'SERVER_ERROR' } });
    },
  };
});

const useConfirmMedication = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useMedConfirmation', () => ({
  useConfirmMedication: (circleId: string, source: string) =>
    useConfirmMedication(circleId, source),
}));

function makeMed(id: string, name: string, time = '08:00:00'): TodaysMedication {
  return {
    id,
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: '5 mg',
    scheduled_date: '2026-09-05',
    scheduled_time: time,
    confirmation: null,
  } as TodaysMedication;
}

const METFORMIN = makeMed('med-1', 'Metformin');
const WARFARIN = makeMed('med-2', 'Warfarin', '09:00:00');

function setup() {
  const onConfirmed = vi.fn();
  const onError = vi.fn();
  const view = renderHook(() =>
    useMedicationUndo({ circleId: 'circle-1', source: 'care_profile', onConfirmed, onError })
  );
  return { ...view, onConfirmed, onError };
}

/**
 * jsdom's `document.visibilityState` is a read-only getter, so the only way to
 * drive a `visibilitychange` is to redefine it and dispatch by hand.
 */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function hideDocument(): void {
  setVisibility('hidden');
}

function showDocument(): void {
  setVisibility('visible');
}

/** Let the microtask queue drain so a settled promise's handlers have run. */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  observer.reset();
  useConfirmMedication.mockReturnValue({
    mutate: observer.mutate,
    mutateAsync: observer.mutateAsync,
    isPending: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('useMedicationUndo', () => {
  it('sends nothing until the window closes, then posts exactly once', async () => {
    const { result, onConfirmed } = setup();

    act(() => result.current.confirm(METFORMIN, 'taken'));

    expect(result.current.pending).toEqual({ 'med-1': 'taken' });
    expect(observer.calls).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS - 1);
    });
    expect(observer.calls).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(observer.calls).toHaveLength(1);
    expect(observer.calls[0].vars).toEqual({
      event_id: 'med-1',
      status: 'taken',
      scheduled_time: '08:00:00',
    });

    // The badge stays put until the request SETTLES — clearing it mid-flight
    // would restore Take/Skip and invite a duplicate answer on a slow link.
    expect(result.current.pending).toEqual({ 'med-1': 'taken' });

    observer.settle(0);
    await flushMicrotasks();

    expect(result.current.pending).toEqual({});
    expect(onConfirmed).toHaveBeenCalledWith('taken', METFORMIN);
    // Running the clock on cannot re-send it.
    act(() => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS * 3);
    });
    expect(observer.calls).toHaveLength(1);
  });

  it('sends nothing at all when undo lands inside the window', () => {
    const { result, onConfirmed, onError } = setup();

    act(() => result.current.confirm(METFORMIN, 'skipped'));

    let cancelled = false;
    act(() => {
      cancelled = result.current.undo('med-1');
    });
    expect(cancelled).toBe(true);
    expect(result.current.pending).toEqual({});

    act(() => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS * 2);
    });

    expect(observer.calls).toHaveLength(0);
    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('refuses to undo once the request is away', async () => {
    const { result } = setup();

    act(() => result.current.confirm(METFORMIN, 'taken'));
    act(() => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });

    let cancelled = true;
    act(() => {
      cancelled = result.current.undo('med-1');
    });
    // The dose is being recorded; the badge must not claim otherwise.
    expect(cancelled).toBe(false);
    expect(result.current.pending).toEqual({ 'med-1': 'taken' });

    observer.settle(0);
    await flushMicrotasks();
    expect(result.current.pending).toEqual({});
  });

  // ── THE REGRESSION ────────────────────────────────────────────────────────
  //
  // Two doses answered 100ms apart fire their timers 100ms apart, so the SECOND
  // POST leaves while the first is still open. On `mutate(vars, {onSuccess})`
  // the shared observer has already moved on by then: the first dose's
  // callbacks never run, its entry is never cleared, and its UndoBadge is stuck
  // forever — with `undo()` refusing to help, because `fired` is true. The
  // request itself succeeded, so nothing anywhere says so.
  it('clears BOTH entries when two doses overlap in flight', async () => {
    const { result, onConfirmed } = setup();

    // Structural pin: the fix IS the async form. `mutate`'s per-call options do
    // not survive a second call on the same observer (see the file header).
    expect(observer.mutateAsync).not.toHaveBeenCalled();

    act(() => result.current.confirm(METFORMIN, 'taken'));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => result.current.confirm(WARFARIN, 'skipped'));

    // Metformin's timer fires at t=5000, Warfarin's at t=5100 — the 100ms
    // overlap in which the first POST is open and the second one leaves.
    act(() => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS - 100);
    });
    expect(observer.calls).toHaveLength(1);
    expect(observer.calls[0].vars).toMatchObject({ event_id: 'med-1' });

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(observer.calls).toHaveLength(2);
    expect(observer.calls[1].vars).toMatchObject({ event_id: 'med-2' });

    // Nothing was answered through the callback-options form.
    expect(observer.mutate).not.toHaveBeenCalled();
    expect(observer.mutateAsync).toHaveBeenCalledTimes(2);

    // Settle IN ORDER — the first dose lands while the observer's attention is
    // already on the second.
    observer.settle(0);
    await flushMicrotasks();
    observer.settle(1);
    await flushMicrotasks();

    expect(result.current.pending).toEqual({});
    expect(onConfirmed).toHaveBeenCalledTimes(2);
    expect(onConfirmed).toHaveBeenNthCalledWith(1, 'taken', METFORMIN);
    expect(onConfirmed).toHaveBeenNthCalledWith(2, 'skipped', WARFARIN);
  });

  it('reports a rejection to the caller and withdraws the badge', async () => {
    const { result, onConfirmed, onError } = setup();

    act(() => result.current.confirm(METFORMIN, 'taken'));
    act(() => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });

    observer.settle(0, false);
    await flushMicrotasks();

    expect(onConfirmed).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      { success: false, error: { code: 'SERVER_ERROR' } },
      'taken',
      METFORMIN
    );
    expect(result.current.pending).toEqual({});
  });

  // Navigating away inside the window must not drop the answer: the UI already
  // said "Taken", and an unsent confirmation is auto-missed by the cron later.
  it('flushes a pending answer immediately on unmount', () => {
    const { result, unmount } = setup();

    act(() => result.current.confirm(METFORMIN, 'taken'));
    expect(observer.calls).toHaveLength(0);

    unmount();

    expect(observer.calls).toHaveLength(1);
    expect(observer.calls[0].vars).toMatchObject({ event_id: 'med-1', status: 'taken' });
  });

  it('does not re-send an entry whose request is already away', () => {
    const { result, unmount } = setup();

    act(() => result.current.confirm(METFORMIN, 'taken'));
    act(() => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });
    expect(observer.calls).toHaveLength(1);

    unmount();

    // `fired` is the guard: an unmount mid-flight must not duplicate the dose.
    expect(observer.calls).toHaveLength(1);
  });

  // `pagehide`, not `beforeunload`: it fires on bfcache navigation and on
  // mobile Safari's app switch — the web equivalent of mobile's AppState flush.
  it('flushes on pagehide', () => {
    const { result } = setup();

    act(() => result.current.confirm(WARFARIN, 'skipped'));
    expect(observer.calls).toHaveLength(0);

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(observer.calls).toHaveLength(1);
    expect(observer.calls[0].vars).toMatchObject({ event_id: 'med-2', status: 'skipped' });
  });

  // `pagehide` does NOT fire on backgrounding — a tab switch, an app switch or
  // a screen lock never unloads the page, and on mobile Safari that is exactly
  // where the OS may then reclaim the tab with no further event. It is also the
  // flush most likely to actually succeed, since the page is still alive when
  // it runs.
  it('flushes when the document goes hidden', () => {
    const { result } = setup();

    act(() => result.current.confirm(METFORMIN, 'taken'));
    expect(observer.calls).toHaveLength(0);

    act(() => {
      hideDocument();
    });

    expect(observer.calls).toHaveLength(1);
    expect(observer.calls[0].vars).toMatchObject({ event_id: 'med-1', status: 'taken' });
  });

  it('does not flush when the document merely becomes visible again', () => {
    const { result } = setup();

    act(() => result.current.confirm(METFORMIN, 'taken'));
    act(() => {
      showDocument();
    });

    expect(observer.calls).toHaveLength(0);
  });

  it('ignores a second click on a dose already counting down', () => {
    const { result } = setup();

    act(() => result.current.confirm(METFORMIN, 'taken'));
    act(() => result.current.confirm(METFORMIN, 'skipped'));

    act(() => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });

    // One dose, one record — and the FIRST answer, not the mis-click.
    expect(observer.calls).toHaveLength(1);
    expect(observer.calls[0].vars).toMatchObject({ status: 'taken' });
  });

  it('never sends a dose with no scheduled time', () => {
    const { result } = setup();

    act(() => result.current.confirm(makeMed('med-3', 'Aspirin', ''), 'taken'));
    act(() => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });

    expect(observer.calls).toHaveLength(0);
    expect(result.current.pending).toEqual({});
  });
});
