import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { assignShift, dropShift, getShifts, takeShift } from '@/api/shifts';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import {
  useAssignShift,
  useDropShift,
  useOpenShiftCount,
  useShiftsPeek,
  useTakeShift,
} from '../useShifts';

vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  getShifts: vi.fn(),
  takeShift: vi.fn(),
  dropShift: vi.fn(),
  assignShift: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => ({
    viewerRole: 'member',
    timezone: 'America/Chicago',
    members: [{ id: 'u-bo', first_name: 'Bo', last_name: 'R', email: 'bo@x.test' }],
  }),
}));
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade: vi.fn() }) }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    shiftTaken: vi.fn(),
    shiftDropped: vi.fn(),
    shiftAssigned: vi.fn(),
    shiftTakeConflict: vi.fn(),
  },
}));

const CIRCLE = 'c';
const KEY = queryKeys.shiftsRange(CIRCLE, { start_date: '2026-10-19', end_date: '2026-10-25' });

function row(id: string, date: string, who: string | null, root = 'root'): CalendarEvent {
  return {
    id: `${id}_${date}`,
    parent_event_id: root,
    circle_id: CIRCLE,
    event_type: 'shift',
    title: 'Night',
    scheduled_date: date,
    scheduled_time: '20:00:00',
    duration_minutes: 720,
    recurrence_rule: 'daily',
    assigned_to: who,
    assigned_to_user: who ? { id: who, first_name: who, last_name: null } : null,
    created_at: '',
    updated_at: '',
  } as CalendarEvent;
}

const ROWS = (): CalendarEvent[] => [
  row('root', '2026-10-19', null),
  row('root', '2026-10-20', null),
  row('root', '2026-10-21', 'u-ana'),
  row('root', '2026-10-22', null),
  row('other', '2026-10-22', null, 'other'),
];

const assignees = (rows: CalendarEvent[] | undefined) => rows?.map((r) => r.assigned_to ?? null);

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(KEY, ROWS());
  useAuthStore.setState({
    user: { id: 'u-me', email: 'me@x.test', first_name: 'Pat', last_name: 'L' },
    isAuthenticated: true,
  } as never);
});

const cached = () => client.getQueryData<CalendarEvent[]>(KEY);

describe('optimistic take / drop / assign only move the rows the server will move', () => {
  it('a FUTURE take patches the tapped row and later OPEN rows; someone else\'s explicit row keeps its person', async () => {
    const d = deferred<never>();
    vi.mocked(takeShift).mockReturnValue(d.promise);
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    act(() => {
      result.current.mutate({ shift: ROWS()[0], scope: 'future' });
    });
    await waitFor(() => expect(assignees(cached())).toEqual(['u-me', 'u-me', 'u-ana', 'u-me', null]));
    expect(cached()?.[0].assigned_to_user).toEqual(expect.objectContaining({ id: 'u-me', first_name: 'Pat' }));
    d.resolve({ event: ROWS()[0], rootId: 'root' } as never);
    await waitFor(() => expect(Analytics.shiftTaken).toHaveBeenCalledWith({ scope: 'future' }));
  });

  it('an OCCURRENCE take patches only that date', async () => {
    const d = deferred<never>();
    vi.mocked(takeShift).mockReturnValue(d.promise);
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    act(() => {
      result.current.mutate({ shift: ROWS()[1], scope: 'occurrence' });
    });
    await waitFor(() => expect(assignees(cached())).toEqual([null, 'u-me', 'u-ana', null, null]));
    d.resolve({} as never);
  });

  it('a FUTURE drop opens only the rows held by the same person as the tapped one', async () => {
    client.setQueryData(KEY, [
      row('root', '2026-10-19', 'u-me'),
      row('root', '2026-10-20', 'u-ana'),
      row('root', '2026-10-21', 'u-me'),
      row('root', '2026-10-22', 'u-me'),
      row('other', '2026-10-22', 'u-me', 'other'),
    ]);
    const d = deferred<never>();
    vi.mocked(dropShift).mockReturnValue(d.promise);
    const { result } = renderHook(() => useDropShift(CIRCLE), { wrapper });
    act(() => {
      result.current.mutate({ shift: cached()![0], scope: 'future' });
    });
    await waitFor(() => expect(assignees(cached())).toEqual([null, 'u-ana', null, null, 'u-me']));
    d.resolve({} as never);
  });

  it('a FUTURE assign moves the tapped row and later rows held by the same person (open here)', async () => {
    const d = deferred<never>();
    vi.mocked(assignShift).mockReturnValue(d.promise);
    const { result } = renderHook(() => useAssignShift(CIRCLE), { wrapper });
    act(() => {
      result.current.mutate({ shift: ROWS()[0], scope: 'future', userId: 'u-bo' });
    });
    await waitFor(() => expect(assignees(cached())).toEqual(['u-bo', 'u-bo', 'u-ana', 'u-bo', null]));
    expect(cached()?.[0].assigned_to_user).toEqual(expect.objectContaining({ id: 'u-bo', first_name: 'Bo' }));
    d.resolve({} as never);
  });

  it('a failed take rolls the cache back, toasts, and invalidates', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const d = deferred<never>();
    vi.mocked(takeShift).mockReturnValue(d.promise);
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    act(() => {
      result.current.mutate({ shift: ROWS()[0], scope: 'future' });
    });
    await waitFor(() => expect(assignees(cached())?.[0]).toBe('u-me'));
    d.reject({ success: false, error: { code: 'SHIFT_ALREADY_TAKEN', message: 'x', takenBy: 'Ana' } });
    await waitFor(() => expect(assignees(cached())).toEqual(assignees(ROWS())));
    expect(Analytics.shiftTakeConflict).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.shifts(CIRCLE) });
    expect(Analytics.shiftTaken).not.toHaveBeenCalled();
  });

  it('a success invalidates every shifts range (a future split re-keys the series)', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(takeShift).mockResolvedValue({ event: ROWS()[0], rootId: 'new-root' } as never);
    const { result } = renderHook(() => useTakeShift(CIRCLE), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ shift: ROWS()[0], scope: 'future' });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.shifts(CIRCLE) });
  });
});

