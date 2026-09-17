import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { useCalendarEvents, useEventsPresence } from '@/hooks/useCalendarEvents';

// HOME OVER-FETCH. One cold Home load used to send 8 GET /events requests
// spanning 680 days (~3.2 MB): `useCalendarEvents` prefetched the previous and
// next same-size windows after EVERY success, so the checklist/TodaysMeds
// 211-day presence window dragged in two more 211-day windows, and the 15-day
// UpcomingAppointments window two 15-day ones. Only the Calendar page navigates
// week/month to week/month, so prefetch is now OPT-IN there, and "does this
// circle have a medication?" is a boolean endpoint instead of a 211-day list.
//
// Real QueryClient, `apiClient.get` routed by URL (globally mocked in
// src/test/setup.ts), requests counted per range.

const get = apiClient.get as unknown as Mock;

const CIRCLE = 'circle-1';
const EVENTS_URL = `/circles/${CIRCLE}/events`;
const PRESENCE_URL = `/circles/${CIRCLE}/events/presence`;
const WEEK = { start_date: '2026-06-07', end_date: '2026-06-13' };
const PRESENCE_WINDOW = { start_date: '2026-05-13', end_date: '2026-12-09' };

const MED = { id: 'm1', event_type: 'medication', scheduled_date: '2026-06-15' };
const APPT = { id: 'a1', event_type: 'appointment', scheduled_date: '2026-06-16' };

/** The envelope the apiClient interceptor rejects with for an OLDER backend's 404. */
const OLD_BACKEND_404 = { success: false, error: { code: 'NOT_FOUND', message: 'Event not found' } };
const SERVER_ERROR = { success: false, error: { code: 'SERVER_ERROR', message: 'Internal server error' } };

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

/** Every `/events` (list) request, as "start..end". */
const eventRanges = (): string[] =>
  get.mock.calls
    .filter(([url]) => url === EVENTS_URL)
    .map(([, config]) => `${config?.params?.start_date}..${config?.params?.end_date}`);

const presenceCalls = () => get.mock.calls.filter(([url]) => url === PRESENCE_URL);

