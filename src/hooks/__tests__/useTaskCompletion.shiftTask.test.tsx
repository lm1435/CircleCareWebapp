import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { CalendarEvent } from '@/api/calendarEvents';

// docs/plans/shift-tasks.md: the shift detail reads GET /events, which hands out VIRTUAL occurrences of a
// repeating shift task (composite id): completing one is addressed by root + day. A task that belongs to a
// shift is measured (`shift_task_completed`, surface only); a plain task never is.

const mutate = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useCalendarEvents', () => ({ useCompleteEvent: () => ({ mutate }) }));
vi.mock('@/lib/analytics', () => ({
  Analytics: { shiftTaskCompleted: vi.fn(), taskUndone: vi.fn() },
}));
vi.mock('@/lib/keepalivePost', () => ({ keepalivePost: () => null }));

import { Analytics } from '@/lib/analytics';
import { useTaskCompletion, UNDO_DELAY_MS } from '../useTaskCompletion';

const link = {
  root_id: 'shift-root',
  date: '2026-11-09',
  title: 'Afternoons',
  assignee: { id: 'u', first_name: 'Lucia' },
  status: 'covered' as const,
  window_start: '2026-11-09T12:00:00',
  window_end: '2026-11-09T18:00:00',
};
const task = (over: Partial<CalendarEvent>): CalendarEvent =>
  ({
    id: 'task-root_2026-11-10',
    circle_id: 'c',
    event_type: 'task',
    title: 'Lunch',
    scheduled_date: '2026-11-10',
    scheduled_time: '14:00:00',
    created_at: '',
    updated_at: '',
    ...over,
  }) as CalendarEvent;

function setup(surface?: Parameters<typeof useTaskCompletion>[1]) {
  const client = new QueryClient();
  vi.spyOn(client, 'refetchQueries').mockResolvedValue();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useTaskCompletion('c', surface), { wrapper });
}

beforeEach(() => {
  vi.useFakeTimers();
  mutate.mockReset();
  mutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
  vi.mocked(Analytics.shiftTaskCompleted).mockClear();
});
afterEach(() => vi.useRealTimers());

describe('useTaskCompletion: shift tasks', () => {
  it('a VIRTUAL occurrence is completed by root + day, a physical row by its own id', () => {
    const { result } = setup('shift_detail');
    act(() => result.current.handleComplete(task({ is_virtual: true, parent_event_id: 'task-root', shift: link })));
    act(() => {
      vi.advanceTimersByTime(UNDO_DELAY_MS + 10);
    });
    expect(mutate).toHaveBeenCalledWith(
      {
        eventId: 'task-root',
        scheduledDate: '2026-11-10',
        circleId: 'c',
        source: 'tasks',
        // Verified against the tapped occurrence (its day, its series).
        occurrence: expect.objectContaining({
          parent_event_id: 'task-root',
          scheduled_date: '2026-11-10',
        }),
      },
      expect.anything()
    );
    mutate.mockClear();
    act(() => result.current.handleComplete(task({ id: 'physical-1', shift: link })));
    act(() => {
      vi.advanceTimersByTime(UNDO_DELAY_MS + 10);
    });
    expect(mutate).toHaveBeenCalledWith({
        eventId: 'physical-1',
        circleId: 'c',
        source: 'tasks',
        occurrence: expect.objectContaining({ id: 'physical-1' }),
      },
      expect.anything()
    );
    expect(mutate.mock.calls[0][0]).not.toHaveProperty('scheduledDate');
  });

  it('fires shift_task_completed with the surface once the completion lands (never before, never on undo)', () => {
    const { result } = setup('today');
    act(() => result.current.handleComplete(task({ id: 'a', shift: link })));
    expect(Analytics.shiftTaskCompleted).not.toHaveBeenCalled();
    act(() => result.current.handleUndo('a'));
    act(() => {
      vi.advanceTimersByTime(UNDO_DELAY_MS + 10);
    });
    expect(Analytics.shiftTaskCompleted).not.toHaveBeenCalled();
    act(() => result.current.handleComplete(task({ id: 'b', shift: link })));
    act(() => {
      vi.advanceTimersByTime(UNDO_DELAY_MS + 10);
    });
    expect(Analytics.shiftTaskCompleted).toHaveBeenCalledTimes(1);
    expect(Analytics.shiftTaskCompleted).toHaveBeenCalledWith({ surface: 'today' });
  });

  it('a plain task, and one linked but "outside" the window, is not a shift-task completion', () => {
    const { result } = setup();
    act(() => result.current.handleComplete(task({ id: 'plain' })));
    act(() =>
      result.current.handleComplete(task({ id: 'outside', shift: { ...link, status: 'outside' } }))
    );
    act(() => {
      vi.advanceTimersByTime(UNDO_DELAY_MS + 10);
    });
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(Analytics.shiftTaskCompleted).not.toHaveBeenCalled();
  });
});
