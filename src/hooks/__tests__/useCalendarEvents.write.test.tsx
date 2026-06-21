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
  };
});

// Deterministic translations so error toasts assert on a stable key string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

import {
  createEvent,
  updateEvent,
  deleteEvent,
  completeEvent,
  type CalendarEvent,
} from '@/api/calendarEvents';
import { queryKeys } from '@/lib/queryKeys';
import {
  useCreateEvent,
  useUpdateEvent,
  useDeleteEvent,
  useCompleteEvent,
} from '@/hooks/useCalendarEvents';

const CIRCLE_ID = 'circle-1';
const EVENT_ID = 'event-1';

const mockCreate = vi.mocked(createEvent);
const mockUpdate = vi.mocked(updateEvent);
const mockDelete = vi.mocked(deleteEvent);
const mockComplete = vi.mocked(completeEvent);

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
    expect(showToast).toHaveBeenCalledWith('errors.subscriptionRequired', 'error');
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
    result.current.mutate(EVENT_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockComplete).toHaveBeenCalledWith(CIRCLE_ID, EVENT_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.tasks(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvent(CIRCLE_ID, EVENT_ID))).toBe(true);
  });

  it('surfaces a non-permission error with the saveFailed toast', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockComplete.mockRejectedValue({ success: false, error: { code: 'CONFLICT' } });

    const { result } = renderHook(() => useCompleteEvent(CIRCLE_ID), { wrapper });
    result.current.mutate(EVENT_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.saveFailed', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.calendarEvents(CIRCLE_ID))).toBe(true);
  });
});
