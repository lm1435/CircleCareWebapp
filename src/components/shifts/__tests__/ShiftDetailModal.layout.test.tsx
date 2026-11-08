import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui';
import '@/i18n';
import { getSeriesRoot, type CalendarEvent } from '@/api/calendarEvents';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { getDeviceTimezone } from '@/utils/timezone';
import { ShiftDetailModal } from '../ShiftDetailModal';

// The approved "middle" layout (owner 2026-11-08), the mirror of mobile's ShiftDetailScreen tests:
// title + status chip on one WRAPPING row, ONE details card (When full width, Repeats + Reminder side by
// side), the list right under it, and ONE filled button per screen.

vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  getSeriesRoot: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
const listProps = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
// The list has its own tests (ShiftTaskList.test.tsx); here only what the detail hands it.
vi.mock('../ShiftTaskList', () => ({
  ShiftTaskList: (props: Record<string, unknown>) => {
    listProps.value = props;
    return null;
  },
}));

const RECIPIENT_TZ = 'America/Chicago';

function shift(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'root',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Night',
    scheduled_date: '2026-11-15',
    scheduled_time: '20:00:00',
    duration_minutes: 720,
    recurrence_rule: 'daily',
    parent_event_id: null,
    is_virtual: false,
    reminder_lead_minutes: 120,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as CalendarEvent;
}

const members = [
  { id: 'u-me', first_name: 'Luis', last_name: 'M', email: 'l@x.test', role: 'owner' },
  { id: 'u-ana', first_name: 'Alexandra', last_name: 'Montes', email: 'a@x.test', role: 'member' },
];

function circle(over: Record<string, unknown> = {}) {
  vi.mocked(useCircle).mockReturnValue({
    members,
    canEdit: true,
    canManageMembers: true,
    viewOnly: false,
    isPremiumCircle: true,
    isOwner: true,
    hasShifts: true,
    ...over,
  } as unknown as ReturnType<typeof useCircle>);
}

function renderDetail(s: CalendarEvent, timezone = RECIPIENT_TZ) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <ShiftDetailModal circleId="c" shift={s} timezone={timezone} onClose={vi.fn()} onAction={vi.fn()} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Pinned BEFORE the fixtures (Nov 15) so the open shift is not ENDED on the real clock.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
  listProps.value = null;
  useAuthStore.setState({ user: { id: 'u-me' } } as never);
  circle();
  vi.mocked(getSeriesRoot).mockResolvedValue(null as never);
});
afterEach(() => vi.useRealTimers());