/** Long enough for an on-success prefetch effect to have fired its requests. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

const eventsOk = (events: unknown[]) => Promise.resolve({ success: true, data: { events } });
const presenceOk = (data: { medication: boolean; appointment: boolean; task: boolean }) =>
  Promise.resolve({ success: true, data });

beforeEach(() => {
  get.mockReset();
});

describe('useCalendarEvents prefetch', () => {
  beforeEach(() => {
    get.mockImplementation((url: string) =>
      url === EVENTS_URL ? eventsOk([]) : Promise.reject(new Error(`unexpected GET ${url}`))
    );
  });

  it('does NOT prefetch adjacent windows by default', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useCalendarEvents(CIRCLE, WEEK.start_date, WEEK.end_date), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await settle();

    expect(eventRanges()).toEqual(['2026-06-07..2026-06-13']);
  });

  it('does NOT prefetch with prefetchAdjacent: false', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useCalendarEvents(CIRCLE, WEEK.start_date, WEEK.end_date, { prefetchAdjacent: false }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await settle();

    expect(eventRanges()).toEqual(['2026-06-07..2026-06-13']);
  });

  it('DOES prefetch the previous and next same-span windows with prefetchAdjacent: true', async () => {
    const { wrapper, queryClient } = setup();
    const { result } = renderHook(
      () => useCalendarEvents(CIRCLE, WEEK.start_date, WEEK.end_date, { prefetchAdjacent: true }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(eventRanges()).toHaveLength(3));
    await settle();

    expect([...eventRanges()].sort()).toEqual([
      '2026-05-31..2026-06-06',
      '2026-06-07..2026-06-13',
      '2026-06-14..2026-06-20',
    ]);
    // Prefetched into the same range keys the Calendar reads on navigation.
    await waitFor(() =>
      expect(
        queryClient.getQueryData(
          queryKeys.calendarEventsRange(CIRCLE, { start_date: '2026-06-14', end_date: '2026-06-20' })
        )
      ).toEqual([])
    );
  });

  it('keeps the query key and data shape unchanged', async () => {
    get.mockImplementation((url: string) => (url === EVENTS_URL ? eventsOk([MED]) : eventsOk([])));
    const { wrapper, queryClient } = setup();
    const { result } = renderHook(() => useCalendarEvents(CIRCLE, WEEK.start_date, WEEK.end_date), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.events).toEqual([MED]);
    expect(queryClient.getQueryData(queryKeys.calendarEventsRange(CIRCLE, WEEK))).toEqual([MED]);
  });
});

describe('useEventsPresence', () => {
  const render = () => {
    const ctx = setup();
    const hook = renderHook(
      () => useEventsPresence(CIRCLE, PRESENCE_WINDOW.start_date, PRESENCE_WINDOW.end_date),
      { wrapper: ctx.wrapper }
    );
    return { ...ctx, ...hook };
  };

  it('success: asks the presence endpoint once with the window, never the events list', async () => {
    get.mockImplementation((url: string) =>
      url === PRESENCE_URL
        ? presenceOk({ medication: true, appointment: false, task: true })
        : Promise.reject(new Error(`unexpected GET ${url}`))
    );
    const { result } = render();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await settle();

    expect(result.current.data).toEqual({ medication: true, appointment: false, task: true });
    expect(result.current.isError).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(get).toHaveBeenCalledWith(PRESENCE_URL, { params: PRESENCE_WINDOW });
    expect(presenceCalls()).toHaveLength(1);
    expect(eventRanges()).toEqual([]);
  });

  it('pending: no data, not success, not error', async () => {
    get.mockImplementation(() => new Promise(() => {}));
    const { result } = render();
    await settle();

    expect(result.current.isPending).toBe(true);
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it('disabled until the window is known: no request at all', async () => {
    const ctx = setup();
    const { result } = renderHook(() => useEventsPresence(CIRCLE, '', ''), { wrapper: ctx.wrapper });
    await settle();
    expect(get).not.toHaveBeenCalled();
    expect(result.current.isSuccess).toBe(false);
  });

  it('error (500): isError with no data, NO fallback list; refetch re-asks presence', async () => {
    const state = { failing: true };
    get.mockImplementation((url: string) => {
      if (url === PRESENCE_URL) {
        return state.failing
          ? Promise.reject(SERVER_ERROR)
          : presenceOk({ medication: true, appointment: false, task: false });
      }
      return eventsOk([MED]);
    });
    const { result } = render();

    await waitFor(() => expect(result.current.isError).toBe(true));
    await settle();
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(eventRanges()).toEqual([]);

    state.failing = false;
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.medication).toBe(true);
    expect(presenceCalls()).toHaveLength(2);
    expect(eventRanges()).toEqual([]);
  });

  describe('404 from an older backend: falls back to the full-range list, no prefetch', () => {
    it.each([
      ['the backend NOT_FOUND envelope', OLD_BACKEND_404],
      ['a bare HTTP 404 (no body)', { response: { status: 404 } }],
    ])('%s → derives presence from ONE full-range events read', async (_label, rejection) => {
      get.mockImplementation((url: string) =>
        url === PRESENCE_URL ? Promise.reject(rejection) : eventsOk([MED, APPT])
      );
      const { result } = render();

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      await settle();

      expect(result.current.isError).toBe(false);
      expect(result.current.data).toEqual({ medication: true, appointment: true, task: false });
      expect(eventRanges()).toEqual(['2026-05-13..2026-12-09']);
    });

    it('an empty circle reads as all-false success (the first-run door still opens)', async () => {
      get.mockImplementation((url: string) =>
        url === PRESENCE_URL ? Promise.reject(OLD_BACKEND_404) : eventsOk([])
      );
      const { result } = render();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual({ medication: false, appointment: false, task: false });
    });

    it('the fallback list read failing is an error, not an empty success; refetch retries it', async () => {
      const state = { failing: true };
      get.mockImplementation((url: string) => {
        if (url === PRESENCE_URL) return Promise.reject(OLD_BACKEND_404);
        return state.failing ? Promise.reject(SERVER_ERROR) : eventsOk([MED]);
      });
      const { result } = render();

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.data).toBeUndefined();

      state.failing = false;
      await act(async () => {
        await result.current.refetch();
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.medication).toBe(true);
    });

    it('while the fallback list is still loading: pending, not success', async () => {
      get.mockImplementation((url: string) =>
        url === PRESENCE_URL ? Promise.reject(OLD_BACKEND_404) : new Promise(() => {})
      );
      const { result } = render();
      await waitFor(() => expect(eventRanges()).toHaveLength(1));
      expect(result.current.isPending).toBe(true);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
    });
  });

  it('is refreshed by the calendar-events invalidation every event write already performs', async () => {
    let hasMed = false;
    get.mockImplementation((url: string) =>
      url === PRESENCE_URL
        ? presenceOk({ medication: hasMed, appointment: false, task: false })
        : Promise.reject(new Error(`unexpected GET ${url}`))
    );
    const { result, queryClient } = render();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.medication).toBe(false);

    hasMed = true;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(CIRCLE) });
    });
    await waitFor(() => expect(result.current.data?.medication).toBe(true));
  });
});
