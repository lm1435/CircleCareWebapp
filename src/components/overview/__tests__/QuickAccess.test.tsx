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
} from '../QuickAccess';
import { useTasks } from '@/hooks/useTasks';
import { useCareNotes } from '@/hooks/useCareNotes';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { getDateInTimezone } from '@/utils/timezone';
import { addDays } from '@/components/calendar/dateMath';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CareNote } from '@/api/careNotes';

vi.mock('@/hooks/useTasks', () => ({ useTasks: vi.fn() }));
vi.mock('@/hooks/useCareNotes', () => ({ useCareNotes: vi.fn() }));
vi.mock('@/hooks/useCalendarEvents', () => ({ useCalendarEvents: vi.fn() }));

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
  });

  it('is a 2x2 card of Notes, Tasks, Calendar, Meds in that order', () => {
    expect(QUICK_ACCESS_TILES.map((r) => r.id)).toEqual(['notes', 'tasks', 'calendar', 'medications']);
    renderQuickAccess();
    const grid = screen.getByTestId('quick-access-grid');
    expect(grid).toHaveAttribute('data-columns', '2');
    expect(within(grid).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/circles/c1/notes',
      '/circles/c1/tasks',
      '/circles/c1/calendar',
      '/circles/c1/meds',
    ]);
  });

  it('quiet links Shifts · Vitals · Health info · Activity follow the card', () => {
    renderQuickAccess();
    const all = screen.getAllByRole('link');
    expect(all.slice(4).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Shifts', '/circles/c1/calendar?mode=shifts'],
      ['Vitals', '/circles/c1/vitals'],
      ['Health info', '/circles/c1/emergency'],
      ['Activity', '/circles/c1/activity'],
    ]);
  });

  it('drops the Shifts link where shifts do not exist for the viewer', () => {
    renderQuickAccess({ showShiftsLink: false });
    expect(screen.queryByRole('link', { name: 'Shifts' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vitals' })).toBeInTheDocument();
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
      ['Health info', 'careInfo'],
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
