import { render, screen, within } from '@testing-library/react';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { WeekView } from '../WeekView';

// Mobile TimelineEventBlock parity: the week chip prints the assignee and a
// note-count badge, and both join the chip's accessible name. Visible only on
// a TIMED chip with a free third line (45+ minutes) in a 1- or 2-lane slot;
// spoken always. Geometry (does it fit, is anything clipped) is NOT provable
// here — jsdom has no layout — see e2e/flows/calendar-chip-meta.spec.ts.

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const DAYS = [
  '2026-03-15',
  '2026-03-16',
  '2026-03-17',
  '2026-03-18',
  '2026-03-19',
  '2026-03-20',
  '2026-03-21',
];
const DAY = '2026-03-16';

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
    note_count: 3,
    ...overrides,
  };
}

function renderWeek(events: CalendarEvent[]) {
  return render(
    <WeekView
      days={DAYS}
      eventsByDay={new Map([[DAY, events]])}
      careRecipientTimezone="America/Chicago"
      todayStr="2026-03-17"
      onEventClick={vi.fn()}
    />
  );
}

function chipFor(title: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${title},`) });
}

beforeEach(async () => {
  mockUseHourCycle.mockReturnValue('12h');
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('WeekView chip: assignee + note count', () => {
  it('prints the assignee and the note badge on a 60-minute single-lane chip', () => {
    renderWeek([appt('a')]);
    const chip = chipFor('Appt a');
    expect(within(chip).getByTestId('event-chip-assignee')).toHaveTextContent('Ana López');
    expect(within(chip).getByTestId('event-chip-notes')).toHaveTextContent(/^3$/);
  });

  it('appends the assignee and "N notes" to the accessible name, in mobile order', () => {
    renderWeek([appt('a')]);
    expect(chipFor('Appt a').getAttribute('aria-label')).toMatch(/^Appt a, Appointment, .+, Ana López, 3 notes$/);
  });

  it('uses the singular for one note', () => {
    renderWeek([appt('a', { note_count: 1 })]);
    expect(chipFor('Appt a').getAttribute('aria-label')).toMatch(/, Ana López, 1 note$/);
    expect(within(chipFor('Appt a')).getByTestId('event-chip-notes')).toHaveTextContent(/^1$/);
  });

  it('falls back to the email when the assignee has no name (mobile rule)', () => {
    renderWeek([
      appt('a', {
        assigned_to_user: { id: 'u1', email: 'ana@example.com', first_name: null, last_name: null },
      }),
    ]);
    expect(within(chipFor('Appt a')).getByTestId('event-chip-assignee')).toHaveTextContent('ana@example.com');
    expect(chipFor('Appt a').getAttribute('aria-label')).toMatch(/, ana@example\.com, 3 notes$/);
  });

  it('a departed assignee (name-only backfill, no email) still prints the name', () => {
    renderWeek([
      appt('a', { assigned_to_user: { id: 'u1', first_name: 'Rosa', last_name: null } }),
    ]);
    expect(within(chipFor('Appt a')).getByTestId('event-chip-assignee')).toHaveTextContent(/^Rosa$/);
  });

  it('no assignee and no notes: no meta line and nothing appended', () => {
    renderWeek([appt('a', { assigned_to_user: null, note_count: 0 })]);
    const chip = chipFor('Appt a');
    expect(within(chip).queryByTestId('event-chip-meta')).toBeNull();
    expect(chip.getAttribute('aria-label')).not.toMatch(/note/);
  });

  it('notes only: badge without a name', () => {
    renderWeek([appt('a', { assigned_to_user: null, note_count: 2 })]);
    const chip = chipFor('Appt a');
    expect(within(chip).queryByTestId('event-chip-assignee')).toBeNull();
    expect(within(chip).getByTestId('event-chip-notes')).toHaveTextContent(/^2$/);
    expect(chip.getAttribute('aria-label')).toMatch(/, 2 notes$/);
  });

  it('a 30-minute chip has no room for a third line: meta is spoken, not printed', () => {
    renderWeek([appt('a', { duration_minutes: 30 })]);
    const chip = chipFor('Appt a');
    expect(within(chip).queryByTestId('event-chip-meta')).toBeNull();
    expect(chip.getAttribute('aria-label')).toMatch(/, Ana López, 3 notes$/);
  });

  it('a 45-minute chip has a third line and prints it', () => {
    renderWeek([appt('a', { duration_minutes: 45 })]);
    expect(within(chipFor('Appt a')).getByTestId('event-chip-meta')).toBeInTheDocument();
  });

  it('2 lanes still print the meta line', () => {
    renderWeek([appt('a'), appt('b', { assigned_to_user: null, note_count: 0 })]);
    expect(within(chipFor('Appt a')).getByTestId('event-chip-meta')).toBeInTheDocument();
  });

  it('3 lanes drop the meta line (same rule as the time) but keep it in the name', () => {
    renderWeek([appt('a'), appt('b'), appt('c')]);
    for (const id of ['a', 'b', 'c']) {
      const chip = chipFor(`Appt ${id}`);
      expect(within(chip).queryByTestId('event-chip-meta')).toBeNull();
      expect(chip.getAttribute('aria-label')).toMatch(/, Ana López, 3 notes$/);
    }
  });

  it('all-day chips stay title-only like mobile, but speak the assignee and count', () => {
    renderWeek([appt('a', { event_type: 'task', scheduled_time: null })]);
    const chip = chipFor('Appt a');
    expect(within(chip).queryByTestId('event-chip-meta')).toBeNull();
    expect(chip.getAttribute('aria-label')).toMatch(/, Ana López, 3 notes$/);
  });

  it('the long name truncates and the badge never shrinks (class contract; geometry is e2e)', () => {
    renderWeek([appt('a')]);
    const chip = chipFor('Appt a');
    expect(within(chip).getByTestId('event-chip-assignee').className).toMatch(/\bmin-w-0\b.*\btruncate\b/);
    expect(within(chip).getByTestId('event-chip-notes').className).toMatch(/\bshrink-0\b/);
  });

  it('meta text uses the chip text colour (cream on a pending block)', () => {
    renderWeek([appt('a')]);
    const chip = chipFor('Appt a');
    expect(within(chip).getByTestId('event-chip-assignee').className).toContain('text-cream');
    expect(within(chip).getByTestId('event-chip-notes').className).toContain('text-cream');
  });

  it('Spanish: "notas" / "nota" in the accessible name', async () => {
    await i18n.changeLanguage('es');
    renderWeek([appt('a'), appt('b', { scheduled_time: '14:00', note_count: 1 })]);
    expect(chipFor('Appt a').getAttribute('aria-label')).toMatch(/, Ana López, 3 notas$/);
    expect(chipFor('Appt b').getAttribute('aria-label')).toMatch(/, Ana López, 1 nota$/);
  });
});
