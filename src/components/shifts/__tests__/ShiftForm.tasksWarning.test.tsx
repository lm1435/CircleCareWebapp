import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { getSeriesRoot, type CalendarEvent, type ShiftTaskLink } from '@/api/calendarEvents';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { ShiftFormModal } from '../ShiftFormModal';

// docs/plans/shift-tasks.md "Shift edits (DECIDED)": a time or duration edit keeps each task's clock
// time; a task that falls outside the new window drops off the list and stays a normal task. The
// edit screen warns FIRST ("2 tasks fall outside the new hours..."). The same warning covers a
// "this shift" date move and a repeat change. Counted client-side from the open tasks it holds.

vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  getSeriesRoot: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
const linked = vi.hoisted(() => ({ tasks: [] as unknown[] }));
vi.mock('@/hooks/useShiftTasks', () => ({ useLinkedOpenTasks: () => linked.tasks }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    shiftEdited: vi.fn(),
    shiftSeriesRescheduled: vi.fn(),
    shiftTakeConflict: vi.fn(),
    shiftEditTasksWarningShown: vi.fn(),
  },
}));
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const DAY = '2026-10-21';
const occurrence = {
  id: 'root_2026-10-21',
  parent_event_id: 'root',
  circle_id: 'c',
  event_type: 'shift',
  title: 'Afternoons',
  scheduled_date: DAY,
  scheduled_time: '12:00:00',
  duration_minutes: 360, // 12:00 - 6:00 PM
  recurrence_rule: 'daily',
  reminder_lead_minutes: 60,
  assigned_to: 'u-ana',
  created_at: '',
  updated_at: '',
} as CalendarEvent;

const link: ShiftTaskLink = {
  root_id: 'root',
  date: DAY,
  title: 'Afternoons',
  assignee: { id: 'u-ana', first_name: 'Ana' },
  status: 'covered',
  window_start: `${DAY}T12:00:00`,
  window_end: `${DAY}T18:00:00`,
};
const task = (id: string, time: string, over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    id,
    circle_id: 'c',
    event_type: 'task',
    title: id,
    scheduled_date: DAY,
    scheduled_time: time,
    assigned_to: null,
    shift: link,
    created_at: '',
    updated_at: '',
    ...over,
  }) as CalendarEvent;

const field = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const setTime = (which: 'start' | 'end', value: string) => {
  const id = which === 'start' ? 'shift_start' : 'shift_end';
  if (!document.getElementById(id)) fireEvent.click(screen.getByTestId(`shift-${which}-tile`));
  fireEvent.change(field(id), { target: { value } });
};

function renderEdit() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <ShiftFormModal circleId="c" shift={occurrence} onClose={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  linked.tasks = [task('t-1pm', '13:00:00'), task('t-2pm', '14:00:00'), task('t-5pm', '17:00:00')];
  vi.mocked(getSeriesRoot).mockResolvedValue({
    id: 'root',
    scheduled_date: '2026-10-20',
    recurrence_rule: 'daily',
    recurrence_days: null,
  } as never);
  vi.mocked(useCircle).mockReturnValue({
    circle: { id: 'c', recipient_name: 'Rosa', owner_id: 'u-me' },
    timezone: 'America/Chicago',
    members: [{ id: 'u-ana', first_name: 'Ana', last_name: 'R', email: 'a@x.test', role: 'member', is_care_recipient: false }],
    canEdit: true,
    canManageMembers: true,
    viewerRole: 'owner',
  } as unknown as ReturnType<typeof useCircle>);
});

describe('shift edit: tasks that would fall outside the new hours', () => {
  it('shows nothing until the edit would orphan a task', () => {
    renderEdit();
    expect(screen.queryByTestId('shift-edit-tasks-warning')).not.toBeInTheDocument();
    setTime('start', '11:00'); // widening: 11:00 - 6:00 PM keeps all three
    expect(screen.queryByTestId('shift-edit-tasks-warning')).not.toBeInTheDocument();
    expect(Analytics.shiftEditTasksWarningShown).not.toHaveBeenCalled();
  });

  it('a later start warns with the count: "2 tasks fall outside the new hours..."', () => {
    renderEdit();
    setTime('start', '16:00'); // 4:00 - 6:00 PM: 1 PM and 2 PM fall out, 5 PM stays
    expect(screen.getByTestId('shift-edit-tasks-warning')).toHaveTextContent(
      "2 tasks fall outside the new hours. They'll stay on the calendar as tasks for Anyone."
    );
    expect(Analytics.shiftEditTasksWarningShown).toHaveBeenCalledWith({ kind: 'time', countBucket: '2-3' });
  });

  it('one task reads singular', () => {
    renderEdit();
    setTime('start', '13:30'); // only 1 PM falls out
    expect(screen.getByTestId('shift-edit-tasks-warning')).toHaveTextContent(
      "1 task falls outside the new hours. It'll stay on the calendar as a task for Anyone."
    );
  });

  it('an earlier end warns about the tasks past it', () => {
    renderEdit();
    setTime('end', '16:00'); // 12:00 - 4:00 PM: the 5 PM task falls out
    expect(screen.getByTestId('shift-edit-tasks-warning')).toHaveTextContent('1 task falls outside');
  });

  it('a "this shift" date move leaves every task of that occurrence on its own date', () => {
    renderEdit();
    fireEvent.change(field('shift_date'), { target: { value: '2026-10-22' } });
    expect(screen.getByTestId('shift-edit-tasks-warning')).toHaveTextContent('3 tasks fall outside');
    expect(Analytics.shiftEditTasksWarningShown).toHaveBeenCalledWith({ kind: 'date', countBucket: '2-3' });
  });

  it('tasks of other shifts and regular tasks never count', () => {
    linked.tasks = [
      task('other-shift', '13:00:00', { shift: { ...link, root_id: 'other' } }),
      task('regular', '13:00:00', { shift: null }),
      task('outside', '13:00:00', { shift: { ...link, status: 'outside' } }),
    ];
    renderEdit();
    setTime('start', '16:00');
    expect(screen.queryByTestId('shift-edit-tasks-warning')).not.toBeInTheDocument();
  });

  it('is announced politely and fires its analytics once per change, not per keystroke', async () => {
    renderEdit();
    setTime('start', '16:00');
    expect(screen.getByRole('status')).toHaveTextContent('fall outside the new hours');
    expect(Analytics.shiftEditTasksWarningShown).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole('radio', { name: 'This shift' }));
    expect(Analytics.shiftEditTasksWarningShown).toHaveBeenCalledTimes(1);
  });
});
