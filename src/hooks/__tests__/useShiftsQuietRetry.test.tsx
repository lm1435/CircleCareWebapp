import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { dropShift, getShifts, takeShift } from '@/api/shifts';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { useDropShift, useTakeShift } from '../useShifts';

vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  getShifts: vi.fn(),
  takeShift: vi.fn(),
  dropShift: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    viewerRole: 'member',
    timezone: 'America/Chicago',
    members: [{ id: 'u-bo', first_name: 'Bo', last_name: 'R', email: 'bo@x.test' }],
  }),
}));
const mockRaiseReviewMoment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/reviewMoments', () => ({ raiseReviewMoment: mockRaiseReviewMoment }));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    shiftTaken: vi.fn(),
    shiftDropped: vi.fn(),
    shiftAssigned: vi.fn(),
    shiftTakeConflict: vi.fn(),
    errorOccurred: vi.fn(),
  },
}));

const CIRCLE = 'c';
const KEY = queryKeys.shiftsRange(CIRCLE, { start_date: '2026-10-19', end_date: '2026-10-25' });
const network = { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' };
const taken = { success: false, error: { code: 'SHIFT_ALREADY_TAKEN', message: 'x' } };

function row(date: string, who: string | null): CalendarEvent {
  return {
    id: `root_${date}`,
    parent_event_id: 'root',
    circle_id: CIRCLE,
    event_type: 'shift',
    title: 'Night',
    scheduled_date: date,
    scheduled_time: '20:00:00',
    assigned_to: who,
    assigned_to_user: who ? { id: who, first_name: who, last_name: null } : null,
    created_at: '',
    updated_at: '',
  } as CalendarEvent;
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(KEY, [row('2026-10-20', null)]);
  useAuthStore.setState({
    user: { id: 'u-me', email: 'me@x.test', first_name: 'Pat', last_name: 'L' },
    isAuthenticated: true,
  } as never);
});
afterEach(() => vi.useRealTimers());

const cached = () => client.getQueryData<CalendarEvent[]>(KEY);
const run = async (fn: () => void, ms: number) => {
  act(fn);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe('item 9: take / drop quiet in-call retry', () => {
  it('take: a blip, then the resend lands: one success, optimistic row kept meanwhile, no error', async () => {
    vi.mocked(takeShift).mockRejectedValueOnce(network).mockResolvedValue({ event: row('2026-10-20', 'u-me'), rootId: 'root' });
    vi.mocked(getShifts).mockResolvedValue([row('2026-10-20', null)]);
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    await run(() => result.current.mutate({ shift: row('2026-10-20', null), scope: 'occurrence' }), 100);
    expect(cached()?.[0].assigned_to).toBe('u-me');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(takeShift).toHaveBeenCalledTimes(2);
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
    expect(Analytics.shiftTaken).toHaveBeenCalledTimes(1);
  });

  it('take: first POST landed (lost response): the re-read shows me, NOTHING is resent', async () => {
    vi.mocked(takeShift).mockRejectedValue(network);
    vi.mocked(getShifts).mockResolvedValue([row('2026-10-20', 'u-me')]);
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    await run(() => result.current.mutate({ shift: row('2026-10-20', null), scope: 'occurrence' }), 2_500);
    expect(takeShift).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftTaken).toHaveBeenCalledTimes(1);
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
  });

  it('take: resend answers SHIFT_ALREADY_TAKEN and the holder is ME: success', async () => {
    vi.mocked(takeShift).mockRejectedValueOnce(network).mockRejectedValue(taken);
    vi.mocked(getShifts).mockResolvedValueOnce([row('2026-10-20', null)]).mockResolvedValue([row('2026-10-20', 'u-me')]);
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    await run(() => result.current.mutate({ shift: row('2026-10-20', null), scope: 'occurrence' }), 2_500);
    expect(Analytics.shiftTaken).toHaveBeenCalledTimes(1);
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
  });

  it('NEGATIVE take: SHIFT_ALREADY_TAKEN and the holder is SOMEONE ELSE: a failure, rolled back, reported once', async () => {
    vi.mocked(takeShift).mockRejectedValueOnce(network).mockRejectedValue(taken);
    vi.mocked(getShifts).mockResolvedValueOnce([row('2026-10-20', null)]).mockResolvedValue([row('2026-10-20', 'u-ana')]);
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    await run(() => result.current.mutate({ shift: row('2026-10-20', null), scope: 'occurrence' }), 2_500);
    expect(Analytics.shiftTaken).not.toHaveBeenCalled();
    expect(Analytics.errorOccurred).toHaveBeenCalledTimes(1);
    expect(cached()?.[0].assigned_to).toBeNull();
  });

  it('NEGATIVE take: a 4xx refusal is not retried', async () => {
    vi.mocked(takeShift).mockRejectedValue({ success: false, error: { code: 'VIEW_ONLY', message: 'x' } });
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    await run(() => result.current.mutate({ shift: row('2026-10-20', null), scope: 'occurrence' }), 30_000);
    expect(takeShift).toHaveBeenCalledTimes(1);
    expect(getShifts).not.toHaveBeenCalled();
  });

  it('NEGATIVE take: every attempt fails: rollback only after the last (4 sends), one error_occurred', async () => {
    vi.mocked(takeShift).mockRejectedValue(network);
    vi.mocked(getShifts).mockResolvedValue([row('2026-10-20', null)]);
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    await run(() => result.current.mutate({ shift: row('2026-10-20', null), scope: 'occurrence' }), 8_000);
    expect(cached()?.[0].assigned_to).toBe('u-me');
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(takeShift).toHaveBeenCalledTimes(4);
    expect(Analytics.errorOccurred).toHaveBeenCalledTimes(1);
    expect(cached()?.[0].assigned_to).toBeNull();
  });

  it('drop: first POST landed (re-read shows it open): nothing resent, success', async () => {
    client.setQueryData(KEY, [row('2026-10-20', 'u-me')]);
    vi.mocked(dropShift).mockRejectedValue(network);
    vi.mocked(getShifts).mockResolvedValue([row('2026-10-20', null)]);
    const { result } = renderHook(() => useDropShift(CIRCLE), { wrapper });
    await run(() => result.current.mutate({ shift: row('2026-10-20', 'u-me'), scope: 'occurrence' }), 2_500);
    expect(dropShift).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftDropped).toHaveBeenCalledTimes(1);
    expect(Analytics.errorOccurred).not.toHaveBeenCalled();
  });

  it('NEGATIVE drop: still mine on the re-read: resent; all fail: rollback + one error_occurred', async () => {
    client.setQueryData(KEY, [row('2026-10-20', 'u-me')]);
    vi.mocked(dropShift).mockRejectedValue(network);
    vi.mocked(getShifts).mockResolvedValue([row('2026-10-20', 'u-me')]);
    const { result } = renderHook(() => useDropShift(CIRCLE), { wrapper });
    await run(() => result.current.mutate({ shift: row('2026-10-20', 'u-me'), scope: 'occurrence' }), 18_000);
    expect(dropShift).toHaveBeenCalledTimes(4);
    expect(Analytics.errorOccurred).toHaveBeenCalledTimes(1);
    expect(cached()?.[0].assigned_to).toBe('u-me');
  });
});
