import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { DayView } from '../DayView';
import { WeekView } from '../WeekView';
import { MonthView } from '../MonthView';

// Owner 2026-11-12: a calendar dose row never says "Pending". A dose that is
// not due yet (or not answered yet) reads as the plain row; only a status that
// tells the reader something (Taken, Skipped, Not marked) is printed or spoken.
// Mobile's calendar rows never printed "Pending" either (it only labels invites).

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const TZ = 'America/Chicago';
const DAY = '2026-03-16';
// 14:00Z = 09:00 in Chicago on DAY: the 20:00 dose is still ahead (pending).
const NOW = new Date(`${DAY}T14:00:00Z`);

function med(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    circle_id: 'circle-1',
    event_type: 'medication',
    title: id,
    medication_name: id,
    scheduled_date: DAY,
    scheduled_time: '20:00:00',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    confirmation: null,
    ...overrides,
  };
}

const upcoming = med('Ibuprofen');
const taken = med('Zyrtec', {
  scheduled_time: '07:15:00',
  confirmation: {
    status: 'taken',
    confirmed_at: `${DAY}T12:20:00Z`,
  } as unknown as CalendarEvent['confirmation'],
});

function gridDays(): string[] {
  const out: string[] = [];
  const start = Date.UTC(2026, 2, 1); // Sun 2026-03-01
  for (let i = 0; i < 42; i++) out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

beforeEach(async () => {
  mockUseHourCycle.mockReturnValue('12h');
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('calendar dose rows never say "Pending"', () => {
  it('DayView: an upcoming dose prints and speaks no status; a taken dose still says Taken', () => {
    render(
      <DayView
        date={DAY}
        events={[upcoming, taken]}
        asNeeded={[]}
        timezone={TZ}
        onEventClick={vi.fn()}
        onPrev={vi.fn()}
        onNext={vi.fn()}
        onToday={vi.fn()}
      />
    );
    const rows = screen.getAllByTestId('day-event');
    const upcomingRow = rows.find((r) => r.textContent?.includes('Ibuprofen')) as HTMLElement;
    const takenRow = rows.find((r) => r.textContent?.includes('Zyrtec')) as HTMLElement;
    expect(upcomingRow).toHaveAttribute('data-med-status', 'pending');
    expect(upcomingRow).not.toHaveTextContent(/Pending/);
    expect(upcomingRow.getAttribute('aria-label')).not.toMatch(/Pending/);
    expect(upcomingRow.getAttribute('aria-label')).toMatch(/^Ibuprofen, Medication, 8:00 PM( \(Chicago\))?$/);
    expect(takenRow).toHaveTextContent('Taken');
    expect(takenRow.getAttribute('aria-label')).toMatch(/, Taken/);
  });

  it('WeekView: an upcoming dose chip speaks no status', () => {
    render(
      <WeekView
        days={['2026-03-15', DAY, '2026-03-17', '2026-03-18', '2026-03-19', '2026-03-20', '2026-03-21']}
        eventsByDay={new Map([[DAY, [upcoming, taken]]])}
        careRecipientTimezone={TZ}
        todayStr={DAY}
        onEventClick={vi.fn()}
      />
    );
    const chip = screen.getByRole('button', { name: /^Ibuprofen,/ });
    expect(chip.getAttribute('aria-label')).not.toMatch(/Pending/);
    expect(screen.getByRole('button', { name: /^Zyrtec,/ }).getAttribute('aria-label')).toMatch(
      /, Taken/
    );
    expect(document.body).not.toHaveTextContent(/Pending/);
  });

  it('MonthView day panel: an upcoming dose row speaks no status', async () => {
    render(
      <MonthView
        gridDays={gridDays()}
        monthStart="2026-03-01"
        eventsByDay={new Map([[DAY, [upcoming, taken]]])}
        careRecipientTimezone={TZ}
        todayStr={DAY}
        onEventClick={vi.fn()}
      />
    );
    const dayButton = document.querySelector(`button[data-date="${DAY}"]`) as HTMLButtonElement;
    await userEvent.setup({ advanceTimers: () => {} }).click(dayButton);
    const panel = screen.getByRole('complementary');
    const row = within(panel).getByRole('button', { name: /^Ibuprofen,/ });
    expect(row.getAttribute('aria-label')).not.toMatch(/Pending/);
    expect(within(panel).getByRole('button', { name: /^Zyrtec,/ }).getAttribute('aria-label')).toMatch(
      /, Taken/
    );
    expect(panel).not.toHaveTextContent(/Pending/);
  });
});
