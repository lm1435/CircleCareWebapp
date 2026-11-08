import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { ShiftCard } from '../ShiftCard';

// The fixtures are dated Oct 2026: pin the wall clock (Date only) BEFORE them, or every open fixture
// shift has ENDED on the real clock and (correctly) loses Take / Drop / Assign. Ended shifts have their own cases.
const PINNED_NOW = new Date('2026-10-17T12:00:00Z');
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: PINNED_NOW });
});
afterAll(() => {
  vi.useRealTimers();
});

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

// The viewer shares the recipient's zone here, so no dual time is shown.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const TZ = 'America/Chicago';

const members = [
  { id: 'u-ana', first_name: 'Ana', last_name: 'R', email: 'ana@x.test' },
  { id: 'u-me', first_name: 'Pat', last_name: 'L', email: 'pat@x.test' },
] as unknown as CircleMember[];

function shift(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 's1',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Night',
    scheduled_date: '2026-10-19',
    scheduled_time: '20:00:00',
    duration_minutes: 720,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function renderCard(s: CalendarEvent, extra: Partial<React.ComponentProps<typeof ShiftCard>> = {}) {
  const onOpen = vi.fn();
  const onTake = vi.fn();
  render(
    <ul>
      <ShiftCard
        shift={s}
        timezone={TZ}
        members={members}
        viewerId="u-me"
        onOpen={onOpen}
        onTake={onTake}
        {...extra}
      />
    </ul>
  );
  return { onOpen, onTake };
}

describe('ShiftCard', () => {
  it('OPEN: the same white card, the range alone, "Open" in moss on the status line, an OUTLINE Take sm, a name that says open', async () => {
    const user = userEvent.setup();
    const { onOpen, onTake } = renderCard(shift());
    const card = screen.getByTestId('shift-card');
    expect(card).toHaveAttribute('data-shift-state', 'open');
    expect(card).toHaveClass('border', 'border-line!', 'bg-cream');
    expect(card.className).not.toMatch(/amber|dashed/);
    // No avatar ring any more (approved mock 2026-11-08); the range is its own line, "(next day)" inline.
    expect(screen.queryByTestId('shift-open-ring')).not.toBeInTheDocument();
    expect(within(card).getByTestId('shift-card-range')).toHaveTextContent(/^8:00 PM – 8:00 AM \(next day\)$/);
    // Conveyed by text ("Open" on the meta line, in moss), not by colour or edge style.
    const word = within(card).getByTestId('shift-open-word');
    expect(word).toHaveTextContent('Open');
    expect(word).toHaveClass('text-moss', 'font-semibold');
    expect(within(card).getByTestId('shift-card-status')).toHaveTextContent(/^Open$/);
    expect(within(card).getAllByText('Open')).toHaveLength(1);
    const body = screen.getByRole('button', { name: 'Night, 8:00 PM to 8:00 AM, next day, open' });
    // The action sits in the description, never in the label.
    expect(body).toHaveAccessibleDescription('Opens the shift details');
    expect(body.getAttribute('aria-label')).not.toMatch(/double tap/i);
    await user.click(body);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    const take = screen.getByRole('button', { name: 'Take Night' });
    // Outline, never filled: Add shift is the list's one filled button. Button sm = the standard rounded-md.
    expect(take).toHaveClass('border-primary-outline', 'rounded-md');
    expect(take.className).not.toContain('bg-primary-fill');
    await user.click(take);
    expect(onTake).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it("FILLED by someone else: cream card with a moss hairline (the wash means YOURS, as on mobile), the assignee name, no Take", () => {
    renderCard(shift({ assigned_to: 'u-ana' }));
    const card = screen.getByTestId('shift-card');
    expect(card).toHaveAttribute('data-shift-state', 'filled');
    expect(card).toHaveClass('bg-cream', 'border-moss-line');
    expect(card).not.toHaveClass('bg-moss-soft');
    expect(card).not.toHaveClass('border-dashed');
    expect(within(card).getByTestId('shift-card-range')).toHaveTextContent(/^8:00 PM – 8:00 AM \(next day\)$/);
    expect(within(card).getByTestId('shift-card-assignee')).toHaveTextContent('Ana');
    // The name truncates (never the title).
    expect(within(card).getByTestId('shift-card-assignee')).toHaveClass('truncate', 'min-w-0');
    expect(within(card).getByTestId('shift-card-title').className).not.toContain('truncate');
    expect(
      screen.getByRole('button', { name: 'Night, 8:00 PM to 8:00 AM, next day, Ana is on it' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Take/ })).not.toBeInTheDocument();
  });

  it('the viewer reads "You" on a moss-washed card', () => {
    renderCard(shift({ assigned_to: 'u-me' }));
    const card = screen.getByTestId('shift-card');
    expect(card).toHaveClass('bg-moss-soft', 'border-moss');
    expect(within(card).getByTestId('shift-card-assignee')).toHaveTextContent(/^You$/);
    expect(screen.getByRole('button', { name: 'Night, 8:00 PM to 8:00 AM, next day, you are on this shift' })).toBeInTheDocument();
  });

  it('a same-day shift has no "next day" in the label', () => {
    renderCard(shift({ scheduled_time: '08:00:00', duration_minutes: 360 }));
    expect(
      screen.getByRole('button', { name: 'Night, 8:00 AM to 2:00 PM, open' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/next day/)).not.toBeInTheDocument();
  });

  it('an open card has no Take without edit rights (no onTake)', () => {
    renderCard(shift(), { onTake: undefined });
    expect(screen.queryByRole('button', { name: /^Take/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
  });
});

// Owner report (TestFlight 1.4.0 build 9): Week showed Sunday's ended "Evening 2:00 PM – 8:00 PM · Open"
// with Take. An unfilled shift whose END (recipient zone) has passed reads "Not covered" and offers no Take;
// one in progress still offers it. The recipient is in Tokyo: Sun 14:00-20:00 Tokyo ends at 11:00Z.
describe('ShiftCard: ended shifts', () => {
  const sunday = (over: Partial<CalendarEvent> = {}) =>
    shift({ scheduled_date: '2026-11-01', scheduled_time: '14:00:00', duration_minutes: 360, ...over });
  afterEach(() => {
    vi.setSystemTime(PINNED_NOW);
  });

  it('ended + unfilled: "Not covered" (not moss), no Take, the accessible name says not covered', () => {
    vi.setSystemTime(new Date('2026-11-01T11:00:00Z'));
    renderCard(sunday(), { timezone: 'Asia/Tokyo' });
    const word = screen.getByTestId('shift-open-word');
    expect(word).toHaveTextContent('Not covered');
    expect(word).not.toHaveClass('text-moss');
    expect(screen.queryByText('Open')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Take/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /, not covered$/ })).toBeInTheDocument();
  });

  it('in progress (one minute before the end): still Open with Take', async () => {
    vi.setSystemTime(new Date('2026-11-01T10:59:00Z'));
    const { onTake } = renderCard(sunday(), { timezone: 'Asia/Tokyo' });
    expect(screen.getByTestId('shift-open-word')).toHaveTextContent('Open');
    screen.getByRole('button', { name: /^Take/ }).click();
    expect(onTake).toHaveBeenCalled();
  });

  it('the recipient zone decides: the same instant with a Chicago recipient is still takeable', () => {
    vi.setSystemTime(new Date('2026-11-01T11:00:00Z'));
    renderCard(sunday(), { timezone: 'America/Chicago' });
    expect(screen.getByRole('button', { name: /^Take/ })).toBeInTheDocument();
  });

  it('an overnight shift that ended this morning (Sat 8 PM - Sun 8 AM Tokyo = 23:00Z Sat): no Take', () => {
    vi.setSystemTime(new Date('2026-10-31T23:00:00Z'));
    renderCard(shift({ scheduled_date: '2026-10-31' }), { timezone: 'Asia/Tokyo' });
    expect(screen.queryByRole('button', { name: /^Take/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('shift-open-word')).toHaveTextContent('Not covered');
  });
});

describe('ShiftCard task count on the status line (docs/plans/shift-tasks.md)', () => {
  const DAY = '2026-10-19';
  const onShift = shift({ assigned_to: 'u-ana', parent_event_id: 'root' });
  const link = {
    root_id: 'root',
    date: DAY,
    title: 'Night',
    assignee: { id: 'u-ana', first_name: 'Ana' },
    status: 'covered' as const,
    window_start: `${DAY}T20:00:00`,
    window_end: `${DAY}T23:59:00`,
  };
  const task = (id: string, over: Partial<CalendarEvent>): CalendarEvent =>
    ({
      id,
      circle_id: 'c',
      event_type: 'task',
      title: id,
      scheduled_date: DAY,
      scheduled_time: '21:00:00',
      assigned_to: null,
      created_at: '',
      updated_at: '',
      ...over,
    }) as CalendarEvent;

  it('reads "Ana · 1 of 3 done" on one status line: linked tasks plus the person\'s overlapping regular task, never others\'', () => {
    renderCard(onShift, {
      events: [
        task('linked-a', { shift: link }),
        task('linked-b', { shift: link, completed_at: '2026-10-19T21:30:00Z' }),
        task('regular-ana', { assigned_to: 'u-ana', scheduled_time: '22:00:00' }),
        task('regular-other', { assigned_to: 'u-me', scheduled_time: '22:00:00' }),
        task('regular-anyone', { scheduled_time: '22:30:00' }),
      ],
    });
    expect(screen.getByTestId('shift-card-task-count')).toHaveTextContent('· 1 of 3 done');
    // The avatar's initial is aria-hidden; the visible line reads "Ana · 1 of 3 done".
    expect(screen.getByTestId('shift-card-status')).toHaveTextContent(/^AAna· 1 of 3 done$/);
  });

  it('one task: "0 of 1 done"', () => {
    renderCard(onShift, { events: [task('linked-a', { shift: link })] });
    expect(screen.getByTestId('shift-card-task-count')).toHaveTextContent('· 0 of 1 done');
  });

  it('is hidden at 0 and while the events have not loaded', () => {
    renderCard(onShift, { events: [task('regular-other', { assigned_to: 'u-me' })] });
    expect(screen.queryByTestId('shift-card-task-count')).not.toBeInTheDocument();
  });

  it('is part of the card\'s accessible name', () => {
    renderCard(onShift, { events: [task('linked-a', { shift: link })] });
    expect(screen.getByRole('button', { name: /, 0 of 1 done/ })).toBeInTheDocument();
  });
});
