import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import CalendarPage from '../CalendarPage';
import { ToastProvider } from '@/components/ui';
import { getCircleDetail, getEvents, type CalendarEvent } from '@/api/calendarEvents';

// Task 47 — CalendarPage: week/month toggle, date navigation changes the
// fetched range, event rendering with type/status styling, detail modal with
// focus management, timezone caption, current-time indicator only on today.

vi.mock('@/api/calendarEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/calendarEvents')>();
  return {
    ...actual,
    getEvents: vi.fn(),
    getCircleDetail: vi.fn(),
  };
});

// useCircle (canEdit + members for the write flow) reads GET /circles/:id via
// @/api/circleMembers, and GET /circles via @/api/circles — under the same
// query keys as the calendar's own circle-detail fetch. Mock both so the
// shared-key queries resolve and never surface a network error.
vi.mock('@/api/circleMembers', () => ({
  getCircleDetail: vi.fn(),
}));
vi.mock('@/api/circles', () => ({
  getCircles: vi.fn(),
}));
// The detail modal now mounts EventNotesPanel (needs ToastProvider + React Query
// auth context); stub it so the page test stays focused on calendar behavior.
vi.mock('@/components/calendar/EventNotesPanel', () => ({
  EventNotesPanel: () => null,
}));
// The GettingStartedChecklist (rendered on the landing) reads emergency info; stub
// the fetcher so the page test doesn't make an unmocked network call. The checklist
// hides on its own (it stays open here with events present + no emergency info, but
// renders into a labelled region that doesn't collide with the assertions below).
vi.mock('@/api/emergencyInfo', () => ({
  getEmergencyInfo: vi.fn().mockResolvedValue(null),
}));

// The viewer's 12h/24h clock. Pin it here (the real hook reads the shared
// currentUser query) so every time label below is deterministic instead of
// depending on the runner's navigator.language.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

import { getCircleDetail as getMembersCircleDetail } from '@/api/circleMembers';
import { getCircles } from '@/api/circles';

const mockGetEvents = vi.mocked(getEvents);
const mockGetCircleDetail = vi.mocked(getCircleDetail);
const mockGetMembersCircleDetail = vi.mocked(getMembersCircleDetail);
const mockGetCircles = vi.mocked(getCircles);

// Pin the "device" timezone to America/New_York (dev machine is
// America/Denver — tests must never depend on it). Only getDeviceTimezone
// calls resolvedOptions; format/formatToParts are unaffected.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/New_York',
} as Intl.ResolvedDateTimeFormatOptions);

const TZ = 'America/Chicago';
const CIRCLE = {
  id: 'circle-1',
  name: "Mom's Care",
  recipient_name: 'Mom',
  care_recipient_timezone: TZ,
  can_edit: false,
  view_only: false,
};

function makeEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'ev-x',
    circle_id: 'circle-1',
    event_type: 'medication',
    title: 'Event',
    scheduled_date: '2026-06-12',
    scheduled_time: '08:00:00',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

// Friday 2026-06-12, 10:30 AM in Chicago. Week (Sun-first): Jun 7 – Jun 13.
const NOW_ISO = '2026-06-12T15:30:00Z';