describe('shift detail header', () => {
  it('title and chip share ONE wrapping row; the title never truncates', () => {
    renderDetail(shift());
    const header = screen.getByTestId('shift-detail-header');
    expect(header).toHaveClass('flex', 'flex-wrap');
    const title = within(header).getByTestId('shift-detail-title');
    expect(title).toHaveTextContent('Night');
    expect(title).not.toHaveClass('truncate');
    expect(title).toHaveClass('break-words');
    expect(within(header).getByTestId('shift-detail-who')).toBeInTheDocument();
    // the dialog is still named by the title (the sr-only h2), once
    expect(screen.getByRole('dialog', { name: 'Night' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Night' })).toHaveLength(1);
  });

  it('a short title is the large size; a long one (over 14 characters) steps down', () => {
    renderDetail(shift());
    expect(screen.getByTestId('shift-detail-title')).toHaveClass('text-xl');
    cleanup();
    renderDetail(shift({ title: 'Overnight with Mom at Rosa’s house' }));
    const long = screen.getByTestId('shift-detail-title');
    expect(long).toHaveClass('text-lg');
    expect(long).not.toHaveClass('text-xl');
  });

  it('open: "Open · nobody yet", read as "Open, nobody on this shift yet"', () => {
    renderDetail(shift());
    const chip = screen.getByTestId('shift-detail-who');
    expect(within(chip).getByTestId('shift-detail-status')).toHaveTextContent('Open · nobody yet');
    expect(within(chip).getByTestId('shift-detail-status')).toHaveAttribute('aria-hidden', 'true');
    expect(within(chip).getByText('Open, nobody on this shift yet')).toHaveClass('sr-only');
  });

  it('someone else: avatar + name; the name truncates, the avatar never shrinks', () => {
    renderDetail(shift({ assigned_to: 'u-ana' }));
    const chip = screen.getByTestId('shift-detail-who');
    expect(chip).toHaveClass('max-w-full');
    const name = within(chip).getByTestId('shift-detail-chip-name');
    expect(name).toHaveTextContent('Alexandra');
    expect(name).toHaveClass('truncate');
    expect(within(chip).getByTestId('shift-detail-chip-avatar')).toHaveClass('shrink-0');
    expect(within(chip).getByText("Who's on it,", { exact: false })).toHaveClass('sr-only');
    expect(screen.queryByTestId('shift-detail-status')).not.toBeInTheDocument();
  });

  it('mine: avatar + "You"', () => {
    renderDetail(shift({ assigned_to: 'u-me' }));
    expect(screen.getByTestId('shift-detail-chip-name')).toHaveTextContent('You');
    expect(screen.getByTestId('shift-detail-chip-avatar')).toBeInTheDocument();
  });

  it('ended and unfilled keeps the "Not covered" chip', () => {
    vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
    renderDetail(shift());
    expect(screen.getByTestId('shift-detail-status')).toHaveTextContent('Not covered');
  });
});

describe('shift detail card', () => {
  it('ONE card: When (date · range on one line), then Repeats and Reminder side by side', () => {
    renderDetail(shift());
    const card = screen.getByTestId('shift-detail-card');
    expect(within(card).getByTestId('shift-detail-time')).toHaveTextContent(
      /^Sun, Nov 15 · 8:00 PM – 8:00 AM( \(\w+\))? \(next day\)$/
    );
    expect(within(card).getByTestId('shift-detail-date')).toHaveTextContent('Sun, Nov 15');
    const grid = within(card).getByTestId('shift-detail-card-grid');
    expect(grid).toHaveClass('grid', 'grid-cols-2');
    expect(within(grid).getByTestId('shift-detail-repeat')).toHaveTextContent(/^Daily$/);
    expect(within(grid).getByTestId('shift-detail-reminder')).toHaveTextContent(/^2 hours before$/);
    // labelled cells: dt/dd pairs
    const labels = within(card)
      .getAllByRole('term')
      .map((n) => n.textContent);
    expect(labels).toEqual(['When', 'Repeats', 'Reminder']);
    // the old rows are gone (the chip carries who's on it)
    expect(screen.queryByText("Who's on it")).not.toBeInTheDocument();
    expect(screen.queryByText('Date')).not.toBeInTheDocument();
  });

  it('every <dl> directly holds only <div> groups of <dt>/<dd> (axe definition-list / dlitem)', () => {
    renderDetail(shift({ recurrence_rule: 'cycle:14:7' }));
    const lists = screen.getByTestId('shift-detail-card').querySelectorAll('dl');
    expect(lists.length).toBeGreaterThan(0);
    for (const dl of lists) {
      for (const group of Array.from(dl.children)) {
        expect(group.tagName).toBe('DIV');
        for (const item of Array.from(group.children)) expect(['DT', 'DD']).toContain(item.tagName);
      }
    }
  });

  it("the viewer's own time (another zone) stays inside the When cell", () => {
    const other = getDeviceTimezone() === 'Asia/Tokyo' ? 'Europe/London' : 'Asia/Tokyo';
    renderDetail(shift(), other);
    const card = screen.getByTestId('shift-detail-card');
    expect(within(card).getByTestId('shift-detail-viewer-time')).toHaveTextContent(/^Your time: /);
  });

  it('a rotation position stays in the Repeats cell', () => {
    renderDetail(shift({ recurrence_rule: 'cycle:14:7', scheduled_date: '2026-11-15' }));
    const grid = screen.getByTestId('shift-detail-card-grid');
    expect(within(grid).getByTestId('shift-detail-rotation')).toHaveTextContent('Day 1 of 14 · back on');
  });
});

describe('one filled button per screen', () => {
  it('open shift: Take is the primary, the list fills no Done', () => {
    renderDetail(shift());
    expect(screen.getByRole('button', { name: 'Take' })).toHaveClass('bg-primary-fill');
    expect(listProps.value?.primaryAllowed).toBe(false);
  });

  it("the viewer's own shift: no Take; the list's next Done is the primary and Drop is neutral", () => {
    renderDetail(shift({ assigned_to: 'u-me' }));
    expect(screen.queryByRole('button', { name: 'Take' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Drop shift' })).not.toHaveClass('bg-primary-fill');
    expect(listProps.value?.primaryAllowed).toBe(true);
  });

  it("someone else's shift: no Take, the list may fill its first Done", () => {
    renderDetail(shift({ assigned_to: 'u-ana' }));
    expect(screen.queryByRole('button', { name: 'Take' })).not.toBeInTheDocument();
    expect(listProps.value?.primaryAllowed).toBe(true);
  });

  it('an open shift with no Take on screen (read-only or ended) lets the list fill its Done', () => {
    circle({ viewOnly: true, canEdit: false });
    renderDetail(shift());
    expect(screen.queryByRole('button', { name: 'Take' })).not.toBeInTheDocument();
    expect(listProps.value?.primaryAllowed).toBe(true);
  });
});
