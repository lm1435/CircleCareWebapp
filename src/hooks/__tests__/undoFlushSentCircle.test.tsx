import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

// THE UNDO WINDOW SENDS TO THE CIRCLE THE TAP WAS MADE IN — on every path.
//
// Web port of mobile's `undoFlushSentCircle.test.tsx` (plan mobile-e2e-parity,
// "P-H2 follow-up"). Both 5-second undo hooks — `useTaskCompletion` (task Done)
// and `useMedicationUndo` (dose Take AND Skip) — commit up to 5s after the tap:
// on the entry's own timer, in the unmount flush, or in the pagehide / hidden
// flush. Each must post to the circle the tap was made in, never the circle the
// hook is rendering when the send happens.
//
// Today `AppLayout` keys its `<Outlet>` by pathname, so a circle change
// unmounts these pages before they render with the new circle. These tests
// deliberately DO NOT rely on that: they re-render the SAME hook instance with
// circle B (what a missing key would do) and then let each send path run.
//
// REAL hooks all the way down — real `useTaskCompletion` / `useMedicationUndo`,
// real `useCompleteEvent` / `useConfirmMedication`, real api modules and a real
// QueryClient. Only the HTTP boundary (`apiClient`, mocked globally in
// src/test/setup.ts) is replaced, by a fake of the backend's circle scoping:
// both routes filter the event by the URL's circle, so a wrong circle is a 404.

vi.mock('@/components/ui', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    taskCompleted: vi.fn(),
    appointmentCompleted: vi.fn(),
    medicationConfirmed: vi.fn(),
    errorOccurred: vi.fn(),
  },
}));

import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { useTaskCompletion, UNDO_DELAY_MS } from '@/hooks/useTaskCompletion';
import {
  useMedicationUndo,
  MEDICATION_UNDO_DELAY_MS,
} from '@/components/meds/useMedicationUndo';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { ConfirmableStatus, TodaysMedication } from '@/api/medicationConfirmations';

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;

const A = 'circle-A';
const B = 'circle-B';

/** Which circle each event really lives in — the backend's `circle_id` column. */
const EVENT_CIRCLE: Record<string, string> = {
  'task-a': A,
  'task-b': B,
  'med-a': A,
  'med-b': B,
};

function makeTask(id: string): CalendarEvent {
  return {
    id,
    circle_id: EVENT_CIRCLE[id],
    event_type: 'task',
    title: 'Water plants',
    scheduled_date: '2026-03-15',
    scheduled_time: null,
    completed_at: null,
    assigned_to: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
  } as CalendarEvent;
}

function makeMed(id: string): TodaysMedication {
  return {
    id,
    event_type: 'medication',
    title: 'Metformin',
    medication_name: 'Metformin',
    medication_dosage: '5 mg',
    scheduled_date: '2026-09-05',
    scheduled_time: '08:00:00',
    confirmation: null,
  } as TodaysMedication;
}

const TASK_A = makeTask('task-a');
const TASK_B = makeTask('task-b');
const MED_A = makeMed('med-a');
const MED_B = makeMed('med-b');

const NOT_FOUND = { success: false, error: { code: 'NOT_FOUND', message: 'Event not found' } };

/** Fake backend: resolves only when the URL's circle owns the event. */
function installBackend(): void {
  post.mockImplementation((path: string, body?: { event_id?: string }) => {
    const task = /^\/circles\/([^/]+)\/events\/([^/]+)\/complete$/.exec(path);
    if (task) {
      const [, circleId, eventId] = task;
      if (EVENT_CIRCLE[eventId] !== circleId) return Promise.reject(NOT_FOUND);
      return Promise.resolve({
        success: true,
        data: { event: { ...makeTask(eventId), completed_at: '2026-03-15T12:00:00Z' } },
      });
    }
    const dose = /^\/circles\/([^/]+)\/medications\/confirm$/.exec(path);
    if (dose) {
      const [, circleId] = dose;
      const eventId = body?.event_id ?? '';
      if (EVENT_CIRCLE[eventId] !== circleId) return Promise.reject(NOT_FOUND);
      return Promise.resolve({
        success: true,
        data: { confirmation: { id: `conf-${eventId}`, event_id: eventId } },
      });
    }
    return Promise.reject(new Error(`unexpected POST ${path}`));
  });
  // Lists refetched after a success — contents are irrelevant here.
  get.mockResolvedValue({ success: true, data: [] });
}

/** Every POST made, as `path` (+ the body's event_id for doses). */
function postedPaths(): string[] {
  return post.mock.calls.map(([path]) => path as string);
}

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Let TanStack's mutation pipeline (and the promises after it) run. */
async function drain(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);
  });
}

