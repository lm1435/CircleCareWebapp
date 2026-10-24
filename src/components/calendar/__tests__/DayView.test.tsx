import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { DayView, sortDayEvents, type DayViewProps } from '../DayView';
import type { AsNeededDayEntry } from '../asNeededByDay';

// DayView: hero title (relative date in the RECIPIENT's zone), summary line,
// time-sorted rows, PRN row, empty state, nav callbacks. The machine runs in
// America/Denver and the recipient zone below is Pacific/Auckland (+13h), so a
// device-local "today" would be wrong in every assertion that matters.

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const TZ = 'Pacific/Auckland';
// 2026-06-12T20:00Z is 08:00 on Sat 2026-06-13 in Auckland (NZST, UTC+12) and
// 14:00 on Fri 2026-06-12 in Denver.
const NOW = new Date('2026-06-12T20:00:00Z');

function ev(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    circle_id: 'circle-1',
    event_type: 'medication',
    title: id,
    scheduled_date: '2026-06-13',
    scheduled_time: '09:00:00',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    confirmation: null,
    ...overrides,
  };
}

function setup(overrides: Partial<DayViewProps> = {}) {
  const props: DayViewProps = {
    date: '2026-06-13',
    events: [],
    asNeeded: [],
    timezone: TZ,
    onEventClick: vi.fn(),
    onAsNeededOpen: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
    ...overrides,
  };
  render(<DayView {...props} />);
  return props;
}

