import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@/i18n';
import { getSeriesRoot, type CalendarEvent } from '@/api/calendarEvents';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { ShiftDetailModal } from '../ShiftDetailModal';

// The detail's Repeats row names every rule ("14 days on, 7 days off"), and a rotation gets a
// "Day n of N · back on <date>" line on its on days (counted from the ROOT's date, none on off days).

vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  getSeriesRoot: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

function shift(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'root_2026-11-15',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Handoff',
    scheduled_date: '2026-11-15',
    scheduled_time: '18:00:00',
    duration_minutes: 1440,
    recurrence_rule: 'cycle:14:7',
    parent_event_id: 'root',
    is_virtual: true,
    reminder_lead_minutes: null,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as CalendarEvent;
}

function renderDetail(s: CalendarEvent) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ShiftDetailModal circleId="c" shift={s} timezone="America/Chicago" onClose={vi.fn()} onAction={vi.fn()} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ user: { id: 'u-me' } } as never);
  vi.mocked(useCircle).mockReturnValue({
    members: [],
    canEdit: true,
    canManageMembers: true,
    viewOnly: false,
    isPremiumCircle: true,
    isOwner: true,
    hasShifts: true,
  } as unknown as ReturnType<typeof useCircle>);
  vi.mocked(getSeriesRoot).mockResolvedValue({
    id: 'root',
    scheduled_date: '2026-11-08',
    recurrence_rule: 'cycle:14:7',
    recurrence_days: null,
  } as never);
});

describe('shift detail: rotation', () => {
  it('reads "14 days on, 7 days off" and "Day 8 of 14 · back on Sun, Nov 29" on an on day', async () => {
    renderDetail(shift({}));
    expect(screen.getByTestId('shift-detail-repeat')).toHaveTextContent('14 days on, 7 days off');
    expect(await screen.findByTestId('shift-detail-rotation')).toHaveTextContent(
      'Day 8 of 14 · back on Sun, Nov 29'
    );
  });

  it('the last on day is Day 14 of 14', async () => {
    renderDetail(shift({ id: 'root_2026-11-21', scheduled_date: '2026-11-21' }));
    expect(await screen.findByTestId('shift-detail-rotation')).toHaveTextContent(
      'Day 14 of 14 · back on Sun, Nov 29'
    );
  });

  it('an off day has no position line', async () => {
    renderDetail(shift({ id: 'root_2026-11-24', scheduled_date: '2026-11-24' }));
    await waitFor(() => expect(getSeriesRoot).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('shift-detail-repeat')).toHaveTextContent('14 days on'));
    expect(screen.queryByTestId('shift-detail-rotation')).not.toBeInTheDocument();
  });

  it('never guesses the count before the root is known', () => {
    vi.mocked(getSeriesRoot).mockReturnValue(new Promise(() => {}));
    renderDetail(shift({}));
    expect(screen.queryByTestId('shift-detail-rotation')).not.toBeInTheDocument();
  });

  it('a root row counts from its own date, with no fetch', () => {
    renderDetail(shift({ id: 'root', parent_event_id: null, is_virtual: false, scheduled_date: '2026-11-08' }));
    expect(screen.getByTestId('shift-detail-rotation')).toHaveTextContent('Day 1 of 14 · back on Sun, Nov 29');
    expect(getSeriesRoot).not.toHaveBeenCalled();
  });

  it.each([
    ['monthly', 'Monthly'],
    ['yearly', 'Yearly'],
    ['every_other_day', 'Every other day'],
  ])('%s reads %s, not "Repeats", and has no position line', (rule, label) => {
    renderDetail(shift({ id: 'r', parent_event_id: null, is_virtual: false, recurrence_rule: rule }));
    expect(screen.getByTestId('shift-detail-repeat')).toHaveTextContent(label);
    expect(screen.queryByTestId('shift-detail-rotation')).not.toBeInTheDocument();
  });
});
