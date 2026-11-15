import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAnswerDoseAlerts, useDoseAlerts } from '@/hooks/useDoseAlerts';
import { answerDoseAlerts, getDoseAlerts, normalizeDoseAlerts } from '@/api/doseAlerts';
import { useDoseAlertsResumedStore } from '@/store/doseAlertsResumedStore';

vi.mock('@/api/doseAlerts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/doseAlerts')>();
  return { ...actual, getDoseAlerts: vi.fn(), answerDoseAlerts: vi.fn() };
});

const CIRCLE = 'c1';
function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { Wrapper, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  useDoseAlertsResumedStore.setState({ resumed: {} });
});

describe('useDoseAlerts', () => {
  it('reads the state under ["doseAlerts", circleId]', async () => {
    vi.mocked(getDoseAlerts).mockResolvedValue({
      paused: true,
      paused_since: '2026-12-01T17:00:00.000Z',
      answer: null,
      can_answer: true,
    });
    const { Wrapper, queryClient } = wrapper();
    const { result } = renderHook(() => useDoseAlerts(CIRCLE), { wrapper: Wrapper });
    expect(result.current.settled).toBe(false);
    expect(result.current.state).toBeNull();
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.state?.paused).toBe(true);
    expect(queryClient.getQueryData(['doseAlerts', CIRCLE])).toMatchObject({ paused: true });
  });

  it('N a failed read is NOT paused (fail quiet) and still settles', async () => {
    vi.mocked(getDoseAlerts).mockRejectedValue({ error: { code: 'FORBIDDEN' } });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useDoseAlerts(CIRCLE), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.state?.paused).toBe(false);
    expect(result.current.isError).toBe(true);
  });

  it('P a failed REFETCH keeps the cached pause (a real pause must not vanish)', async () => {
    const paused = {
      paused: true,
      paused_since: '2026-12-01T17:00:00.000Z',
      answer: null,
      can_answer: true,
    };
    vi.mocked(getDoseAlerts).mockResolvedValueOnce(paused);
    const { Wrapper, queryClient } = wrapper();
    const { result } = renderHook(() => useDoseAlerts(CIRCLE), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.state?.paused).toBe(true));
    vi.mocked(getDoseAlerts).mockRejectedValue({ error: { code: 'INTERNAL_ERROR' } });
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['doseAlerts', CIRCLE] });
    });
    await waitFor(() => expect(queryClient.getQueryState(['doseAlerts', CIRCLE])?.status).toBe('error'));
    expect(result.current.state?.paused).toBe(true);
    // Not a "could not load" page state either: there is data to show.
    expect(result.current.isError).toBe(false);
  });

  it('N an offline first read (paused fetch, no data) settles as not paused instead of waiting forever', async () => {
    vi.mocked(getDoseAlerts).mockResolvedValue({
      paused: true,
      paused_since: null,
      answer: null,
      can_answer: true,
    });
    const { Wrapper } = wrapper();
    act(() => onlineManager.setOnline(false));
    try {
      const { result } = renderHook(() => useDoseAlerts(CIRCLE), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.settled).toBe(true));
      expect(result.current.state).toBeNull();
      expect(getDoseAlerts).not.toHaveBeenCalled();
    } finally {
      act(() => onlineManager.setOnline(true));
    }
  });

  it('normalizeDoseAlerts: anything unexpected reads as not paused', () => {
    expect(normalizeDoseAlerts(undefined)).toEqual({
      paused: false,
      paused_since: null,
      answer: null,
      can_answer: false,
    });
    expect(normalizeDoseAlerts({ paused: 'yes', answer: 'still_giving', can_answer: 1 })).toEqual({
      paused: false,
      paused_since: null,
      answer: null,
      can_answer: false,
    });
  });
});

describe('useAnswerDoseAlerts', () => {
  it('P still_giving writes the answer state into the cache and marks the circle resumed', async () => {
    vi.mocked(answerDoseAlerts).mockResolvedValue({
      paused: false,
      paused_since: null,
      answer: null,
      can_answer: true,
      resumed: true,
    });
    const { Wrapper, queryClient } = wrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAnswerDoseAlerts(CIRCLE), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ answer: 'still_giving', source: 'notice' });
    });
    expect(answerDoseAlerts).toHaveBeenCalledWith(CIRCLE, 'still_giving', 'notice');
    expect(queryClient.getQueryData(['doseAlerts', CIRCLE])).toEqual({
      paused: false,
      paused_since: null,
      answer: null,
      can_answer: true,
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['doseAlerts', CIRCLE] });
    expect(useDoseAlertsResumedStore.getState().resumed[CIRCLE]).toBe(true);
  });

  it('keep_paused does not claim a resume', async () => {
    vi.mocked(answerDoseAlerts).mockResolvedValue({
      paused: true,
      paused_since: '2026-12-01T17:00:00.000Z',
      answer: 'keep_paused',
      can_answer: true,
      resumed: false,
    });
    const { Wrapper } = wrapper();
    const { result } = renderHook(() => useAnswerDoseAlerts(CIRCLE), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync({ answer: 'keep_paused', source: 'push' });
    });
    expect(useDoseAlertsResumedStore.getState().resumed[CIRCLE]).toBeUndefined();
  });
});
