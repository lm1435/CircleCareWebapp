import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import '@/i18n';

vi.mock('@/api/medicationConfirmations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/medicationConfirmations')>();
  return { ...actual, confirmMedication: vi.fn(), getTodaysMedications: vi.fn() };
});

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

const analytics = vi.hoisted(() => ({
  medicationConfirmed: vi.fn(),
  medicationConfirmRecovered: vi.fn(),
  errorOccurred: vi.fn(),
  markItTapped: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ Analytics: analytics, default: analytics }));

import { confirmMedication, getTodaysMedications } from '@/api/medicationConfirmations';
import { useMarkFirstDose } from '@/hooks/useMarkFirstDose';
import { __resetOfflineWriteForTests, setOfflineWriteExplainer } from '@/lib/offlineWrite';

const mockConfirm = vi.mocked(confirmMedication);
const mockToday = vi.mocked(getTodaysMedications);
const NETWORK = { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' };
const CIRCLE_ID = 'circle-1';

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetOfflineWriteForTests();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  setOfflineWriteExplainer(null);
  act(() => onlineManager.setOnline(true));
});

describe('useMarkFirstDose: verify before alert (1.4.3 audit item 7)', () => {
  const taken = { id: 'ev-1', scheduled_date: '2026-11-19', scheduled_time: '08:00:00', confirmation: { status: 'taken', confirmed_at: 'x', confirmed_by: 'u' } };

  it('a lost response whose write DID land is a success: re-read says recorded, no error toast', async () => {
    mockConfirm.mockRejectedValueOnce(NETWORK);
    mockToday.mockResolvedValueOnce([taken] as never);
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'today'), { wrapper });
    let ok = false;
    await act(async () => {
      ok = await result.current.mark({ eventId: 'ev-1', time: '08:00:00', today: '2026-11-19' });
    });
    expect(ok).toBe(true);
    expect(mockToday).toHaveBeenCalledWith(CIRCLE_ID, '2026-11-19');
    expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
    expect(result.current.done).toBe(true);
  });

  it('NEGATIVE: the re-read says NOT recorded: the generic error shows and the line stays', async () => {
    mockConfirm.mockRejectedValueOnce(NETWORK);
    mockToday.mockResolvedValueOnce([{ ...taken, confirmation: null }] as never);
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'today'), { wrapper });
    let ok = true;
    await act(async () => {
      ok = await result.current.mark({ eventId: 'ev-1', time: '08:00:00', today: '2026-11-19' });
    });
    expect(ok).toBe(false);
    expect(showToast).toHaveBeenCalledWith("Couldn't save. Please try again.", 'error');
    expect(result.current.done).toBe(false);
  });

  it('NEGATIVE: a definitive refusal is never re-read (NOT_FIRST_DAY)', async () => {
    mockConfirm.mockRejectedValueOnce({ success: false, error: { code: 'NOT_FIRST_DAY' } });
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'today'), { wrapper });
    await act(async () => {
      await result.current.mark({ eventId: 'ev-1', time: '08:00:00', today: '2026-11-19' });
    });
    expect(mockToday).not.toHaveBeenCalled();
    expect(result.current.refused).toBe(true);
  });
});

