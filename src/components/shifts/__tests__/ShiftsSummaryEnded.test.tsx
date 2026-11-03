/**
 * Owner screenshot (2026-11-02): Sunday read "2 shifts · 1 open" while the card on it said
 * "Not covered". An unfilled shift that has ENDED is not open (nobody can take it, the server
 * answers 409 SHIFT_ENDED): the week headers, the month cells / dots and the Day summary must
 * call it "not covered", judged by the shift's end in the CARE RECIPIENT's zone at a pinned
 * instant. Mirrors mobile's __tests__/components/shifts/ShiftsSummaryEnded.test.tsx.
 *
 * Recipient zone Asia/Tokyo (the process runs in America/Denver): at 2026-11-02T03:00Z it is
 * 12:00 Mon Nov 2 in Tokyo and still 20:00 Sun Nov 1 in Denver.
 */
import { render, screen } from '@testing-library/react';
import '@/i18n';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { ShiftsWeekView } from '../ShiftsWeekView';
import { ShiftsMonthView } from '../ShiftsMonthView';
import { coverageLabel, summariseShifts } from '../shiftUtils';
import { getMonthGridDays, startOfMonth } from '@/components/calendar/dateMath';

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const TZ = 'Asia/Tokyo';
const NOW = new Date('2026-11-02T03:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

function shift(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    circle_id: 'c',
    event_type: 'shift',
    title: 'Shift',
    duration_minutes: 60,
    recurrence_rule: null,
    reminder_lead_minutes: null,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as CalendarEvent;
}

/** Sun Nov 1, open, 09:00-10:00 Tokyo: ended yesterday. */
const yesterdayOpen = shift({ id: 'y', title: 'Morning', scheduled_date: '2026-11-01', scheduled_time: '09:00:00' });
/** Sun Nov 1 22:00 + 10 h, open: ended 08:00 today. */
const overnightEnded = shift({
  id: 'o',
  title: 'Night',
  scheduled_date: '2026-11-01',
  scheduled_time: '22:00:00',
  duration_minutes: 600,
});
/** Mon Nov 2 08:00-09:00, open: ended this morning. */
const todayEnded = shift({ id: 'e', title: 'Breakfast', scheduled_date: '2026-11-02', scheduled_time: '08:00:00' });
/** Mon Nov 2 18:00-19:00, open: still ahead. */
const todayUpcoming = shift({ id: 'u', title: 'Dinner', scheduled_date: '2026-11-02', scheduled_time: '18:00:00' });
/** Mon Nov 2 10:00, covered. */
const todayCovered = shift({
  id: 'c',
  title: 'Visit',
  scheduled_date: '2026-11-02',
  scheduled_time: '10:00:00',
  assigned_to: 'u1',
});
const ALL = [yesterdayOpen, overnightEnded, todayEnded, todayUpcoming, todayCovered];
const DAYS = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];

describe('summariseShifts / coverageLabel are ended-aware', () => {
  const t = i18n.getFixedT('en', 'shifts');
  it('only the upcoming unfilled shift is open; ended unfilled ones (overnight included) are not covered', () => {
    expect(summariseShifts(ALL, TZ)).toEqual({ total: 5, open: 1, notCovered: 3 });
    expect(coverageLabel(t, summariseShifts([todayCovered, todayEnded], TZ))).toBe('1 not covered');
    expect(coverageLabel(t, summariseShifts([todayEnded, todayUpcoming], TZ))).toBe('1 open · 1 not covered');
    expect(coverageLabel(t, summariseShifts([todayCovered], TZ))).toBe('none open');
  });
});

describe('ShiftsWeekView day header', () => {
  it('a day whose open shifts all ended says "not covered", never "open"', () => {
    render(
      <ShiftsWeekView
        days={DAYS}
        shifts={ALL}
        timezone={TZ}
        todayStr="2026-11-02"
        members={[]}
        viewerId="u9"
        onOpen={vi.fn()}
        onDayOpen={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Sunday, Nov 1, 2 shifts · 2 not covered' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Today · Monday, Nov 2, 3 shifts · 1 open · 1 not covered' })
    ).toBeInTheDocument();
  });
});

describe('ShiftsMonthView', () => {
  it('no "open" dot for a day whose open shifts all ended; the cell name says not covered', () => {
    render(
      <ShiftsMonthView
        gridDays={getMonthGridDays('2026-11-02')}
        monthStart={startOfMonth('2026-11-02')}
        shifts={ALL}
        timezone={TZ}
        todayStr="2026-11-02"
        onDayOpen={vi.fn()}
      />
    );
    const sun = document.querySelector('button[data-date="2026-11-01"]') as HTMLElement;
    expect(sun).toHaveAttribute('data-shift-dots', 'notCovered');
    expect(sun).toHaveAccessibleName('Sunday, November 1, 2 shifts, 2 not covered');
    const mon = document.querySelector('button[data-date="2026-11-02"]') as HTMLElement;
    expect(mon).toHaveAttribute('data-shift-dots', 'open');
    // The legend names the third state with the card's own word.
    expect(screen.getByRole('list', { name: 'Shifts key' })).toHaveTextContent('Not covered');
  });
});
