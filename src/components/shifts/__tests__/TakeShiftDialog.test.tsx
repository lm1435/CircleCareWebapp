import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { getSeriesRoot } from '@/api/calendarEvents';
import { takeShift } from '@/api/shifts';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { TakeShiftDialog } from '../TakeShiftDialog';

vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  getSeriesRoot: vi.fn(),
}));
vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  takeShift: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/lib/analytics', () => ({
  Analytics: { shiftTaken: vi.fn(), shiftTakeConflict: vi.fn(), errorOccurred: vi.fn(), shiftTakeReminderExpanded: vi.fn() },
}));

const mockTake = vi.mocked(takeShift);
const mockRoot = vi.mocked(getSeriesRoot);

function circle(over: Record<string, unknown> = {}) {
  vi.mocked(useCircle).mockReturnValue({
    canManageMembers: false,
    viewerRole: 'member',
    timezone: 'America/Chicago',
    members: [],
    ...over,
  } as unknown as ReturnType<typeof useCircle>);
}

function shift(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'root_2026-10-20',
    parent_event_id: 'root',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Night',
    scheduled_date: '2026-10-20',
    scheduled_time: '20:00:00',
    duration_minutes: 720,
    recurrence_rule: 'daily',
    reminder_lead_minutes: 60,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function renderDialog(s: CalendarEvent) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <TakeShiftDialog circleId="c" shift={s} onClose={onClose} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  circle();
  mockRoot.mockResolvedValue({ id: 'root', scheduled_date: '2026-10-01', assigned_to: null } as never);
  mockTake.mockResolvedValue({ event: shift(), rootId: 'root' });
});

