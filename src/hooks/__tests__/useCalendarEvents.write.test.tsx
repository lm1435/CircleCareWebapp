import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api module's WRITE functions only (keep the rest — types — intact).
// The hooks call these named exports; controlling them lets us assert the exact
// endpoint args and drive success/rejection.
vi.mock('@/api/calendarEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/calendarEvents')>();
  return {
    ...actual,
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    completeEvent: vi.fn(),
    setMedicationStatus: vi.fn(),
  };
});

// Deterministic translations so error toasts assert on a stable key string.
// `initReactI18next` is stubbed because the `@/i18n` singleton (now pulled in
// transitively via the calendar dateMath formatters) registers it via i18n.use().
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

const promptUpgrade = vi.fn();
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade }) }));

import {
  createEvent,
  updateEvent,
  deleteEvent,
  completeEvent,
  setMedicationStatus,
  type CalendarEvent,
  type MedicationStatusResult,
} from '@/api/calendarEvents';
import { queryKeys } from '@/lib/queryKeys';
import { Analytics } from '@/lib/analytics';
import {
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
  useCompleteEvent,
  useMedicationStatus,
} from '@/hooks/useCalendarEvents';

const CIRCLE_ID = 'circle-1';
const EVENT_ID = 'event-1';

const mockCreate = vi.mocked(createEvent);
const mockUpdate = vi.mocked(updateEvent);
const mockDelete = vi.mocked(deleteEvent);
const mockComplete = vi.mocked(completeEvent);
const mockSetStatus = vi.mocked(setMedicationStatus);

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: EVENT_ID,
    circle_id: CIRCLE_ID,
    event_type: 'appointment',
    title: 'Checkup',
    scheduled_date: '2026-07-01',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

/** Fresh QueryClient + provider per test, with a spy on invalidateQueries. */
function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidateSpy, wrapper };
}

type InvalidateArg = Parameters<QueryClient['invalidateQueries']>[0];

/** Was invalidateQueries called with this exact queryKey (deep-equal)? */
function invalidatedWith(
  invalidateSpy: { mock: { calls: [InvalidateArg?, ...unknown[]][] } },
  key: readonly unknown[]
) {
  return invalidateSpy.mock.calls.some(
    (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(key)
  );
}

const PERMISSION_ENVELOPE = {
  success: false,
  error: { code: 'VIEW_ONLY', message: 'no edit' },
};
const SUBSCRIPTION_ENVELOPE = {
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'upgrade' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCreateEvent', () => {
  it('POSTs the event body and invalidates the right keys on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockResolvedValue(makeEvent());

    const { result } = renderHook(() => useCreateEvent(CIRCLE_ID), { wrapper });
    const body = { event_type: 'task' as const, title: 'Pick up Rx', scheduled_date: '2026-07-02' };
    result.current.mutate(body);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCreate).toHaveBeenCalledWith(CIRCLE_ID, body);

    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvents(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvent(CIRCLE_ID, EVENT_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.tasks(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.activityFeed(CIRCLE_ID))).toBe(true);
  });

  it('surfaces a 403 via the apiErrors helper (permission toast + refetch circles)', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockRejectedValue(PERMISSION_ENVELOPE);

    const { result } = renderHook(() => useCreateEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ event_type: 'task', title: 'x', scheduled_date: '2026-07-02' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('surfaces a 402 via the apiErrors helper (subscription toast)', async () => {
    const { wrapper } = setup();
    mockCreate.mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useCreateEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ event_type: 'task', title: 'x', scheduled_date: '2026-07-02' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalled();
  });

  // Error visibility (mobile parity): every failed event write is counted as
  // `error_occurred` with a CLOSED-SET `code` — never the toast copy, never the
  // rejection's message — on every branch of the shared onError.
  it.each([
    ['permission', PERMISSION_ENVELOPE, 'VIEW_ONLY'],
    ['subscription', SUBSCRIPTION_ENVELOPE, 'SUBSCRIPTION_REQUIRED'],
    ['generic', { success: false, error: { code: 'CONFLICT', message: 'pat@example.com' } }, 'CONFLICT'],
    ['message-only', { message: 'saving for pat@example.com failed' }, 'unknown_error'],
  ])('reports error_occurred with a bounded code on the %s branch', async (_label, rejection, code) => {
    const errorOccurred = vi.spyOn(Analytics, 'errorOccurred').mockImplementation(() => {});
    const { wrapper } = setup();
    mockCreate.mockRejectedValue(rejection);

    const { result } = renderHook(() => useCreateEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ event_type: 'task', title: 'x', scheduled_date: '2026-07-02' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(errorOccurred).toHaveBeenCalledTimes(1);
    expect(errorOccurred).toHaveBeenCalledWith('calendar_events', 'calendar_events_mutation_error', {
      circle_id: CIRCLE_ID,
      code,
    });
    expect(JSON.stringify(errorOccurred.mock.calls[0])).not.toContain('@');
    errorOccurred.mockRestore();
  });
});

describe('useUpdateEvent', () => {
  it('PATCHes the parent-series eventId with a partial body and invalidates', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdate.mockResolvedValue(makeEvent());

    const { result } = renderHook(() => useUpdateEvent(CIRCLE_ID), { wrapper });
    // Caller passes parent series id (parent_event_id || id) — plain PATCH, no scope.
    result.current.mutate({ eventId: 'parent-1', data: { title: 'New title' } });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdate).toHaveBeenCalledWith(CIRCLE_ID, 'parent-1', { title: 'New title' });

    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvent(CIRCLE_ID, 'parent-1'))).toBe(
      true
    );
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvents(CIRCLE_ID))).toBe(true);
  });
});

