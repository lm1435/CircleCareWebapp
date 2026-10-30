import { renderHook } from '@testing-library/react';
import { useNextUp } from '../useNextUp';
import { useMedsForDate, useTodaysMeds } from '../useMedConfirmation';
import { useCalendarEvents } from '../useCalendarEvents';
import { useTasks } from '../useTasks';
import { getDateInTimezone } from '@/utils/timezone';
import { addDays } from '@/components/calendar/dateMath';

vi.mock('../useMedConfirmation', () => ({ useTodaysMeds: vi.fn(), useMedsForDate: vi.fn() }));
vi.mock('../useCalendarEvents', () => ({ useCalendarEvents: vi.fn() }));
vi.mock('../useTasks', () => ({ useTasks: vi.fn() }));

const TZ = 'America/Denver';
const TODAY = getDateInTimezone(TZ);
const ok = (data: unknown) => ({ data, isSuccess: true, isError: false, refetch: vi.fn() });
const pending = () => ({ data: undefined, isSuccess: false, isError: false, refetch: vi.fn() });
const failed = () => ({ data: undefined, isSuccess: false, isError: true, refetch: vi.fn() });

const dose = (id: string, date: string) => ({
  id,
  event_type: 'medication',
  title: id,
  scheduled_date: date,
  scheduled_time: '00:00:00',
});

function setup(o: { meds?: unknown; yesterday?: unknown; events?: unknown; tasks?: unknown }) {
  vi.mocked(useTodaysMeds).mockReturnValue((o.meds ?? ok([])) as never);
  vi.mocked(useMedsForDate).mockReturnValue((o.yesterday ?? ok([])) as never);
  vi.mocked(useCalendarEvents).mockReturnValue((o.events ?? ok([])) as never);
  vi.mocked(useTasks).mockReturnValue((o.tasks ?? ok({ tasks: [], total: 0 })) as never);
}

describe('useNextUp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges today and yesterday doses with appointments and tasks', () => {
    setup({
      meds: ok([dose('today-dose', TODAY)]),
      yesterday: ok([dose('old-dose', addDays(TODAY, -1))]),
      events: ok([
        { id: 'a', event_type: 'appointment', title: 'Dr', scheduled_date: TODAY, scheduled_time: '23:59:00' },
      ]),
      tasks: ok({ tasks: [{ id: 't', event_type: 'task', title: 'Task', scheduled_date: TODAY, scheduled_time: null }], total: 1 }),
    });
    const { result } = renderHook(() => useNextUp('c1', TZ));
    expect(result.current.items.map((i) => i.id)).toEqual(['old-dose', 'today-dose', 'a', 't']);
    expect(result.current.settled).toBe(true);
    expect(result.current.isError).toBe(false);
  });

  it('asks yesterday\'s doses for the day BEFORE the recipient\'s today', () => {
    setup({});
    renderHook(() => useNextUp('c1', TZ));
    expect(vi.mocked(useMedsForDate)).toHaveBeenCalledWith('c1', addDays(TODAY, -1));
  });

  it('uses the shared 14-day calendar window starting today', () => {
    setup({});
    renderHook(() => useNextUp('c1', TZ));
    expect(vi.mocked(useCalendarEvents)).toHaveBeenCalledWith('c1', TODAY, addDays(TODAY, 14));
  });

  it('is not settled while any read is pending, nor before the zone is known', () => {
    setup({ tasks: pending() });
    expect(renderHook(() => useNextUp('c1', TZ)).result.current.settled).toBe(false);
    setup({});
    const noZone = renderHook(() => useNextUp('c1', null));
    expect(noZone.result.current.settled).toBe(false);
    expect(noZone.result.current.items).toEqual([]);
  });

  it('a failed read settles with isError (so the card can offer Retry, not "nothing scheduled")', () => {
    setup({ events: failed() });
    const { result } = renderHook(() => useNextUp('c1', TZ));
    expect(result.current.settled).toBe(true);
    expect(result.current.isError).toBe(true);
  });

  it('a failed YESTERDAY read only loses the backlog: it neither blocks nor errors the list', () => {
    setup({ meds: ok([dose('d', TODAY)]), yesterday: failed() });
    const { result } = renderHook(() => useNextUp('c1', TZ));
    expect(result.current.settled).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.items.map((i) => i.id)).toEqual(['d']);
  });

  it('refetch retries every read', () => {
    const meds = ok([]);
    const events = ok([]);
    const tasks = { ...ok({ tasks: [], total: 0 }) };
    setup({ meds, events, tasks });
    const { result } = renderHook(() => useNextUp('c1', TZ));
    result.current.refetch();
    expect(meds.refetch).toHaveBeenCalled();
    expect(events.refetch).toHaveBeenCalled();
    expect(tasks.refetch).toHaveBeenCalled();
  });
});
