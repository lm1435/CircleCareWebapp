import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { createShiftTask } from '@/api/shiftTasks';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { ShiftTaskFormModal } from '../ShiftTaskFormModal';

// docs/plans/shift-tasks.md "Form": name* (red asterisk), a time inside the window, "Only <date>" on a
// repeating shift, inline errors per backend code, shift_task_added analytics.

vi.mock('@/api/shiftTasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shiftTasks')>()),
  createShiftTask: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/lib/analytics', () => ({
  Analytics: { shiftTaskAdded: vi.fn(), errorOccurred: vi.fn(), shiftTakeConflict: vi.fn() },
}));

const shift = (over: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({
    id: 'root_2026-11-10',
    parent_event_id: 'root',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Afternoons',
    scheduled_date: '2026-11-10',
    scheduled_time: '14:00:00',
    duration_minutes: 360,
    recurrence_rule: 'weekly',
    assigned_to: 'u-lucia',
    created_at: '',
    updated_at: '',
    ...over,
  }) as CalendarEvent;

function setup(props: Partial<React.ComponentProps<typeof ShiftTaskFormModal>> = {}) {
  const onClose = vi.fn();
  const onAdded = vi.fn();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
        <ShiftTaskFormModal
          circleId="c"
          shift={shift()}
          source="shift_detail"
          onClose={onClose}
          onAdded={onAdded}
          {...props}
        />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return { user, onClose, onAdded };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useCircle).mockReturnValue({ canEdit: true } as unknown as ReturnType<typeof useCircle>);
  vi.mocked(createShiftTask).mockResolvedValue({ id: 't' } as CalendarEvent);
});
afterEach(cleanup);

