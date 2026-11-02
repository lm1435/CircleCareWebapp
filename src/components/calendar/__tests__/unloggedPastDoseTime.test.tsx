import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { DayView } from '../DayView';
import { WeekView } from '../WeekView';
import { MonthView } from '../MonthView';
import { EventDetailModal } from '../EventDetailModal';
import { hidesUnloggedDoseTime } from '../eventStyles';

// 1.4.0 owner decision: a PAST day's dose that nobody answered (no taken, no
// skipped) shows NO clock time. After a time edit (7:00 -> 7:15) that day is a
// virtual occurrence built from the parent row, so it would say 7:15 on a day
// the dose was due at 7:00. Taken and skipped doses are frozen at their own
// time and keep it; today's and future doses keep theirs.
//
// The clock is PINNED and the recipient lives in Pacific/Auckland: 2026-06-12
// 20:00Z is 08:00 Sat 06-13 there and 14:00 Fri 06-12 in Denver (the dev
// machine), so a device-local "today" would get every case below wrong.

vi.mock('../EventNotesPanel', () => ({ EventNotesPanel: () => null }));
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => mockUseHourCycle() }));

const TZ = 'Pacific/Auckland';
const NOW = new Date('2026-06-12T20:00:00Z');
const TODAY = '2026-06-13';
const YESTERDAY = '2026-06-12';

function dose(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'root-1_2026-06-12',
    parent_event_id: 'root-1',
    is_virtual: true,
    circle_id: 'circle-1',
    event_type: 'medication',
    title: 'Lisinopril',
    medication_name: 'Lisinopril',
    medication_dosage: '10mg',
    scheduled_date: YESTERDAY,
    scheduled_time: '07:15:00',
    recurrence_rule: 'daily',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    confirmation: null,
    ...overrides,
  };
}

const answered = (status: 'taken' | 'skipped'): Partial<CalendarEvent> => ({
  id: `child-${status}`,
  is_virtual: false,
  scheduled_time: '07:00:00',
  confirmation: {
    id: `c-${status}`,
    status,
    confirmed_at: '2026-06-11T19:05:00Z',
    confirmed_by: 'u1',
  } as CalendarEvent['confirmation'],
});