function circlesIn(calls: unknown[][]): Set<unknown> {
  const out = new Set<unknown>();
  for (const [filters] of calls) {
    const key = (filters as { queryKey?: readonly unknown[] } | undefined)?.queryKey;
    if (key && key.length > 1) out.add(key[1]);
  }
  return out;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  vi.mocked(Analytics.taskCompleted).mockClear();
  vi.mocked(Analytics.medicationConfirmed).mockClear();
  vi.mocked(Analytics.errorOccurred).mockClear();
  installBackend();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Task completion — useTaskCompletion
// ---------------------------------------------------------------------------

describe('useTaskCompletion — every send path posts to the circle the task was completed in', () => {
  function renderTasks() {
    const { queryClient, wrapper } = makeWrapper();
    const hook = renderHook(({ circleId }) => useTaskCompletion(circleId), {
      wrapper,
      initialProps: { circleId: A },
    });
    return { queryClient, ...hook };
  }

  it('unmount flush after a re-render with circle B: posts to A', async () => {
    const { result, rerender, unmount } = renderTasks();
    act(() => result.current.handleComplete(TASK_A));
    // The missing-key case: same instance, now rendering circle B.
    rerender({ circleId: B });

    unmount();
    await drain();

    expect(postedPaths()).toEqual([`/circles/${A}/events/task-a/complete`]);
    expect(Analytics.taskCompleted).toHaveBeenCalledWith(A);
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
  });

  it('flushPending after a re-render with circle B: posts to A', async () => {
    const { result, rerender, unmount } = renderTasks();
    act(() => result.current.handleComplete(TASK_A));
    rerender({ circleId: B });

    act(() => result.current.flushPending());
    await drain();

    expect(postedPaths()).toEqual([`/circles/${A}/events/task-a/complete`]);
    expect(Analytics.taskCompleted).toHaveBeenCalledWith(A);
    unmount();
    // Nothing left to flush — no second send.
    await drain();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('pagehide flush after a re-render with circle B: posts to A', async () => {
    const { result, rerender, unmount } = renderTasks();
    act(() => result.current.handleComplete(TASK_A));
    rerender({ circleId: B });

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await drain();

    expect(postedPaths()).toEqual([`/circles/${A}/events/task-a/complete`]);
    unmount();
  });

  it('timer path after a re-render with circle B: posts, reports, invalidates and waits for A', async () => {
    const { queryClient, result, rerender, unmount } = renderTasks();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const refetch = vi.spyOn(queryClient, 'refetchQueries');
    act(() => result.current.handleComplete(TASK_A));
    rerender({ circleId: B });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(UNDO_DELAY_MS);
    });
    await drain();

    expect(postedPaths()).toEqual([`/circles/${A}/events/task-a/complete`]);
    expect(Analytics.taskCompleted).toHaveBeenCalledWith(A);
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
    // Cache work belongs to A too — nothing of B's is touched.
    expect(circlesIn(invalidate.mock.calls)).toEqual(new Set([A]));
    expect(refetch).toHaveBeenCalledWith(
      { queryKey: queryKeys.tasks(A), type: 'active' },
      { cancelRefetch: false }
    );
    unmount();
  });

  it('a mixed A + B flush sends each completion to its own circle', async () => {
    const { result, rerender, unmount } = renderTasks();
    act(() => result.current.handleComplete(TASK_A));
    rerender({ circleId: B });
    act(() => result.current.handleComplete(TASK_B));

    unmount();
    await drain();

    expect(postedPaths().sort()).toEqual(
      [`/circles/${A}/events/task-a/complete`, `/circles/${B}/events/task-b/complete`].sort()
    );
    expect(Analytics.taskCompleted).toHaveBeenCalledWith(A);
    expect(Analytics.taskCompleted).toHaveBeenCalledWith(B);
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
  });

  it('a refused completion is reported against the circle it was sent to', async () => {
    const { result, rerender, unmount } = renderTasks();
    // Unknown to the fake backend — refused even in A.
    act(() => result.current.handleComplete(makeTask('task-unknown')));
    rerender({ circleId: B });

    unmount();
    await drain();

    expect(postedPaths()).toEqual([`/circles/${A}/events/task-unknown/complete`]);
    expect(Analytics.errorOccurred).toHaveBeenCalledWith(
      'calendar_events',
      'calendar_events_mutation_error',
      expect.objectContaining({ circle_id: A })
    );
  });

  it('control: no circle change — posts to the circle on screen', async () => {
    const { result, unmount } = renderTasks();
    act(() => result.current.handleComplete(TASK_A));
    unmount();
    await drain();
    expect(postedPaths()).toEqual([`/circles/${A}/events/task-a/complete`]);
  });
});

// ---------------------------------------------------------------------------
// Dose taken / skipped — useMedicationUndo
// ---------------------------------------------------------------------------

describe('useMedicationUndo — every send path posts to the circle the dose was answered in', () => {
  function renderMeds() {
    const { queryClient, wrapper } = makeWrapper();
    const onConfirmed = vi.fn();
    const onError = vi.fn();
    const hook = renderHook(
      ({ circleId }) =>
        useMedicationUndo({ circleId, source: 'care_profile', onConfirmed, onError }),
      { wrapper, initialProps: { circleId: A } }
    );
    return { queryClient, onConfirmed, onError, ...hook };
  }

  function confirmBodies(): Array<{ path: string; body: Record<string, unknown> }> {
    return post.mock.calls.map(([path, body]) => ({
      path: path as string,
      body: body as Record<string, unknown>,
    }));
  }

  it.each<ConfirmableStatus>(['taken', 'skipped'])(
    '%s — unmount flush after a re-render with circle B: posts to A',
    async (status) => {
      const { result, rerender, unmount, onConfirmed, onError } = renderMeds();
      act(() => result.current.confirm(MED_A, status));
      rerender({ circleId: B });

      unmount();
      await drain();

      expect(confirmBodies()).toEqual([
        {
          path: `/circles/${A}/medications/confirm`,
          // The circle never leaks into the request body.
          body: { event_id: 'med-a', status, scheduled_time: '08:00:00' },
        },
      ]);
      expect(Analytics.medicationConfirmed).toHaveBeenCalledWith(A, status, 'care_profile');
      expect(onError).not.toHaveBeenCalled();
      // Settled after unmount — the caller still hears about it, with A.
      expect(onConfirmed).toHaveBeenCalledWith(status, MED_A, A);
    }
  );

  it.each<ConfirmableStatus>(['taken', 'skipped'])(
    '%s — timer path after a re-render with circle B: posts, reports and invalidates for A',
    async (status) => {
      const { queryClient, result, rerender, unmount, onConfirmed, onError } = renderMeds();
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      act(() => result.current.confirm(MED_A, status));
      rerender({ circleId: B });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(MEDICATION_UNDO_DELAY_MS);
      });
      await drain();

      expect(postedPaths()).toEqual([`/circles/${A}/medications/confirm`]);
      expect(Analytics.medicationConfirmed).toHaveBeenCalledWith(A, status, 'care_profile');
      expect(circlesIn(invalidate.mock.calls)).toEqual(new Set([A]));
      expect(onError).not.toHaveBeenCalled();
      expect(onConfirmed).toHaveBeenCalledWith(status, MED_A, A);
      expect(result.current.pending).toEqual({});
      unmount();
    }
  );

  it('visibility-hidden flush after a re-render with circle B: posts to A', async () => {
    const { result, rerender, unmount } = renderMeds();
    act(() => result.current.confirm(MED_A, 'taken'));
    rerender({ circleId: B });

    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    visibility.mockRestore();
    await drain();

    expect(postedPaths()).toEqual([`/circles/${A}/medications/confirm`]);
    unmount();
  });

  it('a mixed A (taken) + B (skipped) flush sends each dose to its own circle', async () => {
    const { result, rerender, unmount, onConfirmed, onError } = renderMeds();
    act(() => result.current.confirm(MED_A, 'taken'));
    rerender({ circleId: B });
    act(() => result.current.confirm(MED_B, 'skipped'));

    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await drain();

    expect(confirmBodies()).toEqual([
      {
        path: `/circles/${A}/medications/confirm`,
        body: { event_id: 'med-a', status: 'taken', scheduled_time: '08:00:00' },
      },
      {
        path: `/circles/${B}/medications/confirm`,
        body: { event_id: 'med-b', status: 'skipped', scheduled_time: '08:00:00' },
      },
    ]);
    expect(Analytics.medicationConfirmed).toHaveBeenCalledWith(A, 'taken', 'care_profile');
    expect(Analytics.medicationConfirmed).toHaveBeenCalledWith(B, 'skipped', 'care_profile');
    expect(onError).not.toHaveBeenCalled();
    expect(onConfirmed).toHaveBeenCalledWith('taken', MED_A, A);
    expect(onConfirmed).toHaveBeenCalledWith('skipped', MED_B, B);
    unmount();
  });

  it('a refused send reports the circle it was sent to', async () => {
    const { result, rerender, unmount, onError } = renderMeds();
    // An event the fake backend does not know in A — refused even in A.
    const stranger = makeMed('med-unknown');
    act(() => result.current.confirm(stranger, 'taken'));
    rerender({ circleId: B });

    unmount();
    await drain();

    expect(postedPaths()).toEqual([`/circles/${A}/medications/confirm`]);
    expect(onError).toHaveBeenCalledWith(NOT_FOUND, 'taken', stranger, A);
    expect(Analytics.errorOccurred).toHaveBeenCalledWith(
      'medication_confirm',
      'medication_confirm_error',
      expect.objectContaining({ circle_id: A })
    );
  });
});
