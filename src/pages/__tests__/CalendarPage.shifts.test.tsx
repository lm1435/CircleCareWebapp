import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import CalendarPage from '../CalendarPage';
import { ToastProvider } from '@/components/ui';
import { getCircleDetail, getEvents, type CalendarEvent } from '@/api/calendarEvents';
import { getShifts } from '@/api/shifts';
import { getCircleDetail as getMembersCircleDetail, type CircleMember } from '@/api/circleMembers';
import { getCircles } from '@/api/circles';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';

// Care shifts T8 (docs/plans/care-shifts.md): the Schedule | Shifts control on
// the Calendar. Visibility by tier and role, the "N open" badge (hidden while
// loading and at 0), Shifts replacing Schedule (own query, includeShifts only
// there), Day / Week / Month renderers, the teaser, analytics.

vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  getEvents: vi.fn(),
  getCircleDetail: vi.fn(),
}));
vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  getShifts: vi.fn(),
}));
vi.mock('@/api/circleMembers', () => ({ getCircleDetail: vi.fn() }));
vi.mock('@/api/circles', () => ({ getCircles: vi.fn() }));
vi.mock('@/api/emergencyInfo', () => ({ getEmergencyInfo: vi.fn().mockResolvedValue(null) }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    calendarViewed: vi.fn(),
    shiftsViewOpened: vi.fn(),
    shiftsTeaserShown: vi.fn(),
    shiftsTeaserCtaTapped: vi.fn(),
    medicationActionsMenuOpened: vi.fn(),
    shiftTaken: vi.fn(),
    shiftTakeConflict: vi.fn(),
  },
}));

vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const mockGetEvents = vi.mocked(getEvents);
const mockGetShifts = vi.mocked(getShifts);
const mockGetCircleDetail = vi.mocked(getCircleDetail);
const mockMembersDetail = vi.mocked(getMembersCircleDetail);
const mockGetCircles = vi.mocked(getCircles);

const TZ = 'America/Chicago';
// Friday 2026-06-12, 10:30 in Chicago. Week (Sun-first): Jun 7 - Jun 13.
const NOW_ISO = '2026-06-12T15:30:00Z';

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
});
afterAll(() => vi.useRealTimers());

function detail(over: Record<string, unknown> = {}) {
  return {
    id: 'circle-1',
    name: "Mom's Care",
    recipient_name: 'Mom',
    recipient_photo_url: null,
    recipient_dob: null,
    recipient_conditions: null,
    owner_id: 'u-owner',
    created_at: '2026-01-01T00:00:00Z',
    is_self_care: false,
    care_recipient_timezone: TZ,
    members: [
      { id: 'u-owner', first_name: 'Olivia', last_name: 'O', email: 'o@x.test', role: 'owner', is_care_recipient: false },
      { id: 'u-ana', first_name: 'Ana', last_name: 'R', email: 'a@x.test', role: 'member', is_care_recipient: false },
    ] as unknown as CircleMember[],
    access_level: 'full' as const,
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    ...over,
  };
}