describe('useDeleteEvent', () => {
  it('passes deleteScope + scheduledDate through for a scoped (recurring) delete', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({
      eventId: 'parent-1',
      deleteScope: 'future',
      scheduledDate: '2026-07-05',
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith(CIRCLE_ID, 'parent-1', {
      deleteScope: 'future',
      scheduledDate: '2026-07-05',
    });
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvents(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.activityFeed(CIRCLE_ID))).toBe(true);
  });

  it('passes no scope params for a non-recurring delete', async () => {
    const { wrapper } = setup();
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: EVENT_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith(CIRCLE_ID, EVENT_ID, {
      deleteScope: undefined,
      scheduledDate: undefined,
    });
  });
});

describe('useCompleteEvent', () => {
  it('POSTs to the complete endpoint and invalidates tasks + calendar', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockComplete.mockResolvedValue(makeEvent({ completed_at: '2026-07-01T10:00:00Z' }));

    const { result } = renderHook(() => useCompleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: EVENT_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // No occurrence date reaches the api layer, so it sends no body — the
    // request every shipped client makes.
    expect(mockComplete).toHaveBeenCalledWith(CIRCLE_ID, EVENT_ID, undefined);
    expect(invalidatedWith(invalidateSpy, queryKeys.tasks(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvent(CIRCLE_ID, EVENT_ID))).toBe(true);
  });

  // WHICH OCCURRENCE. A recurring series is addressed by its ROOT, so the date
  // is the only thing that tells the server which day was completed.
  it('forwards scheduledDate, and invalidates the TARGET (root) id', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockComplete.mockResolvedValue(makeEvent({ completed_at: '2026-08-06T10:00:00Z' }));

    const { result } = renderHook(() => useCompleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: 'parent-1', scheduledDate: '2026-08-06' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockComplete).toHaveBeenCalledWith(CIRCLE_ID, 'parent-1', '2026-08-06');
    // The invalidation follows the id that was POSTed, not the response row.
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvent(CIRCLE_ID, 'parent-1'))).toBe(
      true
    );
  });

  it('surfaces a non-permission error with the saveFailed toast', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockComplete.mockRejectedValue({ success: false, error: { code: 'CONFLICT' } });

    const { result } = renderHook(() => useCompleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: EVENT_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.saveFailed', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvents(CIRCLE_ID))).toBe(true);
  });
});