beforeEach(() => {
  mockUseHourCycle.mockReturnValue('12h');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('hidesUnloggedDoseTime', () => {
  it('is true only for an unanswered dose on a PAST recipient-zone day', () => {
    expect(hidesUnloggedDoseTime(dose(), TZ, NOW)).toBe(true);
    expect(
      hidesUnloggedDoseTime(
        dose({ confirmation: { status: 'missed' } as CalendarEvent['confirmation'] }),
        TZ,
        NOW
      )
    ).toBe(true);
    expect(hidesUnloggedDoseTime(dose(answered('taken')), TZ, NOW)).toBe(false);
    expect(hidesUnloggedDoseTime(dose(answered('skipped')), TZ, NOW)).toBe(false);
    expect(hidesUnloggedDoseTime(dose({ scheduled_date: TODAY }), TZ, NOW)).toBe(false);
    expect(hidesUnloggedDoseTime(dose({ scheduled_date: '2026-06-14' }), TZ, NOW)).toBe(false);
    expect(hidesUnloggedDoseTime(dose({ event_type: 'task' }), TZ, NOW)).toBe(false);
    expect(hidesUnloggedDoseTime(dose({ as_needed: true }), TZ, NOW)).toBe(false);
  });
});

describe('DayView', () => {
  const day = (date: string, events: CalendarEvent[]) =>
    render(
      <DayView
        date={date}
        events={events}
        asNeeded={[]}
        timezone={TZ}
        onEventClick={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onToday={vi.fn()}
      />
    );

  it('a past day nobody answered shows no time; the label is name, type, status', () => {
    day(YESTERDAY, [dose()]);
    const row = screen.getByTestId('day-event');
    expect(row).toHaveAccessibleName('Lisinopril, Medication, Not marked');
    expect(within(row).queryByText(/7:15/)).not.toBeInTheDocument();
  });

  it.each(['taken', 'skipped'] as const)('a past %s dose keeps its time', (status) => {
    day(YESTERDAY, [dose(answered(status))]);
    const row = screen.getByTestId('day-event');
    expect(within(row).getByText(/7:00 AM/)).toBeInTheDocument();
    expect(row).toHaveAccessibleName(/^Lisinopril, Medication, 7:00 AM[^,]*, /);
  });

  it("today's untaken dose keeps its time", () => {
    day(TODAY, [dose({ id: 'root-1_2026-06-13', scheduled_date: TODAY })]);
    const row = screen.getByTestId('day-event');
    expect(within(row).getByText(/7:15 AM/)).toBeInTheDocument();
  });
});

describe('WeekView', () => {
  it('drops the time from an unlogged past chip only', () => {
    const past = dose();
    const taken = dose({ ...answered('taken'), scheduled_date: '2026-06-11' });
    const today = dose({ id: 'root-1_2026-06-13', scheduled_date: TODAY });
    render(
      <WeekView
        days={['2026-06-07', '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', YESTERDAY, TODAY]}
        eventsByDay={
          new Map([
            ['2026-06-11', [taken]],
            [YESTERDAY, [past]],
            [TODAY, [today]],
          ])
        }
        careRecipientTimezone={TZ}
        todayStr={TODAY}
        onEventClick={vi.fn()}
      />
    );
    const chips = screen.getAllByRole('button', { name: /^Lisinopril, / });
    const names = chips.map((c) => c.getAttribute('aria-label'));
    expect(names).toContain('Lisinopril, Medication, Not marked');
    expect(names.some((n) => /^Lisinopril, Medication, 7:00 AM[^,]*, Taken/.test(n ?? ''))).toBe(true);
    expect(names.some((n) => /^Lisinopril, Medication, 7:15 AM[^,]*, /.test(n ?? ''))).toBe(true);
    const pastChip = chips.find((c) => c.getAttribute('aria-label') === 'Lisinopril, Medication, Not marked')!;
    expect(within(pastChip).queryByText(/7:15/)).not.toBeInTheDocument();
  });
});

describe('MonthView day panel', () => {
  it('drops the time from an unlogged past row', async () => {
    vi.useRealTimers(); // userEvent needs real timers; the day is still pinned below
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    const gridDays = Array.from({ length: 35 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 4, 31 + i));
      return d.toISOString().slice(0, 10);
    });
    render(
      <MonthView
        gridDays={gridDays}
        monthStart="2026-06-01"
        eventsByDay={new Map([[YESTERDAY, [dose()]]])}
        careRecipientTimezone={TZ}
        todayStr={TODAY}
        onEventClick={vi.fn()}
      />
    );
    await userEvent.click(document.querySelector(`button[data-date="${YESTERDAY}"]`) as HTMLElement);
    const panel = screen.getByRole('complementary');
    const row = within(panel).getByRole('button', { name: /^Lisinopril/ });
    expect(row).toHaveAccessibleName('Lisinopril, Medication, Not marked');
    expect(within(row).queryByText(/7:15/)).not.toBeInTheDocument();
  });
});

describe('EventDetailModal', () => {
  const open = (event: CalendarEvent) =>
    render(<EventDetailModal event={event} careRecipientTimezone={TZ} onClose={vi.fn()} />);

  it('a past dose nobody answered has a Date row and no Time row', () => {
    open(dose());
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.queryByText('Time')).not.toBeInTheDocument();
    expect(screen.queryByText(/7:15/)).not.toBeInTheDocument();
  });

  it.each(['taken', 'skipped'] as const)('a past %s dose keeps its Time row', (status) => {
    open(dose(answered(status)));
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getAllByText(/7:00 AM/).length).toBeGreaterThan(0);
  });

  it("today's untaken dose keeps its Time row", () => {
    open(dose({ id: 'root-1_2026-06-13', scheduled_date: TODAY }));
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getAllByText(/7:15 AM/).length).toBeGreaterThan(0);
  });
});
