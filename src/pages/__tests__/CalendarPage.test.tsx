import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import CalendarPage from '../CalendarPage';
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
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'false');

    // Times shown in the CARE RECIPIENT's timezone
    expect(screen.getByText('Times shown in Central Time (CT)')).toBeInTheDocument();

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

    await user.click(screen.getByRole('button', { name: 'Month' }));

    expect(await screen.findByRole('grid', { name: 'Month view calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('heading', { name: 'June 2026' })).toBeInTheDocument();

    expect(mockGetEvents).toHaveBeenCalledWith('circle-1', {
      start_date: '2026-05-31',
      end_date: '2026-07-11',
    });
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
    expect(within(dialog).getByText(/2:00 PM CT/)).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: 'Month' }));
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
    expect(within(dialog).getByText('Taken at 8:05 AM')).toBeInTheDocument();
  });
});
