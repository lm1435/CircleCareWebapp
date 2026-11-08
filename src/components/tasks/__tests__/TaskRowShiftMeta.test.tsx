import { render, screen } from '@testing-library/react';
import '@/i18n';
import type { CalendarEvent, ShiftTaskLink } from '@/api/calendarEvents';

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
const { TaskRow } = await import('../TaskRow');

// docs/plans/shift-tasks.md "Elsewhere": a task added to a shift reads "Task · <first name> · <shift
// title>" in the Tasks list (and on Calendar / Today); an open shift reads "Open shift"; a task outside
// the window is a plain task. The name is `shift.assignee`, never `assigned_to`.

const link = (over: Partial<ShiftTaskLink> = {}): ShiftTaskLink => ({
  root_id: 'root',
  date: '2026-11-09',
  title: 'Afternoons',
  assignee: { id: 'u-lucia', first_name: 'Lucia' },
  status: 'covered',
  window_start: '2026-11-09T12:00:00',
  window_end: '2026-11-09T18:00:00',
  ...over,
});

const task = (shift: ShiftTaskLink | null | undefined, over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    id: 't1',
    circle_id: 'c',
    title: 'Give lunch',
    event_type: 'task',
    scheduled_date: '2026-11-09',
    scheduled_time: '14:00:00',
    assigned_to: null,
    shift,
    created_at: '',
    updated_at: '',
    ...over,
  }) as CalendarEvent;

function renderRow(t: CalendarEvent) {
  render(
    <TaskRow
      task={t}
      timezone="America/Chicago"
      canEdit
      members={[]}
      onComplete={vi.fn()}
      onUndo={vi.fn()}
      onEdit={vi.fn()}
      isPendingComplete={false}
    />
  );
}

it('covered: "Task · Lucia · Afternoons" instead of Unassigned', () => {
  renderRow(task(link()));
  expect(screen.getByTestId('task-shift-meta')).toHaveTextContent('Task · Lucia · Afternoons');
  expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
});

it('open shift: "Task · Open shift · Night"', () => {
  renderRow(task(link({ status: 'open', assignee: null, title: 'Night' })));
  expect(screen.getByTestId('task-shift-meta')).toHaveTextContent('Task · Open shift · Night');
});

it('outside the window: a plain task (Unassigned), no shift label', () => {
  renderRow(task(link({ status: 'outside', window_start: null, window_end: null })));
  expect(screen.queryByTestId('task-shift-meta')).not.toBeInTheDocument();
  expect(screen.getByText('Unassigned')).toBeInTheDocument();
});

it('a regular task keeps its own assignee line', () => {
  renderRow(task(null, { assigned_to_user: { id: 'u-marco', first_name: 'Marco', last_name: 'R', email: 'm@x.test' } as never }));
  expect(screen.queryByTestId('task-shift-meta')).not.toBeInTheDocument();
  expect(screen.getByText('Marco R')).toBeInTheDocument();
});
