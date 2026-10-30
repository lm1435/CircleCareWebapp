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
  Analytics: { shiftTaken: vi.fn(), shiftTakeConflict: vi.fn(), errorOccurred: vi.fn() },
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
  it('a one-off: one Take button, no scope choice, the reminder picker starts on the shift value and unchanged sends none', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    expect(screen.getByRole('heading', { name: 'Take "Night"' })).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Reminder' });
    expect(picker).toHaveValue('60');
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Off', '1 hour', '2 hours', '4 hours', '1 day',
    ]);
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() =>
      expect(mockTake).toHaveBeenCalledWith('c', 's1', { scope: 'occurrence', scheduledDate: '2026-10-20' })
    );
  });

  it('changing the reminder sends reminder_lead_minutes (and Off sends null); the event reports reminderChanged', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reminder' }), '4 hours');
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() =>
      expect(mockTake).toHaveBeenCalledWith('c', 's1', {
        scope: 'occurrence',
        scheduledDate: '2026-10-20',
        reminder_lead_minutes: 240,
      })
    );
    await waitFor(() =>
      expect(Analytics.shiftTaken).toHaveBeenCalledWith({ scope: 'occurrence', reminderChanged: true })
    );
  });

  it('Off sends null; picking the original value again sends nothing', async () => {
    const user = userEvent.setup();
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Reminder' }), 'Off');
    await user.click(screen.getByRole('button', { name: 'Take shift' }));
    await waitFor(() => expect(mockTake).toHaveBeenCalled());
    expect(mockTake.mock.calls[0][2]).toHaveProperty('reminder_lead_minutes', null);
  });

  it('a shift with no reminder starts on Off', () => {
    renderDialog(shift({ id: 's1', parent_event_id: null, recurrence_rule: null, reminder_lead_minutes: null }));
    expect(screen.getByRole('combobox', { name: 'Reminder' })).toHaveValue('off');
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
    expect(await screen.findByText("You're on the shift \"Night\".")).toBeInTheDocument();
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
    mockTake.mockRejectedValueOnce(new Error('Network Error'));
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
