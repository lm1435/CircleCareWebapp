import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import {
  QuickAccess,
  QUICK_ACCESS_TILES,
  countRefillSoon,
  REFILL_SOON_DAYS,
  latestNote,
  medicationsStatus,
} from '../QuickAccess';
import { useTasks } from '@/hooks/useTasks';
import { useCareNotes } from '@/hooks/useCareNotes';
import { useCalendarEvents, useEventsPresence } from '@/hooks/useCalendarEvents';
import { getDateInTimezone } from '@/utils/timezone';
import { addDays } from '@/components/calendar/dateMath';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CareNote } from '@/api/careNotes';

vi.mock('@/hooks/useTasks', () => ({ useTasks: vi.fn() }));
vi.mock('@/hooks/useCareNotes', () => ({ useCareNotes: vi.fn() }));
vi.mock('@/hooks/useCalendarEvents', () => ({ useCalendarEvents: vi.fn(), useEventsPresence: vi.fn() }));

// Each press mirrors mobile's `quick_access_tapped` with the destination id.
const quickAccessTapped = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: { quickAccessTapped: (...args: unknown[]) => quickAccessTapped(...args) },
}));

const TZ = 'America/Denver';
const TODAY = getDateInTimezone(TZ);

function setOpenTasks(count: number | null): void {
  vi.mocked(useTasks).mockReturnValue({
    data:
      count === null ? undefined : { tasks: count > 0 ? [{ id: 't0' }] : [], total: count },
  } as unknown as ReturnType<typeof useTasks>);
}

function setNotes(notes: Partial<CareNote>[]): void {
  vi.mocked(useCareNotes).mockReturnValue({
    data: { notes, today: TODAY, timezone: TZ },
  } as unknown as ReturnType<typeof useCareNotes>);
}

function setEvents(events: Partial<CalendarEvent>[]): void {
  vi.mocked(useCalendarEvents).mockReturnValue({
    data: events,
    events,
  } as unknown as ReturnType<typeof useCalendarEvents>);
}

/** `medication`: true / false = the presence read answered; undefined = still loading or failed. */
function setMedPresence(medication: boolean | undefined): void {
  vi.mocked(useEventsPresence).mockReturnValue({
    data: medication === undefined ? undefined : { medication, appointment: false, task: false },
    isSuccess: medication !== undefined,
    isPending: medication === undefined,
    isError: false,
  } as unknown as ReturnType<typeof useEventsPresence>);
}

function renderQuickAccess(over: Partial<React.ComponentProps<typeof QuickAccess>> = {}): void {
  render(
    <MemoryRouter>
      <QuickAccess circleId="c1" timezone={TZ} showShiftsLink stacked={false} {...over} />
    </MemoryRouter>
  );
}

const tile = (name: string): HTMLElement => screen.getByRole('link', { name: new RegExp(`^${name}`) });