beforeEach(() => {
  mockUseHourCycle.mockReturnValue('12h');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('DayView', () => {
  it('sorts all-day first, then by time, then by title', () => {
    const sorted = sortDayEvents([
      ev('c', { title: 'C', scheduled_time: '10:00:00' }),
      ev('b', { title: 'B', scheduled_time: '08:00:00' }),
      ev('a', { title: 'A', scheduled_time: '08:00:00' }),
      ev('allday', { title: 'Z', event_type: 'task', scheduled_time: null }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['allday', 'a', 'b', 'c']);
  });

  it('renders the day rows in time order and only for that date', () => {
    setup({
      events: [
        ev('late', { title: 'Late med', medication_name: 'Late med', scheduled_time: '21:00:00' }),
        ev('early', { title: 'Early med', medication_name: 'Early med', scheduled_time: '07:00:00' }),
        ev('other', { title: 'Other day', scheduled_date: '2026-06-14' }),
      ],
    });
    const rows = screen.getAllByTestId('day-event');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAccessibleName(/^Early med, Medication, 7:00 AM/);
    expect(rows[1]).toHaveAccessibleName(/^Late med, Medication, 9:00 PM/);
    expect(screen.queryByText('Other day')).not.toBeInTheDocument();
  });

  it('summarises with plurals: 1 dose · 1 appointment', () => {
    setup({
      events: [
        ev('m1'),
        ev('a1', { event_type: 'appointment', scheduled_time: '11:00:00' }),
      ],
    });
    expect(screen.getByTestId('day-view-summary')).toHaveTextContent('1 dose · 1 appointment');
  });

  it('pluralises doses, appointments and tasks', () => {
    setup({
      events: [
        ev('m1'),
        ev('m2', { scheduled_time: '10:00:00' }),
        ev('a1', { event_type: 'appointment' }),
        ev('a2', { event_type: 'appointment', scheduled_time: '12:00:00' }),
        ev('t1', { event_type: 'task', scheduled_time: null }),
        ev('t2', { event_type: 'task', scheduled_time: null }),
      ],
    });
    expect(screen.getByTestId('day-view-summary')).toHaveTextContent(
      '2 doses · 2 appointments · 2 tasks'
    );
  });

  it('shows a PRN row that opens that medication history', async () => {
    const entry: AsNeededDayEntry = { eventId: 'prn-1', name: 'Tylenol', count: 2 };
    const props = setup({ asNeeded: [entry] });
    const row = screen.getByTestId('as-needed-day-row');
    expect(row).toHaveTextContent('Tylenol');
    await userEvent.setup({ advanceTimers: () => {} }).click(row);
    expect(props.onAsNeededOpen).toHaveBeenCalledWith(entry);
    // A PRN-only day is not "empty".
    expect(screen.queryByText('Nothing scheduled for this day')).not.toBeInTheDocument();
  });

  it('empty state: copy, and the Add CTA only when onAdd is given', async () => {
    const onAdd = vi.fn();
    setup({ onAdd });
    expect(screen.getByText('Nothing scheduled for this day')).toBeInTheDocument();
    expect(
      screen.getByText('Add a medication or appointment to start tracking care here.')
    ).toBeInTheDocument();
    await userEvent.setup({ advanceTimers: () => {} }).click(
      screen.getByRole('button', { name: 'Add event' })
    );
    expect(onAdd).toHaveBeenCalled();
  });

  it('empty state is read-only (no CTA) without onAdd', () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Add event' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "When the care team adds medications or appointments, they'll show up here."
      )
    ).toBeInTheDocument();
  });

  it('clicking a row calls onEventClick with that event', async () => {
    const m = ev('m1', { title: 'Metformin', medication_name: 'Metformin' });
    const props = setup({ events: [m] });
    await userEvent.setup({ advanceTimers: () => {} }).click(
      screen.getByRole('button', { name: /^Metformin,/ })
    );
    expect(props.onEventClick).toHaveBeenCalledWith(m);
  });

  it('prev / next / Today call their handlers; Today is disabled on today', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    // Auckland today is 2026-06-13 (Denver's is still 06-12).
    const onToday = vi.fn();
    const props = setup({ date: '2026-06-12', onToday });
    await user.click(screen.getByRole('button', { name: 'Previous day' }));
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(props.onPrev).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(onToday).toHaveBeenCalledTimes(1);
  });

  it('Today is disabled when the shown date is today', () => {
    setup({ date: '2026-06-13' });
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
  });

  describe('recipient-timezone relative title at a day boundary', () => {
    it('is "Today" for the recipient day, not the machine day', () => {
      setup({ date: '2026-06-13' });
      expect(screen.getByTestId('day-view-title')).toHaveTextContent('Today, Saturday');
    });

    it('the machine-local day reads as Yesterday', () => {
      setup({ date: '2026-06-12' });
      expect(screen.getByTestId('day-view-title')).toHaveTextContent('Yesterday, Friday');
    });

    it('tomorrow and further dates', () => {
      setup({ date: '2026-06-14' });
      expect(screen.getByTestId('day-view-title')).toHaveTextContent('Tomorrow, Sunday');
    });

    it('a distant date shows the full date and no relative word', () => {
      setup({ date: '2026-06-20' });
      expect(screen.getByTestId('day-view-title')).toHaveTextContent('Saturday, June 20');
      expect(screen.getByTestId('day-view-title')).not.toHaveTextContent(/Today|Tomorrow|Yesterday/);
    });

    it('flips with the recipient clock: same instant, a zone behind is still the 12th', () => {
      setup({ date: '2026-06-12', timezone: 'Pacific/Honolulu' });
      // 20:00Z = 10:00 on the 12th in Honolulu.
      expect(screen.getByTestId('day-view-title')).toHaveTextContent('Today, Friday');
    });
  });

  it('exposes a seam: shiftsSlot replaces the schedule body but keeps the hero', () => {
    setup({ shiftsSlot: <div data-testid="slot">shifts</div>, events: [ev('m1')] });
    expect(screen.getByTestId('slot')).toBeInTheDocument();
    expect(screen.queryByTestId('day-event')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeInTheDocument();
  });

  it('Today control is wired through a controlled parent', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    function Host() {
      const [date, setDate] = useState('2026-06-20');
      return (
        <DayView
          date={date}
          events={[]}
          asNeeded={[]}
          timezone={TZ}
          onEventClick={() => {}}
          onPrev={() => setDate('2026-06-19')}
          onNext={() => setDate('2026-06-21')}
          onToday={() => setDate('2026-06-13')}
        />
      );
    }
    render(<Host />);
    await user.click(screen.getAllByRole('button', { name: 'Today' }).at(-1) as HTMLElement);
    expect(within(screen.getAllByTestId('day-view').at(-1) as HTMLElement).getByTestId('day-view-title')).toHaveTextContent('Today, Saturday');
  });
});