describe('shift_dropped.within_24h is the exact instant', () => {
  async function drop(date: string, time: string) {
    vi.setSystemTime(new Date('2026-10-19T17:00:00Z')); // 12:00 Chicago
    vi.mocked(dropShift).mockResolvedValue({} as never);
    const shift = { ...row('root', date, 'u-me'), scheduled_time: time };
    const { result } = renderHook(() => useDropShift(CIRCLE), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ shift, scope: 'occurrence' });
    });
    return vi.mocked(Analytics.shiftDropped).mock.calls.at(-1)?.[0];
  }
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it('tomorrow 11:00 is inside 24 h; tomorrow 13:00 is not (same calendar day, different answer)', async () => {
    expect(await drop('2026-10-20', '11:00:00')).toEqual(expect.objectContaining({ within24h: true }));
    expect(await drop('2026-10-20', '13:00:00')).toEqual(expect.objectContaining({ within24h: false }));
  });
});

describe('badge window', () => {
  const NOW = new Date('2026-10-19T17:00:00Z'); // 12:00 Chicago
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('asks today .. today+6 in the recipient zone and counts open shifts that have not ended', async () => {
    vi.mocked(getShifts).mockResolvedValue([
      { ...row('a', '2026-10-19', null), scheduled_time: '06:00:00', duration_minutes: 300 }, // ended 11:00
      { ...row('b', '2026-10-19', null), scheduled_time: '10:00:00', duration_minutes: 480 }, // under way
      row('c', '2026-10-20', null),
      row('d', '2026-10-20', 'u-ana'),
    ]);
    const { result } = renderHook(() => useOpenShiftCount(CIRCLE, 'America/Chicago', true), { wrapper });
    await waitFor(() => expect(result.current.count).toBe(2));
    expect(getShifts).toHaveBeenCalledWith(CIRCLE, '2026-10-19', '2026-10-25');
  });

  it('is null (hidden) on error, but reports settled so shifts_view_opened can fire', async () => {
    vi.mocked(getShifts).mockRejectedValue({ success: false, error: { code: 'INTERNAL' } });
    const { result } = renderHook(() => useOpenShiftCount(CIRCLE, 'America/Chicago', true), { wrapper });
    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.count).toBeNull();
  });

  it('the peek shares the same window and returns the raw rows', async () => {
    const rows = [row('c', '2026-10-20', null)];
    vi.mocked(getShifts).mockResolvedValue(rows);
    const { result } = renderHook(() => useShiftsPeek(CIRCLE, 'America/Chicago', true), { wrapper });
    await waitFor(() => expect(result.current).toEqual(rows));
  });
});