const EVENTS: CalendarEvent[] = [
  makeEvent({
    id: 'ev-taken',
    title: 'Metformin',
    medication_name: 'Metformin',
    medication_dosage: '500mg',
    scheduled_time: '08:00:00',
    confirmation: { status: 'taken', confirmed_at: '2026-06-12T13:05:00Z', confirmed_by: 'u1' },
  }),
  makeEvent({
    id: 'ev-missed',
    title: 'Lisinopril',
    medication_name: 'Lisinopril',
    scheduled_date: '2026-06-11',
    scheduled_time: '09:00:00',
    confirmation: null,
  }),
  makeEvent({
    id: 'ev-pending',
    title: 'Vitamin D',
    medication_name: 'Vitamin D',
    scheduled_time: '20:00:00',
    confirmation: null,
  }),
  makeEvent({
    id: 'ev-skipped',
    title: 'Aspirin',
    medication_name: 'Aspirin',
    scheduled_time: '09:00:00',
    confirmation: { status: 'skipped', confirmed_at: '2026-06-12T14:10:00Z', confirmed_by: 'u1' },
  }),
  makeEvent({
    id: 'ev-appt',
    event_type: 'appointment',
    title: 'Dr. Smith',
    scheduled_time: '14:00:00',
    location: 'Clinic',
    description: 'Bring insurance card',
  }),
  makeEvent({
    id: 'ev-task',
    event_type: 'task',
    title: 'Pick up groceries',
    scheduled_date: '2026-06-10',
    scheduled_time: null, // all-day
  }),
];

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/circles/circle-1/calendar']}>
        <Routes>
          <Route path="/circles/:circleId/calendar" element={<CalendarPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Same page with edit access + a ToastProvider, for the write flows that mount
 * EventDetailActions / ConfirmMedDialog (both call useToast). The caller must
 * also give `mockGetMembersCircleDetail` a `can_edit: true` detail.
 */
function renderEditablePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/circles/circle-1/calendar']}>
          <Routes>
            <Route path="/circles/:circleId/calendar" element={<CalendarPage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeAll(() => {
  // Fake ONLY Date so "now"/"today" are deterministic while timers/waitFor
  // keep working normally.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW_ISO));
});

afterAll(() => {
  vi.useRealTimers();
});

const MEMBERS_DETAIL = {
  id: 'circle-1',
  name: "Mom's Care",
  recipient_name: 'Mom',
  recipient_photo_url: null,
  recipient_dob: null,
  recipient_conditions: null,
  owner_id: 'u1',
  created_at: '2026-01-01T00:00:00Z',
  is_self_care: false,
  care_recipient_timezone: TZ,
  members: [],
  access_level: 'view' as const,
  is_premium_circle: false,
  can_edit: false,
  view_only: false,
};

beforeEach(() => {
  mockUseHourCycle.mockReturnValue('12h');
  mockGetEvents.mockReset();
  mockGetCircleDetail.mockReset();
  mockGetMembersCircleDetail.mockReset();
  mockGetCircles.mockReset();
  mockGetCircleDetail.mockResolvedValue(CIRCLE);
  mockGetMembersCircleDetail.mockResolvedValue(MEMBERS_DETAIL);
  mockGetCircles.mockResolvedValue([]);
  mockGetEvents.mockResolvedValue(EVENTS);
});

describe('CalendarPage', () => {
  it('renders the week view by default with the timezone caption', async () => {
    renderPage();

    expect(await screen.findByRole('grid', { name: 'Week view calendar' })).toBeInTheDocument();
    // Week/Month is the shared `SegmentedControl` (spec §6.4): a tablist of
    // tabs, not a hand-rolled pressed-button pair.
    const weekTab = screen.getByRole('tab', { name: 'Week' });
    const monthTab = screen.getByRole('tab', { name: 'Month' });
    expect(weekTab).toHaveAttribute('aria-selected', 'true');
    expect(monthTab).toHaveAttribute('aria-selected', 'false');
    expect(weekTab.className).toContain('text-cream');
    expect(monthTab.className).not.toContain('text-cream');

    // Times shown in the CARE RECIPIENT's timezone
    expect(screen.getByText('Times shown in Chicago')).toBeInTheDocument();

    // Fetched the visible Sunday-first week in the recipient timezone
    expect(mockGetEvents).toHaveBeenCalledWith('circle-1', {
      start_date: '2026-06-07',
      end_date: '2026-06-13',
    });
    expect(screen.getByRole('heading', { name: 'Jun 7 – Jun 13, 2026' })).toBeInTheDocument();
  });

  it('prefetches the adjacent week windows after the visible one loads', async () => {
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    expect(mockGetEvents).toHaveBeenCalledWith('circle-1', {
      start_date: '2026-05-31',
      end_date: '2026-06-06',
    });
    expect(mockGetEvents).toHaveBeenCalledWith('circle-1', {
      start_date: '2026-06-14',
      end_date: '2026-06-20',
    });
  });

  it('toggles to month view and fetches the full 6-week grid range', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    await user.click(screen.getByRole('tab', { name: 'Month' }));

    expect(await screen.findByRole('grid', { name: 'Month view calendar' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Week' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('heading', { name: 'June 2026' })).toBeInTheDocument();

    expect(mockGetEvents).toHaveBeenCalledWith('circle-1', {
      start_date: '2026-05-31',
      end_date: '2026-07-11',
    });
  });

  it('disables Today on load and re-enables it once the anchor moves', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    const todayButton = screen.getByRole('button', { name: 'Today' });
    expect(todayButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(todayButton).toBeEnabled();

    await user.click(todayButton);
    expect(todayButton).toBeDisabled();
  });

  // Mobile `DateNavHeader` parity: transparent 1px-line pill, r6, min-height
  // 32, 12/600 ink (spec §6.4).
  it('renders the Today pill with mobile DateNavHeader classes, on a 44px hit area', async () => {
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    // The visible pill is drawn on an inner span (mobile-parity 32px);
    // the BUTTON itself carries the 44px tap target (WCAG 2.5.5).
    const todayButton = screen.getByRole('button', { name: 'Today' });
    expect(todayButton.className).toContain('min-h-[44px]');

    const pill = todayButton.firstElementChild as HTMLElement;
    expect(pill.className).toContain('rounded-[6px]');
    expect(pill.className).toContain('border-line');
    expect(pill.className).toContain('min-h-[32px]');
    expect(pill.className).toContain('text-xs');
    expect(pill.className).toContain('font-semibold');
    expect(pill.className).toContain('text-ink');
  });

  // Regression (2026-09-05): at 390px the SegmentedControl clipped off the
  // right edge instead of wrapping to its own row. A follow-up fix found
  // `flex-wrap` alone never actually broke the line (see CalendarPage.tsx's
  // comment on this row) — jsdom can't measure layout, so this asserts the
  // STRUCTURAL classes (forced `flex-col` below 480px) rather than pixels;
  // the real-browser proof lives in the Playwright verification, not here.
  it('stacks the toolbar into two full-width rows below 480px, instead of relying on flex-wrap alone', async () => {
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    const toggleWrap = screen.getByTestId('calendar-view-toggle-wrap');
    expect(toggleWrap.className).toContain('max-[480px]:w-full');
    expect(toggleWrap.className).toContain('max-[480px]:order-last');
    expect(toggleWrap.className).toContain('w-40');

    const row = toggleWrap.parentElement as HTMLElement;
    expect(row.className).toContain('flex-wrap');
    expect(row.className).toContain('max-[480px]:flex-col');
    expect(row.className).toContain('max-[480px]:items-stretch');

    const todayNavGroup = screen.getByRole('button', { name: 'Today' })
      .parentElement as HTMLElement;
    expect(todayNavGroup.className).toContain('min-w-0');
    expect(todayNavGroup.className).toContain('flex-1');
    expect(todayNavGroup.className).toContain('max-[480px]:w-full');
  });

  it('disables Today after next then prev lands back on today, even with a non-null override', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    const todayButton = screen.getByRole('button', { name: 'Today' });
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(todayButton).toBeEnabled();

    // The anchor override is non-null here (an explicit prev step, not a
    // reset to null) but it resolves to today's date — Today must compare
    // the RESOLVED anchor against today, not just check for a null override.
    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(todayButton).toBeDisabled();
  });

  it('navigates prev/next/today and changes the fetched range', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(await screen.findByRole('heading', { name: 'Jun 14 – Jun 20, 2026' })).toBeInTheDocument();
    expect(mockGetEvents).toHaveBeenCalledWith('circle-1', {
      start_date: '2026-06-14',
      end_date: '2026-06-20',
    });

    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(await screen.findByRole('heading', { name: 'Jun 7 – Jun 13, 2026' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByRole('heading', { name: 'Jun 7 – Jun 13, 2026' })).toBeInTheDocument();
  });

  it('renders events with type and medication status styling', async () => {
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    // Pending/missed med blocks are SOLID clay with white text. Done events
    // (taken/skipped) use the muted soft-tint + deep-text treatment (WCAG AA —
    // never white-on-light or opacity). Status is also exposed via data attrs.
    const taken = screen.getByRole('button', { name: /Metformin/ });
    expect(taken).toHaveAttribute('data-event-type', 'medication');
    expect(taken).toHaveAttribute('data-med-status', 'taken');
    expect(taken.className).toContain('bg-clay-soft');
    expect(taken.className).toContain('text-clay-deep');
    expect(taken.className).not.toContain('text-cream');

    const missed = screen.getByRole('button', { name: /Lisinopril/ });
    expect(missed).toHaveAttribute('data-med-status', 'missed');
    expect(missed.className).toContain('bg-clay');
    expect(missed.className).toContain('text-cream');

    const pending = screen.getByRole('button', { name: /Vitamin D/ });
    expect(pending).toHaveAttribute('data-med-status', 'pending');
    expect(pending.className).toContain('text-cream');

    const skipped = screen.getByRole('button', { name: /Aspirin/ });
    expect(skipped).toHaveAttribute('data-med-status', 'skipped');
    expect(skipped.className).toContain('bg-clay-soft');
    expect(skipped.className).toContain('text-clay-deep');

    const appointment = screen.getByRole('button', { name: /Dr\. Smith/ });
    expect(appointment).toHaveAttribute('data-event-type', 'appointment');
    expect(appointment).not.toHaveAttribute('data-med-status');

    // All-day task renders in the all-day row
    const task = screen.getByRole('button', { name: /Pick up groceries/ });
    expect(task).toHaveAttribute('data-event-type', 'task');
  });

  it('shows the current-time indicator only on today (in the recipient timezone)', async () => {
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    const indicators = screen.getAllByTestId('current-time-indicator');
    expect(indicators).toHaveLength(1);
    expect(indicators[0].closest('[data-date]')).toHaveAttribute('data-date', '2026-06-12');
  });

  it('opens the detail modal with event details and manages focus', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    const trigger = screen.getByRole('button', { name: /Dr\. Smith/ });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Dr\. Smith/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Appointment')).toBeInTheDocument();
    expect(within(dialog).getByText('Friday, June 12, 2026')).toBeInTheDocument();
    expect(within(dialog).getByText(/2:00 PM \(Chicago\)/)).toBeInTheDocument();
    expect(within(dialog).getByText('Clinic')).toBeInTheDocument();
    expect(within(dialog).getByText('Bring insurance card')).toBeInTheDocument();
    // Read-only: download-the-app CTA in the footer slot
    expect(within(dialog).getByText('Get the full experience.')).toBeInTheDocument();

    // Focus moved into the dialog (close button)
    const closeButton = within(dialog).getByRole('button', { name: 'Close event details' });
    expect(closeButton).toHaveFocus();

    // Escape closes and focus returns to the trigger
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('shows the rich empty state when the window has no events', async () => {
    mockGetEvents.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No events this week')).toBeInTheDocument();
    // Read-only viewer (can_edit: false) sees the descriptive hint, no Add CTA.
    expect(
      screen.getByText("When the care team adds medications or appointments, they'll show up here.")
    ).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('shows the error state and recovers on retry', async () => {
    // Both the calendar window AND the GettingStartedChecklist's wide-window
    // presence query call getEvents — reject ALL calls (not once) so the
    // calendar's own query actually lands in its error state.
    mockGetEvents.mockRejectedValue(new Error('network down'));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText("Couldn't load the calendar")).toBeInTheDocument();

    mockGetEvents.mockResolvedValue(EVENTS);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('grid', { name: 'Week view calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Metformin/ })).toBeInTheDocument();
  });

  it('month view: clicking a day opens the side panel with that day’s events', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    await user.click(screen.getByRole('tab', { name: 'Month' }));
    await screen.findByRole('grid', { name: 'Month view calendar' });

    // Day cell aria-label includes the date and event count (Jun 12 has 4)
    const dayCell = screen.getByRole('button', { name: 'Friday, June 12, 4 events' });
    await user.click(dayCell);
    expect(dayCell).toHaveAttribute('aria-pressed', 'true');

    const panel = screen.getByRole('complementary', { name: 'Events for the selected day' });
    expect(within(panel).getByText('Friday, June 12')).toBeInTheDocument();
    const panelEvent = within(panel).getByRole('button', { name: /Metformin/ });

    // Click-through to the detail modal
    await user.click(panelEvent);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Metformin/ })).toBeInTheDocument();
    expect(within(dialog).getByText('Taken at 8:05 AM (Chicago)')).toBeInTheDocument();
  });

  // The point of the device-aware clock: a 24h viewer must see 24-hour times on
  // EVERY calendar surface. This walks week chip → detail modal → month panel
  // so an un-wired surface fails here rather than shipping silently in 12h.
  it('renders the week chip, detail modal, and month panel in 24-hour time', async () => {
    mockUseHourCycle.mockReturnValue('24h');
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    // WeekView chip → formatEventTimeCompact
    const trigger = screen.getByRole('button', { name: /Vitamin D, Medication, 20:00 \(Chicago\)/ });
    expect(screen.queryByRole('button', { name: /8:00 PM \(Chicago\)/ })).not.toBeInTheDocument();

    // EventDetailModal → formatEventTimeForDisplay (dual: Chicago + New_York)
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('20:00 (Chicago) / 21:00 (New York)')).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });

    // MonthView side panel → formatEventTimeCompact
    await user.click(screen.getByRole('tab', { name: 'Month' }));
    await screen.findByRole('grid', { name: 'Month view calendar' });
    await user.click(screen.getByRole('button', { name: 'Friday, June 12, 4 events' }));
    const panel = screen.getByRole('complementary', { name: 'Events for the selected day' });
    expect(
      within(panel).getByRole('button', { name: /Metformin, Medication, 08:00 \(Chicago\)/ })
    ).toBeInTheDocument();
  });

  // ==========================================================================
  // A dose of an INACTIVE medication is still loggable from the calendar
  // --------------------------------------------------------------------------
  // The calendar fetches WITHOUT `includeDiscontinued`, and the backend keeps
  // only the occurrences that were DUE before the stop instant — so everything
  // the grid shows is confirmable. Suppressing the control here (the earlier
  // behaviour) meant a dose really given but not yet logged when the medication
  // was stopped could never be logged, and stayed scheduled-and-missed in the
  // adherence report a clinician reads.
  // ==========================================================================
  it('logs a dose of an INACTIVE medication from the calendar detail modal', async () => {
    const user = userEvent.setup();
    mockGetMembersCircleDetail.mockResolvedValue({ ...MEMBERS_DETAIL, can_edit: true });
    mockGetEvents.mockResolvedValue([
      makeEvent({
        id: 'ev-inactive',
        title: 'Warfarin',
        medication_name: 'Warfarin',
        medication_dosage: '5mg',
        // Yesterday in the recipient timezone, before the stop instant below —
        // exactly the dose the backend still returns and still accepts.
        scheduled_date: '2026-06-11',
        scheduled_time: '08:00:00',
        discontinued_at: '2026-06-11T18:00:00Z',
        confirmation: null,
      }),
    ]);

    renderEditablePage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    // The chip says "Inactive" in TEXT, in its accessible name — never colour
    // alone (WCAG 2.1 AA 1.4.1). That does not change here.
    const chip = await screen.findByRole('button', { name: /Warfarin.*Inactive/ });
    await user.click(chip);

    const detail = await screen.findByRole('dialog');
    expect(within(detail).getByText('Inactive')).toBeInTheDocument();

    // ...and the dose can still be answered.
    await user.click(within(detail).getByRole('button', { name: 'Mark taken' }));

    // The detail modal steps aside so the confirm dialog is never a modal
    // inside a modal (two focus traps fighting over Tab/Escape).
    expect(
      await screen.findByRole('dialog', { name: 'Confirm medication' })
    ).toBeInTheDocument();
  });

  // The masthead's right action renders TWICE (spec §5.4: the round chrome
  // control below xl, a labelled button at xl) — both must open the same
  // AddEventModal, and neither renders at all for a read-only member.
  it("masthead right action opens AddEventModal, and is absent when the viewer can't edit", async () => {
    const user = userEvent.setup();
    mockGetMembersCircleDetail.mockResolvedValue({ ...MEMBERS_DETAIL, can_edit: true });
    renderEditablePage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    const addButtons = screen.getAllByRole('button', { name: 'Add event' });
    expect(addButtons).toHaveLength(2);
    await user.click(addButtons[0]);
    expect(await screen.findByRole('dialog', { name: 'New event' })).toBeInTheDocument();
  });

  it('renders no masthead Add-event action for a read-only member', async () => {
    renderPage();
    await screen.findByRole('grid', { name: 'Week view calendar' });

    expect(screen.queryByRole('button', { name: 'Add event' })).not.toBeInTheDocument();
  });
});
