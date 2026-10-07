// As-needed (PRN) doses on the calendar: NOT events, only a quiet marker on the
// days a dose was LOGGED plus a compact row per medication ("As needed · N doses
// logged") that opens that medication's dose history. Days are the RECIPIENT's.

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { AsNeededDoseWithEvent } from '@/api/medicationAsNeeded';
import { groupDosesByDay, type AsNeededDayEntry } from '../asNeededByDay';
import { MonthView } from '../MonthView';
import { WeekView } from '../WeekView';

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const AUCKLAND = 'Pacific/Auckland';

function dose(
  id: string,
  given_at: string,
  over: Partial<AsNeededDoseWithEvent> = {},
  med = { id: 'prn-1', name: 'Ibuprofen' }
): AsNeededDoseWithEvent {
  return {
    id,
    event_id: med.id,
    circle_id: 'c1',
    given_at,
    given_by: 'u1',
    note: null,
    client_request_id: `req-${id}`,
    created_at: given_at,
    removed_at: null,
    removed_by: null,
    event: { id: med.id, title: med.name, medication_name: med.name, medication_dosage: null },
    ...over,
  };
}

describe('groupDosesByDay', () => {
  it('counts per medication per RECIPIENT-zone day: 00:30 Auckland on the 7th is the 7th, not the 6th (UTC) or Denver\'s 6th', () => {
    const map = groupDosesByDay(
      [
        dose('a', '2026-09-06T12:30:00Z'), // 00:30 NZST Sept 7
        dose('b', '2026-09-06T20:00:00Z'), // 08:00 NZST Sept 7
        dose('c', '2026-09-06T03:00:00Z'), // 15:00 NZST Sept 6
      ],
      AUCKLAND
    );
    expect([...map.keys()].sort()).toEqual(['2026-09-06', '2026-09-07']);
    expect(map.get('2026-09-07')).toEqual([{ eventId: 'prn-1', name: 'Ibuprofen', count: 2 }]);
    expect(map.get('2026-09-06')).toEqual([{ eventId: 'prn-1', name: 'Ibuprofen', count: 1 }]);
  });

  it('excludes REMOVED doses from the count (and a day with only removed doses has no entry)', () => {
    const map = groupDosesByDay(
      [
        dose('a', '2026-09-06T03:00:00Z'),
        dose('b', '2026-09-06T04:00:00Z', { removed_at: '2026-09-06T05:00:00Z' }),
        dose('c', '2026-09-08T03:00:00Z', { removed_at: '2026-09-08T05:00:00Z' }),
      ],
      AUCKLAND
    );
    expect(map.get('2026-09-06')).toEqual([{ eventId: 'prn-1', name: 'Ibuprofen', count: 1 }]);
    expect(map.has('2026-09-08')).toBe(false);
  });

  it('keeps medications apart on the same day', () => {
    const map = groupDosesByDay(
      [
        dose('a', '2026-09-06T03:00:00Z'),
        dose('b', '2026-09-06T04:00:00Z', {}, { id: 'prn-2', name: 'Tylenol' }),
      ],
      AUCKLAND
    );
    expect(map.get('2026-09-06')?.map((e) => e.name)).toEqual(['Ibuprofen', 'Tylenol']);
  });
});

const DAY = '2026-09-06';
function gridDays(): string[] {
  const out: string[] = [];
  const start = Date.UTC(2026, 7, 30); // Sun 2026-08-30
  for (let i = 0; i < 42; i++) out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}
const ENTRY: AsNeededDayEntry = { eventId: 'prn-1', name: 'Ibuprofen', count: 2 };