describe('QuickAccess (Today)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setOpenTasks(0);
    setNotes([]);
    setEvents([]);
    setMedPresence(false);
  });

  it('is a 2x3 card of Notes, Tasks, Calendar, Meds, Vitals, Emergency info in that order', () => {
    expect(QUICK_ACCESS_TILES.map((r) => r.id)).toEqual([
      'notes',
      'tasks',
      'calendar',
      'medications',
      'vitals',
      'careInfo',
    ]);
    renderQuickAccess();
    const grid = screen.getByTestId('quick-access-grid');
    expect(grid).toHaveAttribute('data-columns', '2');
    expect(within(grid).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/circles/c1/notes',
      '/circles/c1/tasks',
      '/circles/c1/calendar',
      '/circles/c1/meds',
      '/circles/c1/vitals',
      '/circles/c1/emergency',
    ]);
    // Six cells, each with its label first (Vitals and Emergency info are doors, not quiet links).
    expect(within(grid).getAllByRole('link').map((a) => a.firstElementChild?.textContent)).toEqual([
      'Notes',
      'Tasks',
      'Calendar',
      'Meds',
      'Vitals',
      'Emergency info',
    ]);
    expect(tile('Vitals')).toHaveTextContent('Blood pressure, weight');
    expect(tile('Emergency info')).toHaveTextContent('Doctors and contacts');
  });

  it('quiet links Shifts · Activity follow the card; Vitals and Emergency info are not among them', () => {
    renderQuickAccess();
    const all = screen.getAllByRole('link');
    expect(all.slice(6).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Shifts', '/circles/c1/calendar?mode=shifts'],
      ['Activity', '/circles/c1/activity'],
    ]);
    // N: the old name is gone everywhere.
    expect(screen.queryByText('Health info')).not.toBeInTheDocument();
  });

  it('drops the Shifts link where shifts do not exist for the viewer', () => {
    renderQuickAccess({ showShiftsLink: false });
    expect(screen.queryByRole('link', { name: 'Shifts' })).not.toBeInTheDocument();
    // The grid still has all six cells; only the quiet Shifts link goes.
    expect(screen.getByTestId('quick-access-grid').querySelectorAll('a')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Activity' })).toBeInTheDocument();
  });

  it('has no Daily update row, no icon tiles, no old "Health" / "Activity feed" labels', () => {
    renderQuickAccess();
    expect(screen.queryByText('Daily updates')).not.toBeInTheDocument();
    expect(screen.queryByText('Activity feed')).not.toBeInTheDocument();
    expect(screen.getByTestId('quick-access-grid').querySelector('svg')).toBeNull();
  });

  describe('live status lines', () => {
    it('empty state copy', () => {
      renderQuickAccess();
      expect(tile('Notes')).toHaveTextContent('How today went');
      expect(tile('Tasks')).toHaveTextContent('Shared to-dos');
      expect(tile('Calendar')).toHaveTextContent('Nothing yet');
      expect(tile('Meds')).toHaveTextContent('Nothing yet');
    });

    it('Tasks: "{n} open"', () => {
      setOpenTasks(2);
      renderQuickAccess();
      expect(tile('Tasks')).toHaveTextContent('2 open');
    });

    it('Tasks reads the backend total, not the capped array length', () => {
      setOpenTasks(7);
      renderQuickAccess();
      expect(tile('Tasks')).toHaveTextContent('7 open');
    });

    it('Notes: "{who} wrote {ago}" from the latest note', () => {
      setNotes([
        { id: 'n1', created_at: new Date(Date.now() - 5 * 3600_000).toISOString(), author: { id: 'a', first_name: 'Old', last_name: null } },
        { id: 'n2', created_at: new Date(Date.now() - 2 * 3600_000).toISOString(), author: { id: 'b', first_name: 'Ana', last_name: null } },
      ]);
      renderQuickAccess();
      expect(tile('Notes')).toHaveTextContent(/Ana wrote .*2 hr/);
      expect(tile('Notes')).not.toHaveTextContent('Old');
    });

    it('Notes without an author name says "Someone"', () => {
      setNotes([{ id: 'n1', created_at: new Date().toISOString(), author: null }]);
      renderQuickAccess();
      expect(tile('Notes')).toHaveTextContent(/Someone wrote/);
    });

    it('Calendar: "Next: Today" / "Next: Tomorrow" / weekday', () => {
      setEvents([{ id: 'e1', event_type: 'appointment', scheduled_date: addDays(TODAY, 1), scheduled_time: '10:00:00' }]);
      renderQuickAccess();
      expect(tile('Calendar')).toHaveTextContent('Next: Tomorrow');
    });

    it('Calendar: skips medications and finished appointments', () => {
      setEvents([
        { id: 'm', event_type: 'medication', scheduled_date: addDays(TODAY, 1), scheduled_time: '10:00:00' },
        { id: 'done', event_type: 'appointment', scheduled_date: addDays(TODAY, 2), scheduled_time: '10:00:00', completed_at: 'x' },
      ]);
      renderQuickAccess();
      expect(tile('Calendar')).toHaveTextContent('Nothing yet');
    });

    it('Meds: "{n} refill soon" counts distinct low-stock medications', () => {
      setEvents([
        { id: 'a', event_type: 'medication', scheduled_date: TODAY, track_refills: true, quantity_remaining: 6, pills_per_day: 2 },
        { id: 'a2', parent_event_id: 'a', event_type: 'medication', scheduled_date: addDays(TODAY, 1), track_refills: true, quantity_remaining: 6, pills_per_day: 2 },
        { id: 'b', event_type: 'medication', scheduled_date: TODAY, track_refills: true, quantity_remaining: 300, pills_per_day: 1 },
      ]);
      renderQuickAccess();
      expect(tile('Meds')).toHaveTextContent('1 refill soon');
    });
  });

  describe('Meds tile with a medication saved (1.4.2: web said "Nothing yet")', () => {
    it('POSITIVE: a saved medication with no refill due reads "Schedule and refills"', () => {
      // A medication exists in the circle (presence) but none is refill-tracked/low.
      setMedPresence(true);
      setEvents([{ id: 'm', event_type: 'medication', scheduled_date: TODAY, scheduled_time: '08:00:00' }]);
      renderQuickAccess();
      expect(tile('Meds')).toHaveTextContent('Schedule and refills');
      expect(tile('Meds')).not.toHaveTextContent('Nothing yet');
    });

    it('POSITIVE: a medication outside the 7-day window still counts (presence, not the window)', () => {
      setMedPresence(true);
      setEvents([]);
      renderQuickAccess();
      expect(tile('Meds')).toHaveTextContent('Schedule and refills');
    });

    it('NEGATIVE: "Nothing yet" only when presence ANSWERED no medication', () => {
      setMedPresence(false);
      renderQuickAccess();
      expect(tile('Meds')).toHaveTextContent('Nothing yet');
      expect(tile('Meds')).not.toHaveTextContent('Schedule and refills');
    });

    it('NEGATIVE: an unanswered presence read never says "Nothing yet"', () => {
      setMedPresence(undefined);
      renderQuickAccess();
      expect(tile('Meds')).not.toHaveTextContent('Nothing yet');
      expect(tile('Meds')).toHaveTextContent('Schedule and refills');
    });

    it('refills still win over the default line', () => {
      setMedPresence(true);
      setEvents([
        { id: 'a', event_type: 'medication', scheduled_date: TODAY, track_refills: true, quantity_remaining: 2, pills_per_day: 1 },
      ]);
      renderQuickAccess();
      expect(tile('Meds')).toHaveTextContent('1 refill soon');
    });

    it('reads presence over Home\'s window (today-30 .. today+180, shared cache key)', () => {
      renderQuickAccess();
      expect(useEventsPresence).toHaveBeenCalledWith('c1', addDays(TODAY, -30), addDays(TODAY, 180));
    });

    it('medicationsStatus mirrors mobile (todayQuickAccess.medicationsStatus) case for case', () => {
      const t = (k: string) => k;
      expect(medicationsStatus(true, 2, t)).toBe('quickAccess.medsRefill');
      expect(medicationsStatus(true, 0, t)).toBe('quickAccess.medsDefault');
      expect(medicationsStatus(false, 0, t)).toBe('quickAccess.medsEmpty');
      expect(medicationsStatus(undefined, 0, t)).toBe('quickAccess.medsDefault');
    });
  });

  it('countRefillSoon: the ONE shared definition (same cases as mobile countRefillsSoon)', () => {
    const base = { event_type: 'medication', scheduled_date: TODAY } as const;
    const bottle = (id: string, left: number, perDay: number, extra: object = {}) =>
      ({ ...base, id, track_refills: true, quantity_remaining: left, pills_per_day: perDay, ...extra }) as CalendarEvent;
    // Mirrors mobile/src/__tests__/utils/todayItems.test.ts 'countRefillsSoon'.
    expect(
      countRefillSoon([
        bottle('a', 28, 2), // exactly 14 days: counts
        bottle('b', 29, 2), // 14.5 days: does not
        bottle('c1', 4, 1, { refill_group_id: 'g' }), // two dose times, ONE bottle
        bottle('c2', 4, 1, { refill_group_id: 'g' }),
        bottle('d', 1, 1, { track_refills: false }), // not tracked
      ])
    ).toBe(2);
    expect(REFILL_SOON_DAYS).toBe(14);
  });

  it('countRefillSoon ignores discontinued, as-needed and untracked meds', () => {
    const base = { event_type: 'medication', scheduled_date: TODAY, track_refills: true } as const;
    expect(
      countRefillSoon([
        { ...base, id: '1', quantity_remaining: 1, pills_per_day: 1, discontinued_at: 'x' },
        { ...base, id: '2', quantity_remaining: 1, pills_per_day: 1, as_needed: true },
        { ...base, id: '3', track_refills: undefined },
        { ...base, id: '4', quantity_remaining: 1, pills_per_day: 0 },
        { ...base, id: '5', quantity_remaining: 13, pills_per_day: 1 },
        { ...base, id: '6', quantity_remaining: 14, pills_per_day: 1 },
      ] as CalendarEvent[])
    ).toBe(2);
  });

  it('latestNote picks the newest by created_at', () => {
    expect(latestNote([])).toBeNull();
    expect(
      latestNote([{ id: 'a', created_at: '2026-10-01' }, { id: 'b', created_at: '2026-10-02' }] as CareNote[])?.id
    ).toBe('b');
  });

  describe('large text', () => {
    it('is ONE column when stacked, with rows stacking', () => {
      renderQuickAccess({ stacked: true });
      const grid = screen.getByTestId('quick-access-grid');
      expect(grid).toHaveAttribute('data-columns', '1');
      expect(grid.firstElementChild).toHaveClass('grid-cols-1');
      expect(grid.firstElementChild).not.toHaveClass('grid-cols-2');
    });

    it('is two columns otherwise', () => {
      renderQuickAccess();
      expect(screen.getByTestId('quick-access-grid').firstElementChild).toHaveClass('grid-cols-2');
    });
  });

  describe('analytics', () => {
    it.each([
      ['Notes', 'notes'],
      ['Tasks', 'tasks'],
      ['Calendar', 'calendar'],
      ['Meds', 'medications'],
      ['Shifts', 'shifts'],
      ['Vitals', 'vitals'],
      ['Emergency info', 'careInfo'],
      ['Activity', 'activityFeed'],
    ])('pressing %s fires quick_access_tapped(%s)', async (name, id) => {
      const user = userEvent.setup();
      renderQuickAccess();
      await user.click(screen.getByRole('link', { name: new RegExp(`^${name}`) }));
      expect(quickAccessTapped).toHaveBeenCalledWith(id);
      expect(quickAccessTapped).toHaveBeenCalledTimes(1);
    });
  });
});