describe('useMarkFirstDose', () => {
  it('posts ONE taken with the opt-in flag, then reports success on the surface', async () => {
    mockConfirm.mockResolvedValue({} as never);
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'payoff'), { wrapper });

    let ok = false;
    await act(async () => {
      ok = await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });

    expect(ok).toBe(true);
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith(CIRCLE_ID, {
      event_id: 'ev-1',
      status: 'taken',
      scheduled_time: '08:00:00',
      mark_first_day: true,
    });
    expect(analytics.markItTapped).toHaveBeenCalledWith('payoff', true);
    expect(result.current.done).toBe(true);
    expect(showToast).toHaveBeenCalledWith('Marked as taken', 'success');
  });

  it('pads an HH:MM time to the HH:MM:SS the endpoint takes', async () => {
    mockConfirm.mockResolvedValue({} as never);
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'today'), { wrapper });
    await act(async () => {
      await result.current.mark({ eventId: 'ev-1', time: '08:00' });
    });
    expect(mockConfirm.mock.calls[0][1].scheduled_time).toBe('08:00:00');
    expect(analytics.markItTapped).toHaveBeenCalledWith('today', true);
  });

  it('invalidates what a normal Taken invalidates (today meds, calendar, activity...)', async () => {
    mockConfirm.mockResolvedValue({} as never);
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'today'), { wrapper });
    await act(async () => {
      await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    const keys = spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(['todaysMeds', CIRCLE_ID]),
        expect.stringContaining('calendar'),
        expect.stringContaining('activity'),
      ])
    );
    // It rides the normal confirm hook, so the normal event fires too.
    expect(analytics.medicationConfirmed).toHaveBeenCalledWith(CIRCLE_ID, 'taken', 'care_profile');
  });

  it('a refusal (409 NOT_FIRST_DAY) is the generic error, reports success false, and the line stays retryable', async () => {
    mockConfirm.mockRejectedValueOnce({ success: false, error: { code: 'NOT_FIRST_DAY' } });
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'payoff'), { wrapper });

    let ok = true;
    await act(async () => {
      ok = await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    expect(ok).toBe(false);
    expect(result.current.done).toBe(false);
    // NOT_FIRST_DAY can never succeed on retry: the caller hides the line.
    expect(result.current.refused).toBe(true);
    expect(analytics.markItTapped).toHaveBeenCalledWith('payoff', false);
    expect(showToast).toHaveBeenCalledWith("Couldn't save. Please try again.", 'error');

    // Never partial UI: a retry is allowed and can succeed.
    mockConfirm.mockResolvedValueOnce({} as never);
    await act(async () => {
      ok = await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    expect(ok).toBe(true);
    expect(result.current.done).toBe(true);
  });

  it('N: any other failure (a 400 / 500) does NOT mark the line refused', async () => {
    mockConfirm.mockRejectedValueOnce({ success: false, error: { code: 'INTERNAL_ERROR' } });
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'today'), { wrapper });
    await act(async () => {
      await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    expect(result.current.refused).toBe(false);
  });

  it('an old backend rejecting the unknown key (400) reads as the same generic error', async () => {
    mockConfirm.mockRejectedValueOnce({ success: false, error: { code: 'VALIDATION_ERROR' } });
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'payoff'), { wrapper });
    await act(async () => {
      await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    expect(showToast).toHaveBeenCalledWith("Couldn't save. Please try again.", 'error');
    expect(result.current.done).toBe(false);
  });

  it('a permission refusal keeps its own toast and adds no second generic one', async () => {
    mockConfirm.mockRejectedValueOnce({ success: false, error: { code: 'VIEW_ONLY' } });
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'today'), { wrapper });
    await act(async () => {
      await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalledWith("Couldn't save. Please try again.", 'error');
    expect(analytics.markItTapped).toHaveBeenCalledWith('today', false);
  });

  it('a same-tick double tap sends ONE request', async () => {
    let resolve!: () => void;
    mockConfirm.mockReturnValue(new Promise((r) => (resolve = () => r({} as never))) as never);
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'payoff'), { wrapper });

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
      second = result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    await act(async () => {
      resolve();
      await Promise.all([first, second]);
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBe(false);
  });

  it('once marked, a further tap is inert', async () => {
    mockConfirm.mockResolvedValue({} as never);
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'payoff'), { wrapper });
    await act(async () => {
      await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    await act(async () => {
      await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
  });

  it('offline: explains, sends nothing, reports nothing', async () => {
    const explained = vi.fn();
    setOfflineWriteExplainer(explained);
    act(() => onlineManager.setOnline(false));
    const { result } = renderHook(() => useMarkFirstDose(CIRCLE_ID, 'payoff'), { wrapper });
    await act(async () => {
      await result.current.mark({ eventId: 'ev-1', time: '08:00:00' });
    });
    await waitFor(() => expect(explained).toHaveBeenCalled());
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(analytics.markItTapped).not.toHaveBeenCalled();
  });
});
