import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { MonthView } from '../MonthView';

// Mobile's month (and day) list card marks an event that has notes with the
// document icon, and shows no assignee. The web day panel row prints the same
// badge (icon + count) and adds "N notes" to the row's accessible name.

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const DAY = '2026-03-16';

function gridDays(): string[] {
  const out: string[] = [];
  const start = Date.UTC(2026, 2, 1); // Sun 2026-03-01
  for (let i = 0; i < 42; i++) out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

function appt(id: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    circle_id: 'circle-1',
    event_type: 'appointment',
    title: `Appt ${id}`,
    scheduled_date: DAY,
    scheduled_time: '10:00',
    duration_minutes: 60,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    assigned_to_user: { id: 'u1', email: 'ana@example.com', first_name: 'Ana', last_name: 'López' },
    note_count: 2,
    ...overrides,
  };
}

async function openDay(events: CalendarEvent[]) {
  render(
    <MonthView
      gridDays={gridDays()}
      monthStart="2026-03-01"
      eventsByDay={new Map([[DAY, events]])}
      careRecipientTimezone="America/Chicago"
      todayStr="2026-03-17"
      onEventClick={vi.fn()}
    />
  );
  const dayButton = document.querySelector(`button[data-date="${DAY}"]`) as HTMLButtonElement;
  await userEvent.click(dayButton);
  return screen.getByRole('complementary');
}

beforeEach(async () => {
  mockUseHourCycle.mockReturnValue('12h');
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('MonthView day panel: note badge', () => {
  it('prints the count and appends "N notes" to the row name', async () => {
    const panel = await openDay([appt('a')]);
    const row = within(panel).getByRole('button', { name: /^Appt a,/ });
    expect(within(row).getByTestId('event-chip-notes')).toHaveTextContent(/^2$/);
    expect(row.getAttribute('aria-label')).toMatch(/, 2 notes$/);
  });

  it('shows no assignee (mobile month list shows none)', async () => {
    const panel = await openDay([appt('a')]);
    const row = within(panel).getByRole('button', { name: /^Appt a,/ });
    expect(row).not.toHaveTextContent('Ana López');
    expect(row.getAttribute('aria-label')).not.toContain('Ana López');
  });

  it('no notes: no badge, nothing appended', async () => {
    const panel = await openDay([appt('a', { note_count: 0 })]);
    const row = within(panel).getByRole('button', { name: /^Appt a,/ });
    expect(within(row).queryByTestId('event-chip-notes')).toBeNull();
    expect(row.getAttribute('aria-label')).not.toMatch(/note/);
  });

  it('Spanish: "1 nota" / "2 notas"', async () => {
    await i18n.changeLanguage('es');
    const panel = await openDay([appt('a', { note_count: 1 }), appt('b', { scheduled_time: '12:00' })]);
    expect(within(panel).getByRole('button', { name: /^Appt a,/ }).getAttribute('aria-label')).toMatch(/, 1 nota$/);
    expect(within(panel).getByRole('button', { name: /^Appt b,/ }).getAttribute('aria-label')).toMatch(/, 2 notas$/);
  });

  it('below lg the layout track is minmax(0,1fr), so a long title cannot widen the panel past the page', async () => {
    const panel = await openDay([appt('a')]);
    expect((panel.parentElement as HTMLElement).className).toContain('grid-cols-[minmax(0,1fr)]');
  });
});
