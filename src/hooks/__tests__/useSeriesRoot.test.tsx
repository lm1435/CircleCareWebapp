import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CalendarEvent } from '@/api/calendarEvents';

vi.mock('@/api/calendarEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/calendarEvents')>();
  return { ...actual, getSeriesRoot: vi.fn() };
});

import { getSeriesRoot } from '@/api/calendarEvents';
import { useSeriesRoot } from '../useSeriesRoot';

const mockGetSeriesRoot = vi.mocked(getSeriesRoot);
const CIRCLE_ID = 'circle-1';

function event(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'ev-1',
    circle_id: CIRCLE_ID,
    event_type: 'medication',
    title: 'Metformin',
    scheduled_date: '2026-06-17',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const OCCURRENCE = event({
  id: 'root-1_2026-06-17',
  parent_event_id: 'root-1',
  is_virtual: true,
  recurrence_rule: 'weekly',
});

beforeEach(() => {
  mockGetSeriesRoot.mockReset();
});

describe('useSeriesRoot', () => {
  it('is null while creating and never fetches', () => {
    const { result } = renderHook(() => useSeriesRoot(CIRCLE_ID, null, []), { wrapper });
    expect(result.current.root).toBeNull();
    expect(mockGetSeriesRoot).not.toHaveBeenCalled();
  });

  it('an event with no parent IS the root', () => {
    const root = event({ id: 'root-1', recurrence_rule: 'weekly', recurrence_days: [1, 3] });
    const { result } = renderHook(() => useSeriesRoot(CIRCLE_ID, root, []), { wrapper });
    expect(result.current.root).toBe(root);
    expect(mockGetSeriesRoot).not.toHaveBeenCalled();
  });

  it('an occurrence resolves to the root already in the calendar cache, with no request', () => {
    const cachedRoot = event({ id: 'root-1', scheduled_date: '2026-06-01', recurrence_days: [1, 3] });
    const { result } = renderHook(
      () => useSeriesRoot(CIRCLE_ID, OCCURRENCE, [OCCURRENCE, cachedRoot]),
      { wrapper }
    );
    expect(result.current.root).toBe(cachedRoot);
    expect(mockGetSeriesRoot).not.toHaveBeenCalled();
  });

  it('never mistakes a virtual row for the root', async () => {
    // A virtual instance's composite id cannot equal the parent id, but a
    // cached child could never be the root either — only a parentless row.
    const child = event({ id: 'root-1', parent_event_id: 'other' });
    mockGetSeriesRoot.mockResolvedValue({
      id: 'root-1',
      scheduled_date: '2026-06-01',
      scheduled_time: '08:00:00',
      duration_minutes: null,
      recurrence_rule: 'weekly',
      recurrence_days: [1, 3],
      recurrence_end_date: null,
    });
    const { result } = renderHook(() => useSeriesRoot(CIRCLE_ID, OCCURRENCE, [child]), {
      wrapper,
    });
    await waitFor(() => expect(result.current.root).toBeTruthy());
    expect(result.current.root?.scheduled_date).toBe('2026-06-01');
  });

  it('fetches the root when it is not cached — undefined until it lands', async () => {
    mockGetSeriesRoot.mockResolvedValue({
      id: 'root-1',
      scheduled_date: '2026-06-01',
      scheduled_time: '08:00:00',
      duration_minutes: null,
      recurrence_rule: 'weekly',
      recurrence_days: [1, 3],
      recurrence_end_date: null,
    });
    const { result } = renderHook(() => useSeriesRoot(CIRCLE_ID, OCCURRENCE, []), { wrapper });

    expect(result.current.root).toBeUndefined();
    await waitFor(() => expect(result.current.root).toBeTruthy());
    expect(mockGetSeriesRoot).toHaveBeenCalledWith(CIRCLE_ID, 'root-1');
    expect(result.current.root?.recurrence_days).toEqual([1, 3]);
  });

  it('falls back to the occurrence itself when the fetch fails, rather than locking the form', async () => {
    mockGetSeriesRoot.mockRejectedValue({ success: false, error: { code: 'SERVER_ERROR' } });
    const { result } = renderHook(() => useSeriesRoot(CIRCLE_ID, OCCURRENCE, []), { wrapper });
    // The hook retries once (~1s back-off) before giving up.
    await waitFor(() => expect(result.current.root).toBe(OCCURRENCE), { timeout: 4000 });
    expect(mockGetSeriesRoot).toHaveBeenCalledTimes(2);
  });
});