describe('useMedicationStatus', () => {
  // A discontinue/reactivate cannot be patched into the cache — which
  // occurrences it adds or removes is decided server-side and the response
  // carries counts, not rows. So the caller WAITS for the calendar refetch
  // before announcing success, and that wait is capped.

  const STATUS_RESULT: MedicationStatusResult = {
    event: { id: EVENT_ID, parent_event_id: null, discontinued_at: null },
    discontinued: false,
    affected_count: 3,
    series_count: 1,
  };

  /**
   * Make the calendar-events invalidation controllable; every other family
   * resolves immediately, exactly as fire-and-forget invalidation behaves.
   */
  function deferCalendarInvalidation(invalidateSpy: ReturnType<typeof setup>['invalidateSpy']) {
    let release!: () => void;
    const calendarRefetched = new Promise<void>((resolve) => {
      release = resolve;
    });
    invalidateSpy.mockImplementation((filters?: InvalidateArg) =>
      JSON.stringify(filters?.queryKey) === JSON.stringify(queryKeys.calendarEvents(CIRCLE_ID))
        ? calendarRefetched
        : Promise.resolve()
    );
    return { release };
  }

  const VARIABLES = { eventId: EVENT_ID, discontinued: false, scope: 'medication' as const };

  it('holds mutateAsync open until the calendar refetch lands', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockSetStatus.mockResolvedValue(STATUS_RESULT);
    const { release } = deferCalendarInvalidation(invalidateSpy);

    const { result } = renderHook(() => useMedicationStatus(CIRCLE_ID), { wrapper });
    let settled = false;
    const pending = result.current.mutateAsync(VARIABLES).then(() => {
      settled = true;
    });

    await waitFor(() => expect(mockSetStatus).toHaveBeenCalledWith(CIRCLE_ID, EVENT_ID, false, 'medication'));
    // The PATCH has returned, but the caller must NOT be told yet: the toast
    // would land over a roster still showing the med in its old section.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    release();
    await pending;
    expect(settled).toBe(true);
  });

  it('gives up waiting at the cap when the refetch never settles (paused while offline)', async () => {
    vi.useFakeTimers();
    try {
      const { invalidateSpy, wrapper } = setup();
      mockSetStatus.mockResolvedValue(STATUS_RESULT);
      // Never released — `networkMode: 'online'` PAUSES a refetch attempted
      // offline, and a paused refetch's promise does not settle until
      // connectivity returns. Without the cap the confirmation is swallowed
      // entirely and the caregiver re-runs an action that already worked.
      deferCalendarInvalidation(invalidateSpy);

      const { result } = renderHook(() => useMedicationStatus(CIRCLE_ID), { wrapper });
      let settled = false;
      const pending = result.current.mutateAsync(VARIABLES).then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(2500);
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the cap timer when the refetch wins the race', async () => {
    // Capture the id the CAP timer was given, so the assertion below names it.
    //
    // `expect(clearTimeoutSpy).toHaveBeenCalled()` alone could not fail:
    // `waitFor` unconditionally clears its OWN overall-timeout timer, so the
    // spy always had a call. Deleting the `.finally(() => clearTimeout(...))`
    // under test left this green.
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const { invalidateSpy, wrapper } = setup();
      mockSetStatus.mockResolvedValue(STATUS_RESULT);
      const { release } = deferCalendarInvalidation(invalidateSpy);

      const { result } = renderHook(() => useMedicationStatus(CIRCLE_ID), { wrapper });
      const pending = result.current.mutateAsync(VARIABLES);
      await waitFor(() => expect(mockSetStatus).toHaveBeenCalled());
      release();
      await pending;

      // A stray 2.5s timer per mutation keeps the event loop awake for nothing
      // (and holds the test process open).
      //
      // The CAP timer is the 2500ms one; find the id it was assigned and assert
      // THAT id was cleared. Any other timer the test framework happens to
      // create is irrelevant.
      const capCall = setTimeoutSpy.mock.results.find(
        (_r, i) => setTimeoutSpy.mock.calls[i]?.[1] === 2500
      );
      expect(capCall, 'no 2500ms cap timer was scheduled').toBeDefined();
      expect(clearTimeoutSpy).toHaveBeenCalledWith(capCall!.value);
    } finally {
      clearTimeoutSpy.mockRestore();
      setTimeoutSpy.mockRestore();
    }
  });

  it('still invalidates the other families, fire-and-forget', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockSetStatus.mockResolvedValue(STATUS_RESULT);

    const { result } = renderHook(() => useMedicationStatus(CIRCLE_ID), { wrapper });
    await result.current.mutateAsync(VARIABLES);

    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvents(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvent(CIRCLE_ID, EVENT_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.medicationTodaySummary(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.activityFeed(CIRCLE_ID))).toBe(true);
  });

  it('surfaces a 403 through the shared event onError (no wait involved)', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockSetStatus.mockRejectedValue(PERMISSION_ENVELOPE);

    const { result } = renderHook(() => useMedicationStatus(CIRCLE_ID), { wrapper });
    result.current.mutate(VARIABLES);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// THE TWO REACHABLE CODES THAT HAD NO BRANCH.
//
// `useEventMutationOnError` mapped 402, 403 and 409 DOSE_ALREADY_LOGGED, and
// sent everything else to "Couldn't save your changes. Please try again." —
// retry copy, on two requests that cannot succeed no matter how many times they
// are retried:
//
//   INVALID_OCCURRENCE_DATE (400, backend/src/routes/calendarEvents.ts:4887)
//     The posted `scheduled_date` is not an occurrence of the series. REACHABLE
//     without anyone doing anything wrong: another member shortens
//     `recurrence_end_date` (or edits the pattern) while this tab holds a
//     60s-stale calendar, and the virtual instance still on screen is now
//     off-pattern. Retrying re-posts the same off-pattern date forever.
//
//   NOT_FOUND (404, same route)
//     The row was deleted by someone else between render and press.
//
// Both are stale-snapshot conditions, so both must ALSO refetch the calendar —
// telling the user why without correcting what they are looking at leaves the
// same dead row on screen for the next press.
// ────────────────────────────────────────────────────────────────────────────
describe('useCompleteEvent — stale-snapshot rejections get their own copy', () => {
  it('INVALID_OCCURRENCE_DATE says the day is no longer part of the series, and refetches', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockComplete.mockRejectedValue({
      success: false,
      error: { code: 'INVALID_OCCURRENCE_DATE', message: 'not an occurrence' },
    });

    const { result } = renderHook(() => useCompleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: 'parent-1', scheduledDate: '2026-08-06' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.invalidOccurrenceDate', 'error');
    expect(showToast).not.toHaveBeenCalledWith('errors.saveFailed', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvents(CIRCLE_ID))).toBe(true);
  });

  it('NOT_FOUND says the event is gone, and refetches', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockComplete.mockRejectedValue({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Event not found' },
    });

    const { result } = renderHook(() => useCompleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: EVENT_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.eventNotFound', 'error');
    expect(showToast).not.toHaveBeenCalledWith('errors.saveFailed', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvents(CIRCLE_ID))).toBe(true);
  });

  it('an unrecognised code still lands on the generic retry copy', async () => {
    // The new branches must be code-specific, not a widened "any 4xx" bucket.
    const { wrapper } = setup();
    mockComplete.mockRejectedValue({ success: false, error: { code: 'SOMETHING_NEW' } });

    const { result } = renderHook(() => useCompleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate({ eventId: EVENT_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.saveFailed', 'error');
  });
});