describe('shift task form', () => {
  it('has a required name (asterisk), a time defaulting to the shift start with the window hint, and no assignee', () => {
    setup();
    const name = screen.getByLabelText(/Task name/);
    expect(name).toBeRequired();
    expect(screen.getAllByText('*', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/^Time/)).toHaveValue('14:00');
    expect(screen.getByText('Between 2:00 PM and 8:00 PM')).toBeInTheDocument();
    expect(screen.queryByText(/assign/i)).not.toBeInTheDocument();
  });

  it('a repeating shift offers "Only <date>" and explains that it repeats; a one-off shift does not', () => {
    setup();
    expect(screen.getByRole('checkbox', { name: 'Only Tue, Nov 10' })).not.toBeChecked();
    expect(
      screen.getByText('Otherwise this task repeats with the shift and goes to whoever covers it.')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('shift-task-form-explain')).not.toBeInTheDocument();
    cleanup();
    setup({ shift: shift({ recurrence_rule: null, parent_event_id: null, id: 'one' }) });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    // Mobile parity: a one-off says where the task goes.
    expect(screen.getByTestId('shift-task-form-explain')).toHaveTextContent('It goes to whoever is on this shift.');
  });

  it('names the shift under the title on ONE line (a long name truncates; mobile parity)', () => {
    setup();
    const sub = screen.getByTestId('shift-task-form-shift');
    expect(sub).toHaveTextContent(/\S/);
    expect(sub).toHaveClass('truncate');
  });

  it('saves {scheduledDate, title, scheduled_time}, fires shift_task_added, and reports back', async () => {
    const { user, onAdded } = setup();
    await user.type(screen.getByLabelText(/Task name/), '  Give lunch ');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(createShiftTask).toHaveBeenCalledWith('c', 'root_2026-11-10', {
      scheduledDate: '2026-11-10',
      title: 'Give lunch',
      scheduled_time: '14:00',
    });
    expect(Analytics.shiftTaskAdded).toHaveBeenCalledWith({
      source: 'shift_detail',
      oneOff: false,
      shiftRepeats: true,
    });
  });

  it('"Only <date>" sends only_this_day and reports one_off', async () => {
    const { user } = setup({ source: 'saved_sheet' });
    await user.type(screen.getByLabelText(/Task name/), 'Walk');
    await user.click(screen.getByRole('checkbox', { name: 'Only Tue, Nov 10' }));
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(createShiftTask).toHaveBeenCalled());
    expect(vi.mocked(createShiftTask).mock.calls[0][2]).toMatchObject({ only_this_day: true });
    expect(Analytics.shiftTaskAdded).toHaveBeenCalledWith({
      source: 'saved_sheet',
      oneOff: true,
      shiftRepeats: true,
    });
  });

  it('an empty name and a time outside the window are refused inline with no request', async () => {
    const { user } = setup();
    const time = screen.getByLabelText(/^Time/);
    await user.clear(time);
    await user.type(time, '09:00');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText('Enter a task name.')).toBeInTheDocument();
    expect(screen.getByText('Pick a time inside this shift.')).toBeInTheDocument();
    expect(createShiftTask).not.toHaveBeenCalled();
  });

  it('an overnight window accepts an after-midnight time (next day) and refuses one past the end', async () => {
    const night = shift({ scheduled_time: '20:00:00', duration_minutes: 600 });
    const { user } = setup({ shift: night });
    await user.type(screen.getByLabelText(/Task name/), 'Turn');
    const time = screen.getByLabelText(/^Time/);
    await user.clear(time);
    await user.type(time, '06:30');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText('Pick a time inside this shift.')).toBeInTheDocument();
    await user.clear(time);
    await user.type(time, '02:00');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    await waitFor(() => expect(createShiftTask).toHaveBeenCalled());
  });

  it.each([
    ['SHIFT_TASK_OUTSIDE_SHIFT', 'Pick a time inside this shift.'],
    ['SHIFT_TASK_TIME_UNSUPPORTED', /can't repeat a task after midnight/],
  ])('%s stays on the form with its own inline words', async (code, words) => {
    vi.mocked(createShiftTask).mockRejectedValueOnce({ error: { code } });
    const { user, onClose, onAdded } = setup();
    await user.type(screen.getByLabelText(/Task name/), 'Lunch');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByText(words)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
    expect(Analytics.shiftTaskAdded).not.toHaveBeenCalled();
  });

  it.each([
    ['SHIFT_ENDED', "This shift has ended, so tasks can't be added to it."],
    ['SHIFT_NOT_FOUND', 'This shift is no longer here.'],
    ['SHIFT_INVALID_DATE', 'That day is not part of this shift.'],
  ])('%s stays on the form with its own inline words', async (code, words) => {
    vi.mocked(createShiftTask).mockRejectedValueOnce({ error: { code } });
    const { user, onClose } = setup();
    await user.type(screen.getByLabelText(/Task name/), 'Lunch');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByTestId('shift-inline-error')).toHaveTextContent(words);
    expect(onClose).not.toHaveBeenCalled();
    expect(Analytics.shiftTaskAdded).not.toHaveBeenCalled();
  });

  it.each(['SUBSCRIPTION_REQUIRED', 'FORBIDDEN'])(
    '%s (lapsed or view-only) closes the form: the shared paywall / toast handling is the feedback',
    async (code) => {
      vi.mocked(createShiftTask).mockRejectedValueOnce({ error: { code } });
      const { user, onClose } = setup();
      await user.type(screen.getByLabelText(/Task name/), 'Lunch');
      await user.click(screen.getByRole('button', { name: 'Add task' }));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(Analytics.shiftTaskAdded).not.toHaveBeenCalled();
    }
  );

  it('a network failure keeps the form and the typed input, with the words inline', async () => {
    vi.mocked(createShiftTask).mockRejectedValueOnce(new Error('network'));
    const { user, onClose } = setup();
    await user.type(screen.getByLabelText(/Task name/), 'Lunch');
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    expect(await screen.findByTestId('shift-inline-error')).toHaveTextContent(
      "Couldn't add the task. Please try again."
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Task name/)).toHaveValue('Lunch');
  });
});
