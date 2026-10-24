import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { ShiftsWeekView } from '../ShiftsWeekView';

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

function shift(id: string, date: string, assigned: string | null): CalendarEvent {
  return {
    id,
    circle_id: 'c',
    event_type: 'shift',
    title: 'Night',
    scheduled_date: date,
    scheduled_time: '20:00:00',
    duration_minutes: 600,
    recurrence_rule: null,
    reminder_lead_minutes: null,
    assigned_to: assigned,
    created_at: '',
    updated_at: '',
  } as CalendarEvent;
}

const DAYS = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];

describe('ShiftsWeekView day header', () => {
  it('is ONE button whose label carries the count, with the "Opens the day view" hint', async () => {
    const user = userEvent.setup();
    const onDayOpen = vi.fn();
    const onAdd = vi.fn();
    render(
      <ShiftsWeekView
        days={DAYS}
        shifts={[shift('a', '2026-10-19', null), shift('b', '2026-10-19', 'u1')]}
        timezone="America/Chicago"
        todayStr="2026-10-19"
        members={[]}
        viewerId="u9"
        onOpen={vi.fn()}
        onDayOpen={onDayOpen}
        onAdd={onAdd}
      />
    );
    const header = screen.getByRole('button', { name: /^Today · Monday, Oct 19, 2 shifts · 1 open$/ });
    expect(header).toHaveAccessibleDescription('Opens the day view');
    expect(header).toHaveAttribute('aria-current', 'date');
    // The count is inside the SAME button (no separate element to tab to).
    expect(within(header).getByTestId('shifts-week-day-summary')).toHaveTextContent('2 shifts · 1 open');
    await user.click(header);
    expect(onDayOpen).toHaveBeenCalledWith('2026-10-19');
    // An empty day has the plain label and "No shifts".
    expect(screen.getByRole('button', { name: 'Sunday, Oct 18' })).toBeInTheDocument();
    // Only today carries the "Today" prefix (moss), only today is aria-current.
    expect(screen.getAllByText(/^Today ·$/)).toHaveLength(1);
    expect(document.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
    // ONE "Add shift" button for the whole week, with an icon (no literal "+").
    const adds = screen.getAllByRole('button', { name: 'Add shift' });
    expect(adds).toHaveLength(1);
    expect(adds[0]).not.toHaveTextContent('+');
    expect(adds[0].querySelector('svg')).not.toBeNull();
    await user.click(adds[0]);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});
