import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import {
  UpcomingAppointments,
  dateOffsetInTimezone,
  upcomingAppointments,
} from '../UpcomingAppointments';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import type { CalendarEvent } from '@/api/calendarEvents';

vi.mock('@/hooks/useCalendarEvents', () => ({ useCalendarEvents: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => 'h12' }));

const mockUseCalendarEvents = vi.mocked(useCalendarEvents);

const TZ = 'America/Denver';
/** 2026-09-05 08:00 Denver — a fixed "now" so every label is deterministic. */
const NOW = new Date('2026-09-05T14:00:00Z');

function event(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    circle_id: 'c1',
    event_type: 'appointment',
    title: 'Cardiology',
    scheduled_date: '2026-09-05',
    scheduled_time: '15:00:00',
    completed_at: null,
    ...overrides,
  } as CalendarEvent;
}

function setEvents(events: CalendarEvent[], isLoading = false): void {
  mockUseCalendarEvents.mockReturnValue({
    events,
    isLoading,
  } as unknown as ReturnType<typeof useCalendarEvents>);
}

function renderCard(): void {
  render(
    <MemoryRouter>
      <UpcomingAppointments circleId="c1" timezone={TZ} />
    </MemoryRouter>
  );
}

describe('UpcomingAppointments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('shows at most three appointments and labels today/tomorrow', () => {
    setEvents([
      event({ id: 'a', title: 'Cardiology', scheduled_date: '2026-09-05', scheduled_time: '15:00:00' }),
      event({ id: 'b', title: 'Physio', scheduled_date: '2026-09-06', scheduled_time: '09:00:00' }),
      event({ id: 'c', title: 'Dentist', scheduled_date: '2026-09-08', scheduled_time: '11:00:00' }),
      event({ id: 'd', title: 'Optician', scheduled_date: '2026-09-09', scheduled_time: '11:00:00' }),
    ]);
    renderCard();

    expect(screen.getByText('Cardiology')).toBeInTheDocument();
    expect(screen.getByText('Physio')).toBeInTheDocument();
    expect(screen.getByText('Dentist')).toBeInTheDocument();
    expect(screen.queryByText('Optician')).not.toBeInTheDocument();

    expect(screen.getByText(/^Today · /)).toBeInTheDocument();
    expect(screen.getByText(/^Tomorrow · /)).toBeInTheDocument();
  });

  it('renders nothing at all when nothing is upcoming', () => {
    setEvents([]);
    const { container } = render(
      <MemoryRouter>
        <UpcomingAppointments circleId="c1" timezone={TZ} />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a loading placeholder while the window is in flight', () => {
    setEvents([], true);
    renderCard();
    expect(screen.getByRole('status')).toHaveTextContent('Loading...');
  });

  it('only offers the footer "View all" row once there are more than three', () => {
    setEvents([
      event({ id: 'a', scheduled_date: '2026-09-06' }),
      event({ id: 'b', scheduled_date: '2026-09-07' }),
      event({ id: 'c', scheduled_date: '2026-09-08' }),
    ]);
    renderCard();
    // Just the SectionHeader's link, not the footer row.
    expect(screen.getAllByRole('link', { name: 'View all' })).toHaveLength(1);
  });

  describe('upcomingAppointments', () => {
    it('keeps only appointments — never tasks or medications', () => {
      const result = upcomingAppointments(
        [
          event({ id: 'appt' }),
          event({ id: 'task', event_type: 'task' }),
          event({ id: 'med', event_type: 'medication' }),
        ],
        TZ,
        NOW
      );
      expect(result.map((e) => e.id)).toEqual(['appt']);
    });

    // The bug mobile fixed: a 9:33 PM appointment stayed "upcoming" until
    // midnight, above genuinely upcoming rows and inside the 3-row cap.
    it('drops an appointment whose scheduled INSTANT has already passed today', () => {
      const result = upcomingAppointments(
        [
          event({ id: 'past', scheduled_date: '2026-09-05', scheduled_time: '07:00:00' }),
          event({ id: 'later', scheduled_date: '2026-09-05', scheduled_time: '15:00:00' }),
        ],
        TZ,
        NOW
      );
      expect(result.map((e) => e.id)).toEqual(['later']);
    });

    it('keeps an all-day appointment for the whole of its own day', () => {
      const result = upcomingAppointments(
        [event({ id: 'allday', scheduled_date: '2026-09-05', scheduled_time: null })],
        TZ,
        NOW
      );
      expect(result.map((e) => e.id)).toEqual(['allday']);
    });

    it('drops completed appointments', () => {
      const result = upcomingAppointments(
        [event({ id: 'done', scheduled_date: '2026-09-07', completed_at: '2026-09-01T00:00:00Z' })],
        TZ,
        NOW
      );
      expect(result).toEqual([]);
    });

    it('orders by date, then time, then id so the cap is deterministic', () => {
      const result = upcomingAppointments(
        [
          event({ id: 'z', scheduled_date: '2026-09-07', scheduled_time: '10:00:00' }),
          event({ id: 'a', scheduled_date: '2026-09-07', scheduled_time: '10:00:00' }),
          event({ id: 'm', scheduled_date: '2026-09-06', scheduled_time: '23:00:00' }),
        ],
        TZ,
        NOW
      );
      expect(result.map((e) => e.id)).toEqual(['m', 'a', 'z']);
    });
  });

  describe('dateOffsetInTimezone', () => {
    // Calendar arithmetic on the date key, not now + N*86_400_000: DST would
    // otherwise repeat or skip a day and mislabel "Tomorrow".
    it('steps one calendar day across a spring-forward transition', () => {
      // 2026-03-08 is the US DST start; the day before is 2026-03-07.
      const beforeDst = new Date('2026-03-07T18:00:00Z');
      expect(dateOffsetInTimezone(TZ, 1, beforeDst)).toBe('2026-03-08');
      expect(dateOffsetInTimezone(TZ, 14, beforeDst)).toBe('2026-03-21');
    });

    it('steps one calendar day across a fall-back transition', () => {
      // 2026-11-01 is the US DST end.
      const beforeFallBack = new Date('2026-10-31T18:00:00Z');
      expect(dateOffsetInTimezone(TZ, 1, beforeFallBack)).toBe('2026-11-01');
      expect(dateOffsetInTimezone(TZ, 2, beforeFallBack)).toBe('2026-11-02');
    });
  });
});