function renderMonth(
  byDay: Map<string, AsNeededDayEntry[]> | undefined,
  onOpen: (e: AsNeededDayEntry) => void = vi.fn()
) {
  render(
    <MonthView
      gridDays={gridDays()}
      monthStart="2026-09-01"
      eventsByDay={new Map()}
      careRecipientTimezone={AUCKLAND}
      todayStr="2026-09-10"
      onEventClick={vi.fn()}
      asNeededByDay={byDay}
      onAsNeededOpen={onOpen}
    />
  );
}
const cell = (day: string) => document.querySelector(`button[data-date="${day}"]`) as HTMLButtonElement;

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('MonthView: the as-needed marker and day row', () => {
  it('a day with logged doses gets the hollow ring and the cell label says so; other days do not', () => {
    renderMonth(new Map([[DAY, [ENTRY]]]));
    expect(within(cell(DAY)).getByTestId('as-needed-marker')).toBeInTheDocument();
    expect(cell(DAY).getAttribute('aria-label')).toContain('as-needed dose given');
    expect(within(cell('2026-09-07')).queryByTestId('as-needed-marker')).toBeNull();
    expect(cell('2026-09-07').getAttribute('aria-label')).not.toContain('as-needed');
  });

  it('no data (the read failed or has not answered): no marker anywhere, the calendar still renders', () => {
    renderMonth(undefined);
    expect(screen.queryByTestId('as-needed-marker')).toBeNull();
    expect(cell(DAY)).toBeInTheDocument();
  });

  it('the selected-day panel lists the medication and opens THAT medication\'s history', async () => {
    const onOpen = vi.fn();
    renderMonth(
      new Map([[DAY, [ENTRY, { eventId: 'prn-2', name: 'Tylenol', count: 1 }]]]),
      onOpen
    );
    await userEvent.click(cell(DAY));
    const panel = screen.getByRole('complementary');
    expect(within(panel).queryByText('Nothing scheduled for this day')).toBeNull();
    const rows = within(panel).getAllByTestId('as-needed-day-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Ibuprofen')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Given as needed')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Given as needed')).toBeInTheDocument();
    expect(rows[0].getAttribute('aria-label')).toContain('Open dose history');
    await userEvent.click(rows[1]);
    expect(onOpen).toHaveBeenCalledWith({ eventId: 'prn-2', name: 'Tylenol', count: 1 });
  });

  it('no limits, no counts: the row text and cell label carry no digit (falsifier)', async () => {
    renderMonth(new Map([[DAY, [ENTRY]]]));
    await userEvent.click(cell(DAY));
    const text = within(screen.getByRole('complementary')).getByTestId('as-needed-day-row').textContent;
    expect(text).toBe('IbuprofenGiven as needed');
    expect(text).not.toMatch(/\d/);
    expect(cell(DAY).getAttribute('aria-label')).not.toMatch(/\b\d+ dos/);
  });

  it('Spanish', async () => {
    await i18n.changeLanguage('es');
    renderMonth(new Map([[DAY, [ENTRY]]]));
    expect(cell(DAY).getAttribute('aria-label')).toContain('dosis dada según se necesite');
    await userEvent.click(cell(DAY));
    const row = screen.getByTestId('as-needed-day-row');
    expect(within(row).getByText('Dada según se necesite')).toBeInTheDocument();
    expect(row.getAttribute('aria-label')).toContain('Abrir historial de dosis');
  });
});

describe('WeekView: the as-needed row', () => {
  it('shows a row per medication in the day column (all-day row) and opens the history', async () => {
    const onOpen = vi.fn();
    render(
      <WeekView
        days={['2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']}
        eventsByDay={new Map()}
        careRecipientTimezone={AUCKLAND}
        todayStr="2026-09-10"
        onEventClick={vi.fn()}
        asNeededByDay={new Map([[DAY, [ENTRY]]])}
        onAsNeededOpen={onOpen}
      />
    );
    const row = screen.getByTestId('as-needed-day-row');
    expect(within(row).getByText('Given as needed')).toBeInTheDocument();
    await userEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith(ENTRY);
    expect(screen.getAllByTestId('as-needed-marker')).toHaveLength(1);
  });
});