describe('TakeShiftDialog', () => {
  // Approved mock 2026-11-08 (mobile TakeShiftSheet): ONE line "Reminder · 1 hour before" + Change; Change opens
  // the Reminders card in place (toggle + one checkbox per lead, several since 1.4.2). Take shift is the only
  // filled button.
  const change = () => screen.getByRole('button', { name: /^Change reminder, / });
  const choices = () => screen.getByRole('group', { name: 'Remind before the shift' });
  const box = (name: string) => within(choices()).getByRole('checkbox', { name });
  const toggle = () => screen.getByRole('switch', { name: 'Enable notifications' });
  const checkedLeads = () =>
    within(choices())
      .getAllByRole('checkbox')
      .filter((r) => r.getAttribute('aria-checked') === 'true')
      .map((r) => document.getElementById(r.getAttribute('aria-labelledby') ?? '')?.textContent);
  const takeBody = () => mockTake.mock.calls[0][2];

  it('a one-off: one Take button, no scope choice, the reminder is one line and unchanged sends none', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    expect(screen.getByRole('heading', { name: 'Take "Night"' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByTestId('take-shift-reminder-value')).toHaveTextContent('Reminder · 1 hour before');
    expect(change()).toHaveAccessibleName('Change reminder, 1 hour before');
    expect(change()).toHaveAttribute('aria-expanded', 'false');
    expect(change().className).not.toContain('bg-primary-fill');
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelectorAll('button[class*="bg-primary-fill"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Take shift' }).className).toContain('bg-primary-fill');
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() =>
      expect(mockTake).toHaveBeenCalledWith('c', 's1', { scope: 'occurrence', scheduledDate: '2026-10-20' })
    );
  });

  it('Change opens the Reminders card: toggle + four checkboxes, the shift\'s own checked and focused; counts it', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(change());
    expect(Analytics.shiftTakeReminderExpanded).toHaveBeenCalledTimes(1);
    expect(toggle()).toBeChecked();
    expect(within(choices()).getAllByRole('checkbox')).toHaveLength(4);
    expect(checkedLeads()).toEqual(['1 hour before']);
    expect(box('1 hour before')).toHaveFocus();
  });

  it('N: the take rows are checkboxes, never radios (no Off chip)', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(change());
    expect(within(choices()).queryAllByRole('radio')).toHaveLength(0);
    expect(screen.queryByRole('radio', { name: 'Off' })).not.toBeInTheDocument();
  });

  it('P: a 1.4.2 shift with [1440, 60] reads both and opens with both checked', async () => {
    const user = userEvent.setup();
    renderDialog(
      shift({ id: 's1', parent_event_id: null, recurrence_rule: null, reminder_leads_minutes: [1440, 60] })
    );
    expect(screen.getByTestId('take-shift-reminder-value')).toHaveTextContent(
      'Reminder · 1 day before, 1 hour before'
    );
    await user.click(change());
    expect(checkedLeads()).toEqual(['1 day before', '1 hour before']);
  });

  it('P: a legacy row (only reminder_lead_minutes = 120) shows 2 hours checked', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null, reminder_lead_minutes: 120 }));
    expect(screen.getByTestId('take-shift-reminder-value')).toHaveTextContent('Reminder · 2 hours before');
    await user.click(change());
    expect(checkedLeads()).toEqual(['2 hours before']);
  });

  it('N: adding a lead sends the whole array ([240, 60]); the event reports reminderChanged', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(change());
    await user.click(box('4 hours before'));
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() =>
      expect(mockTake).toHaveBeenCalledWith('c', 's1', {
        scope: 'occurrence',
        scheduledDate: '2026-10-20',
        reminder_lead_minutes: 60,
        reminder_leads_minutes: [240, 60],
      })
    );
    await waitFor(() =>
      expect(Analytics.shiftTaken).toHaveBeenCalledWith({ scope: 'occurrence', reminderChanged: true })
    );
  });

  it('N: unchecking the last lead turns it off and sends null, never []', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(change());
    await user.click(box('1 hour before'));
    expect(toggle()).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() => expect(mockTake).toHaveBeenCalled());
    expect(takeBody()).toHaveProperty('reminder_leads_minutes', null);
    expect(takeBody()).toHaveProperty('reminder_lead_minutes', null);
  });

  it('P/N: keyboard-unchecking the last box moves focus to the toggle, never to <body> (WCAG 2.4.3)', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(change());
    expect(box('1 hour before')).toHaveFocus();
    await user.keyboard(' ');
    expect(toggle()).not.toBeChecked();
    expect(toggle()).toHaveFocus();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('P: the toggle off sends both null', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(change());
    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() => expect(mockTake).toHaveBeenCalled());
    expect(takeBody()).toHaveProperty('reminder_leads_minutes', null);
    expect(takeBody()).toHaveProperty('reminder_lead_minutes', null);
  });

  it('changing it and changing it back sends nothing (unchanged = absent)', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(change());
    await user.click(box('2 hours before'));
    await user.click(box('2 hours before'));
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() => expect(mockTake).toHaveBeenCalled());
    expect(takeBody()).not.toHaveProperty('reminder_leads_minutes');
    expect(takeBody()).not.toHaveProperty('reminder_lead_minutes');
    await waitFor(() =>
      expect(Analytics.shiftTaken).toHaveBeenCalledWith({ scope: 'occurrence', reminderChanged: false })
    );
  });

  it('a shift with no reminder reads "Reminder · Off"', () => {
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null, reminder_lead_minutes: null }));
    expect(screen.getByTestId('take-shift-reminder-value')).toHaveTextContent('Reminder · Off');
  });

  it('repeating + open series: "Just this one" (default) or "This and every future one"; future sends scope future', async () => {
    const user = userEvent.setup();
    const { onClose } = renderDialog(shift());
    const just = await screen.findByRole('radio', { name: /Just this one/ });
    expect(just).toBeChecked();
    // No per-pattern copy ("Every night from now on") any more.
    expect(screen.queryByText(/from now on/)).not.toBeInTheDocument();
    await user.click(await screen.findByRole('radio', { name: /This and every future one/ }));
    expect(screen.getByText('You can drop any one later')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() =>
      expect(mockTake).toHaveBeenCalledWith('c', 'root_2026-10-20', {
        scope: 'future',
        scheduledDate: '2026-10-20',
      })
    );
    await waitFor(() =>
      expect(Analytics.shiftTaken).toHaveBeenCalledWith({ scope: 'future', reminderChanged: false })
    );
    expect(onClose).toHaveBeenCalled();
    // No quoted title in the toast (owner 2026-11-08).
    expect(await screen.findByText("You're on it.")).toBeInTheDocument();
  });

  it('a series whose default is someone else offers no "from now on" to a plain member', async () => {
    mockRoot.mockResolvedValue({ id: 'root', scheduled_date: '2026-10-01', assigned_to: 'u-other' } as never);
    renderDialog(shift());
    await waitFor(() => expect(mockRoot).toHaveBeenCalled());
    // Radios never appear for this viewer.
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('...but the owner / a manager still may take over the series', async () => {
    circle({ canManageMembers: true });
    mockRoot.mockResolvedValue({ id: 'root', scheduled_date: '2026-10-01', assigned_to: 'u-other' } as never);
    renderDialog(shift());
    expect(await screen.findByRole('radio', { name: /This and every future one/ })).toBeInTheDocument();
  });

  it('409 SHIFT_ALREADY_TAKEN: toast "{takenBy} just took this shift." and the conflict is counted', async () => {
    const user = userEvent.setup();
    mockTake.mockRejectedValue({
      success: false,
      error: { code: 'SHIFT_ALREADY_TAKEN', message: 'x', takenBy: 'Ana' },
    });
    const { onClose } = renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    expect(await screen.findByText('Ana just took this shift.')).toBeInTheDocument();
    expect(Analytics.shiftTakeConflict).toHaveBeenCalled();
    expect(Analytics.shiftTaken).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('SHIFT_NOT_FOUND: the dialog closes and toasts "This shift is no longer available."', async () => {
    const user = userEvent.setup();
    mockTake.mockRejectedValue({ success: false, error: { code: 'SHIFT_NOT_FOUND', message: 'x' } });
    const { onClose } = renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    expect(await screen.findByText('This shift is no longer available.')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
  });

  it('a network / server failure stays inline with the message, keeps the dialog open and can be retried', async () => {
    const user = userEvent.setup();
    // A 5xx ANSWER (not a transport failure: those retry in-call first, item 9).
    mockTake.mockRejectedValueOnce({ success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } });
    const { onClose } = renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    expect(await screen.findByTestId('take-shift-error')).toHaveTextContent(
      "We couldn't take the shift. Try again."
    );
    expect(onClose).not.toHaveBeenCalled();
    // Retry succeeds: the inline error is gone and the dialog closes.
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByTestId('take-shift-error')).not.toBeInTheDocument();
  });
});