function shift(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 's',
    circle_id: 'circle-1',
    event_type: 'shift',
    title: 'Night',
    scheduled_date: '2026-06-12',
    scheduled_time: '20:00:00',
    duration_minutes: 720,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

const SHIFTS: CalendarEvent[] = [
  shift({ id: 'open-night', title: 'Night', scheduled_time: '20:00:00' }),
  shift({ id: 'filled-morning', title: 'Morning', scheduled_time: '08:00:00', duration_minutes: 360, assigned_to: 'u-ana' }),
  shift({ id: 'next-day', title: 'Evening', scheduled_date: '2026-06-13', scheduled_time: '17:00:00', assigned_to: 'u-ana' }),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/circles/circle-1/calendar']}>
          <Routes>
            <Route path="/circles/:circleId/calendar" element={<CalendarPage />} />
            <Route path="/upgrade" element={<div data-testid="upgrade-page" />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function asUser(id: string) {
  useAuthStore.setState({
    user: { id, email: `${id}@x.test`, first_name: id, last_name: 'X' },
    isAuthenticated: true,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  asUser('u-owner');
  mockGetCircleDetail.mockResolvedValue({
    id: 'circle-1',
    name: "Mom's Care",
    recipient_name: 'Mom',
    care_recipient_timezone: TZ,
    can_edit: true,
    view_only: false,
  });
  mockMembersDetail.mockResolvedValue(detail());
  mockGetCircles.mockResolvedValue([]);
  mockGetEvents.mockResolvedValue([]);
  mockGetShifts.mockImplementation(async (_c, start, end) =>
    SHIFTS.filter((s) => s.scheduled_date >= start && s.scheduled_date <= end)
  );
  Element.prototype.scrollIntoView = vi.fn();
});

const modeTabs = () => screen.queryByRole('tablist', { name: 'Calendar mode' });

describe('Schedule | Shifts visibility', () => {
  it('premium owner and premium member both see it', async () => {
    const view = renderPage();
    expect(await screen.findByRole('tablist', { name: 'Calendar mode' })).toBeInTheDocument();
    view.unmount();

    asUser('u-ana');
    mockMembersDetail.mockResolvedValue(detail());
    renderPage();
    expect(await screen.findByRole('tablist', { name: 'Calendar mode' })).toBeInTheDocument();
  });

  it('free OWNER sees it, and the Shifts segment opens the teaser (nothing is fetched, no mode switch)', async () => {
    mockMembersDetail.mockResolvedValue(detail({ is_premium_circle: false }));
    const user = userEvent.setup();
    renderPage();
    const tabs = await screen.findByRole('tablist', { name: 'Calendar mode' });
    await user.click(within(tabs).getByRole('tab', { name: /^Shifts/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Share the care, shift by shift' });
    expect(within(dialog).getByText('Premium')).toBeInTheDocument();
    expect(Analytics.shiftsTeaserShown).toHaveBeenCalledWith({ source: 'toggle' });
    expect(within(tabs).getByRole('tab', { name: 'Schedule' })).toHaveAttribute('aria-selected', 'true');
    expect(mockGetShifts).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'See Premium' }));
    expect(Analytics.shiftsTeaserCtaTapped).toHaveBeenCalled();
    expect(await screen.findByTestId('upgrade-page')).toBeInTheDocument();
  });

  it('free manager / free member: no toggle at all, the screen is unchanged', async () => {
    asUser('u-ana');
    mockMembersDetail.mockResolvedValue(detail({ is_premium_circle: false }));
    renderPage();
    await screen.findByRole('tablist', { name: 'Calendar view' });
    expect(modeTabs()).not.toBeInTheDocument();
    expect(mockGetShifts).not.toHaveBeenCalled();
  });

  it('a view-only seat sees none', async () => {
    asUser('u-ana');
    mockMembersDetail.mockResolvedValue(detail({ view_only: true, is_premium_circle: false, can_edit: false }));
    renderPage();
    await screen.findByRole('tablist', { name: 'Calendar view' });
    expect(modeTabs()).not.toBeInTheDocument();
  });
});

describe('the Shifts toggle carries no open count', () => {
  it('reads plain "Shifts" even when open shifts exist, and the open-count window still feeds analytics', async () => {
    renderPage();
    const tab = await screen.findByRole('tab', { name: 'Shifts' });
    expect(tab).toHaveTextContent(/^Shifts$/);
    expect(screen.queryByTestId('shifts-open-badge')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ open/)).not.toBeInTheDocument();
    // The count is not rendered, but the 7-day window (today .. +6) is still read for analytics.
    await waitFor(() => expect(mockGetShifts).toHaveBeenCalledWith('circle-1', '2026-06-12', '2026-06-18'));
  });

  it('has no count at 0 open or while loading either', async () => {
    let release: (rows: CalendarEvent[]) => void = () => {};
    mockGetShifts.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderPage();
    const tab = await screen.findByRole('tab', { name: 'Shifts' });
    expect(tab).toHaveTextContent(/^Shifts$/);
    release([shift({ id: 'a', assigned_to: 'u-ana' })]);
    await waitFor(() => expect(mockGetShifts).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'Shifts' })).toHaveTextContent(/^Shifts$/);
  });
});

describe('Shifts mode', () => {
  async function openShifts(user: ReturnType<typeof userEvent.setup>) {
    const tabs = await screen.findByRole('tablist', { name: 'Calendar mode' });
    await user.click(within(tabs).getByRole('tab', { name: /^Shifts/ }));
  }

  it('replaces Schedule: shifts only, "• Shifts" eyebrow, the schedule legend gone, an "Add shift" action', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('tablist', { name: 'Calendar view' });
    await waitFor(() => expect(mockGetEvents).toHaveBeenCalled());
    await openShifts(user);

    expect(await screen.findByTestId('shifts-week-view')).toBeInTheDocument();
    // Shifts come ONLY from getShifts (includeShifts); the generic events read never asks for them.
    for (const [, params] of mockGetEvents.mock.calls) {
      expect(params).not.toHaveProperty('includeShifts');
    }
    expect(mockGetShifts).toHaveBeenCalledWith('circle-1', '2026-06-07', '2026-06-13');
    expect(screen.getAllByText('Shifts').length).toBeGreaterThan(0);
    expect(screen.queryByRole('list', { name: 'Event type colors' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add shift' }).length).toBeGreaterThan(0);
    // There is no calendar import on web, so nothing to hide there.
    expect(screen.queryByRole('button', { name: /import/i })).not.toBeInTheDocument();
    expect(Analytics.shiftsViewOpened).toHaveBeenCalledWith({ range: 'week', openCount: 1, access: 'full' });
  });

  it('Week: cards grouped by day with the open state in text', async () => {
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    const week = await screen.findByTestId('shifts-week-view');
    const friday = within(week).getByRole('region', { name: /Jun 12/ });
    const cards = within(friday).getAllByTestId('shift-card');
    expect(cards.map((c) => c.getAttribute('data-shift-state'))).toEqual(['filled', 'open']);
    expect(within(friday).getByText(/8:00 AM – 2:00 PM · Ana/)).toBeInTheDocument();
    expect(within(friday).getByRole('button', { name: 'Take Night' })).toBeInTheDocument();
    // A day with none reads so.
    expect(within(week).getAllByText('No shifts').length).toBeGreaterThan(0);
    // Per-day count line; ONE "Add shift" button for the whole week.
    expect(within(friday).getByTestId('shifts-week-day-summary')).toHaveTextContent('2 shifts · 1 open');
    expect(within(week).getAllByRole('button', { name: 'Add shift' })).toHaveLength(1);
  });

  it('Day: hero summary "N shifts · M open." and cards by start time', async () => {
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    await user.click(screen.getByRole('tab', { name: 'Day' }));
    expect(await screen.findByTestId('shifts-day-list')).toBeInTheDocument();
    expect(screen.getByTestId('day-view-summary')).toHaveTextContent('2 shifts · 1 open.');
    expect(
      within(screen.getByTestId('shifts-day-list')).getAllByTestId('shift-card').map((c) => c.textContent)
    ).toEqual([expect.stringContaining('Morning'), expect.stringContaining('Night')]);
    expect(
      within(screen.getByTestId('shifts-day-list')).getByRole('button', { name: 'Add shift' })
    ).toBeInTheDocument();
  });

  it('Month: a hollow moss dot for a day with an open shift, a filled moss dot when fully covered, a text legend, per-cell labels; a day opens Day', async () => {
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    await user.click(screen.getByRole('tab', { name: 'Month' }));
    const grid = await screen.findByRole('grid', { name: 'Shifts month calendar' });
    const jun12 = within(grid).getByRole('button', { name: /June 12.*2 shifts, 1 open/ });
    expect(jun12).toHaveAttribute('data-shift-dots', 'open');
    const openDot = jun12.querySelector('[data-dot="open"]') as HTMLElement;
    expect(openDot).toHaveClass('border-moss', 'bg-transparent');
    expect(openDot.className).not.toMatch(/amber/);
    const jun13 = within(grid).getByRole('button', { name: /June 13.*1 shift, none open/ });
    expect(jun13).toHaveAttribute('data-shift-dots', 'covered');
    expect(jun13.querySelector('[data-dot="covered"]')).toHaveClass('bg-moss');
    expect(screen.getByRole('list', { name: 'Shifts key' })).toHaveTextContent('Has an open shift');
    expect(screen.getByRole('list', { name: 'Shifts key' })).toHaveTextContent('Fully covered');

    await user.click(jun13);
    expect(await screen.findByTestId('shifts-day-list')).toBeInTheDocument();
    expect(screen.getByTestId('day-view-title')).toHaveTextContent('Tomorrow, Saturday');
  });

  it('no shifts at all in a week / month: the empty state with "Add a shift" (editors) ', async () => {
    mockGetShifts.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    const card = await screen.findByTestId('shifts-empty-state');
    expect(within(card).getByRole('heading', { name: 'Share the care, shift by shift' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Add a shift' })).toBeInTheDocument();
  });

  it('empty state only when the window holds today AND the 7-day peek is empty', async () => {
    // The visible week (Jun 21 - 27) is empty, but the peek (today .. +6) is not.
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    await screen.findByTestId('shifts-week-view');
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(mockGetShifts).toHaveBeenCalledWith('circle-1', '2026-06-14', '2026-06-20'));
    expect(await screen.findByTestId('shifts-week-view')).toBeInTheDocument();
    expect(screen.queryByTestId('shifts-empty-state')).not.toBeInTheDocument();
    expect(screen.getAllByText('No shifts').length).toBe(7);
  });

  it('...and not when the window excludes today, even if the peek is empty too', async () => {
    mockGetShifts.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    expect(await screen.findByTestId('shifts-empty-state')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(screen.queryByTestId('shifts-empty-state')).not.toBeInTheDocument());
    expect(await screen.findByTestId('shifts-week-view')).toBeInTheDocument();
  });

  it('Day view with nothing anywhere shows the empty state too', async () => {
    mockGetShifts.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    await user.click(screen.getByRole('tab', { name: 'Day' }));
    expect(await screen.findByTestId('shifts-empty-state')).toBeInTheDocument();
  });

  it('a failed shifts load shows the shifts copy (not the schedule\'s) with Retry', async () => {
    mockGetShifts.mockRejectedValue({ success: false, error: { code: 'INTERNAL', message: 'x' } });
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    expect(await screen.findByText(/load the shifts/i)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t load the calendar/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shifts_view_opened still fires when the open-count read fails (0 bucket)', async () => {
    mockGetShifts.mockRejectedValue({ success: false, error: { code: 'INTERNAL', message: 'x' } });
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    await waitFor(() =>
      expect(Analytics.shiftsViewOpened).toHaveBeenCalledWith({ range: 'week', openCount: 0, access: 'full' })
    );
    expect(screen.queryByTestId('shifts-open-badge')).not.toBeInTheDocument();
  });

  it('read-only viewers see the empty copy without the button', async () => {
    asUser('u-ana');
    mockMembersDetail.mockResolvedValue(detail({ can_edit: false, view_only: false }));
    mockGetShifts.mockResolvedValue([]);
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    const card = await screen.findByTestId('shifts-empty-state');
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('a day with no shifts, in Day view: "No shifts on this day." + Add shift', async () => {
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    await user.click(screen.getByRole('tab', { name: 'Day' }));
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(await screen.findByText('No shifts on this day.')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('shifts-day-list')).getByRole('button', { name: 'Add shift' })
    ).toBeInTheDocument();
  });

  it('tapping a card opens the detail with who is on it and the role actions', async () => {
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    const week = await screen.findByTestId('shifts-week-view');
    await user.click(within(week).getByRole('button', { name: 'Morning, 8:00 AM to 2:00 PM, Ana is on it' }));
    const dialog = await screen.findByRole('dialog', { name: 'Morning' });
    expect(within(dialog).getByTestId('shift-detail-who')).toHaveTextContent('Ana');
    expect(within(dialog).getByTestId('shift-detail-reminder')).toHaveTextContent('Off');
    // The owner can drop / assign / edit / delete; the shift is filled so no Take.
    for (const name of ['Drop shift', 'Assign', 'Edit', 'Delete']) {
      expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(dialog).queryByRole('button', { name: 'Take' })).not.toBeInTheDocument();
  });
});

describe('lapsed Premium: a free circle that still has shifts (readonly)', () => {
  const lapsed = (over: Record<string, unknown> = {}) =>
    detail({ is_premium_circle: false, has_shifts: true, ...over });

  async function openShifts(user: ReturnType<typeof userEvent.setup>) {
    const tabs = await screen.findByRole('tablist', { name: 'Calendar mode' });
    await user.click(within(tabs).getByRole('tab', { name: /^Shifts/ }));
  }

  it('OWNER: the toggle opens the shifts (not the teaser), the notice offers Renew Premium -> paywall', async () => {
    mockMembersDetail.mockResolvedValue(lapsed());
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    expect(await screen.findByTestId('shifts-week-view')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Share the care, shift by shift' })).not.toBeInTheDocument();
    expect(Analytics.shiftsTeaserShown).not.toHaveBeenCalled();
    expect(screen.getByTestId('shifts-readonly-notice-text')).toHaveTextContent(
      'Premium has ended. Your shifts are read-only.'
    );
    expect(Analytics.shiftsViewOpened).toHaveBeenCalledWith({ range: 'week', openCount: 1, access: 'readonly' });
    await user.click(screen.getByRole('button', { name: 'Renew Premium' }));
    expect(await screen.findByTestId('upgrade-page')).toBeInTheDocument();
  });

  it('MEMBER: keeps the toggle and the plain notice, with NO Renew action', async () => {
    asUser('u-ana');
    mockMembersDetail.mockResolvedValue(lapsed());
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    expect(await screen.findByTestId('shifts-week-view')).toBeInTheDocument();
    expect(screen.getByTestId('shifts-readonly-notice-text')).toHaveTextContent(
      'Shifts are read-only right now.'
    );
    expect(screen.queryByRole('button', { name: 'Renew Premium' })).not.toBeInTheDocument();
  });

  it('every write affordance is gone: no Add shift, no Take, in Week or Day, and no header action', async () => {
    mockMembersDetail.mockResolvedValue(lapsed());
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    const week = await screen.findByTestId('shifts-week-view');
    expect(screen.queryByRole('button', { name: 'Add shift' })).not.toBeInTheDocument();
    expect(within(week).queryByRole('button', { name: /^Take/ })).not.toBeInTheDocument();
    // The open card is still listed, readable.
    expect(within(week).getByRole('button', { name: /^Night, .*open/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Day' }));
    await screen.findByTestId('shifts-day-list');
    expect(screen.queryByRole('button', { name: 'Add shift' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Take/ })).not.toBeInTheDocument();
  });

  it('the detail opens read-only: no Take / Drop / Assign / Edit / Delete', async () => {
    mockMembersDetail.mockResolvedValue(lapsed());
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    const week = await screen.findByTestId('shifts-week-view');
    await user.click(within(week).getByRole('button', { name: 'Morning, 8:00 AM to 2:00 PM, Ana is on it' }));
    const dialog = await screen.findByRole('dialog', { name: 'Morning' });
    expect(within(dialog).getByTestId('shift-detail-who')).toHaveTextContent('Ana');
    for (const name of ['Drop shift', 'Assign', 'Edit', 'Delete', 'Take']) {
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });

  it('the notice is a plain labelled group (not a live region); in Day it sits BELOW the date nav hero, like mobile', async () => {
    mockMembersDetail.mockResolvedValue(lapsed());
    const user = userEvent.setup();
    renderPage();
    await openShifts(user);
    await screen.findByTestId('shifts-week-view');
    const notice = screen.getByTestId('shifts-readonly-notice');
    expect(notice).toHaveAttribute('role', 'group');
    expect(notice).toHaveAccessibleName('Premium has ended. Your shifts are read-only.');
    expect(screen.queryByRole('status', { name: /read-only/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Day' }));
    const title = await screen.findByTestId('day-view-title');
    const dayNotice = screen.getByTestId('shifts-readonly-notice');
    expect(screen.getAllByTestId('shifts-readonly-notice')).toHaveLength(1);
    expect(title.compareDocumentPosition(dayNotice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId('day-view').contains(dayNotice)).toBe(true);
  });

  it('Schedule itself is untouched: no notice there, and Add event still works for editors', async () => {
    mockMembersDetail.mockResolvedValue(lapsed());
    renderPage();
    await screen.findByRole('tablist', { name: 'Calendar mode' });
    expect(screen.queryByTestId('shifts-readonly-notice')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add event' }).length).toBeGreaterThan(0);
  });

  it('a view-only seat gets nothing, even with has_shifts', async () => {
    asUser('u-ana');
    mockMembersDetail.mockResolvedValue(lapsed({ view_only: true, can_edit: false }));
    renderPage();
    await screen.findByRole('tablist', { name: 'Calendar view' });
    expect(modeTabs()).not.toBeInTheDocument();
  });

  it('has_shifts false: a free member still gets no toggle (unchanged)', async () => {
    asUser('u-ana');
    mockMembersDetail.mockResolvedValue(lapsed({ has_shifts: false }));
    renderPage();
    await screen.findByRole('tablist', { name: 'Calendar view' });
    expect(modeTabs()).not.toBeInTheDocument();
  });
});
