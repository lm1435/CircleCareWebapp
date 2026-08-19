import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import MedicationsPage from '../MedicationsPage';
import type { CalendarEvent } from '@/api/calendarEvents';

// Stage 17 — MedicationsPage tests: Active/Inactive split from a mixed roster,
// inactive section only when non-empty, and the reactivate-first guard when
// editing an inactive medication.

const mockUseMedicationRoster = vi.fn();
const mockStatusMutateAsync = vi.fn();
const mockUseCircle = vi.fn();

vi.mock('@/hooks/useCalendarEvents', () => ({
  useMedicationRoster: (circleId: string) => mockUseMedicationRoster(circleId),
  useMedicationStatus: () => ({ mutateAsync: mockStatusMutateAsync, isPending: false }),
}));

vi.mock('@/hooks/useCircle', () => ({
  useCircle: (circleId: string) => mockUseCircle(circleId),
}));

// The viewer's 12h/24h clock. The real hook reads the shared currentUser React
// Query — pin it so this page test needs no QueryClientProvider and the
// schedule line is deterministic instead of following navigator.language.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

// Stub the write modals — assert open/close via sentinels, not the real forms.
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({ event }: { event?: CalendarEvent | null }) => (
    <div role="dialog" aria-label="add-event-modal">
      {event ? `editing-${event.id}` : 'creating'}
    </div>
  ),
}));
vi.mock('@/components/calendar/DeleteEventDialog', () => ({
  DeleteEventDialog: ({ event }: { event: CalendarEvent }) => (
    <div role="dialog" aria-label="delete-event-dialog">
      deleting-{event.id}
    </div>
  ),
}));
vi.mock('@/components/calendar/DiscontinueMedDialog', () => ({
  DiscontinueMedDialog: ({
    event,
    events,
    groupInactive,
  }: {
    event: CalendarEvent;
    events?: CalendarEvent[];
    groupInactive?: boolean;
  }) => (
    <div role="dialog" aria-label="discontinue-med-dialog">
      status-{event.id}-roster-{events?.length ?? 0}-group-inactive-{String(groupInactive)}
    </div>
  ),
}));

function makeMed(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'm-1',
    circle_id: 'circle-1',
    event_type: 'medication',
    title: 'Metformin',
    medication_name: 'Metformin',
    medication_dosage: '500 mg',
    discontinued_at: null,
    scheduled_date: '2026-07-29',
    scheduled_time: '08:00:00',
    recurrence_rule: 'daily',
    parent_event_id: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  } as CalendarEvent;
}

const activeMed = makeMed({ id: 'active-1' });
const inactiveMed = makeMed({
  id: 'inactive-1',
  title: 'Lisinopril',
  medication_name: 'Lisinopril',
  medication_dosage: '10 mg',
  discontinued_at: '2026-07-01T12:00:00Z',
});

function rosterResult(events: CalendarEvent[], overrides: Record<string, unknown> = {}) {
  return {
    events,
    data: events,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/circles/circle-1/meds']}>
      <Routes>
        <Route path="/circles/:circleId/meds" element={<MedicationsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseHourCycle.mockReturnValue('12h');
  mockUseCircle.mockReturnValue({ canEdit: true, timezone: 'America/New_York' });
  mockUseMedicationRoster.mockReturnValue(rosterResult([activeMed, inactiveMed]));
  mockStatusMutateAsync.mockResolvedValue({ discontinued: false, affected_count: 1, series_count: 1 });
});

describe('MedicationsPage', () => {
  it('renders Active and Inactive sections from a mixed roster', () => {
    renderPage();

    const activeSection = screen.getByRole('region', { name: 'Active' });
    expect(within(activeSection).getByText('Metformin')).toBeInTheDocument();

    const inactiveSection = screen.getByRole('region', { name: 'Inactive / Past medications' });
    expect(within(inactiveSection).getByText('Lisinopril')).toBeInTheDocument();
    expect(within(inactiveSection).getByText('Inactive')).toBeInTheDocument();
  });

  // THE ROSTER/CALENDAR DISTINCTION. This page is the one web surface that
  // fetches with `includeDiscontinued=true`, so it can hold occurrences that
  // were never DUE — a confirm on one of those is exactly the 409 the backend
  // still returns. It therefore carries NO dose-confirmation control, on either
  // section, while calendar surfaces (which fetch due-only) do. If a "Mark
  // taken" ever appears here, that predicate has been broken.
  it('offers no dose-confirmation control on either section — this roster is not a calendar surface', () => {
    renderPage();

    for (const label of ['Mark taken', 'Skip dose', 'Confirm', 'Skip']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    // ...while the medication-level action set is intact on the inactive card.
    const inactiveSection = screen.getByRole('region', { name: 'Inactive / Past medications' });
    expect(
      within(inactiveSection).getByRole('button', { name: 'Edit Lisinopril' })
    ).toBeInTheDocument();
    expect(
      within(inactiveSection).getByRole('button', { name: 'Reactivate Lisinopril' })
    ).toBeInTheDocument();
    expect(
      within(inactiveSection).getByRole('button', { name: 'Delete Lisinopril' })
    ).toBeInTheDocument();
  });

  it('omits the Inactive section entirely when every med is active', () => {
    mockUseMedicationRoster.mockReturnValue(rosterResult([activeMed]));
    renderPage();

    expect(screen.getByRole('region', { name: 'Active' })).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Inactive / Past medications' })
    ).not.toBeInTheDocument();
  });

  it('groups multiple series of the same name + dose into ONE card', () => {
    const evening = makeMed({ id: 'active-2', scheduled_time: '20:00:00' });
    mockUseMedicationRoster.mockReturnValue(rosterResult([activeMed, evening]));
    renderPage();

    expect(screen.getAllByText('Metformin')).toHaveLength(1);
  });

  it('Edit on an ACTIVE med opens the edit modal directly', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit Metformin' }));
    const dialog = screen.getByRole('dialog', { name: 'add-event-modal' });
    expect(dialog).toHaveTextContent('editing-active-1');
  });

  it('Edit on an INACTIVE med shows the reactivate-first prompt instead of the editor', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Edit Lisinopril' }));

    // Guard prompt, not the edit modal.
    expect(screen.queryByRole('dialog', { name: 'add-event-modal' })).not.toBeInTheDocument();
    expect(
      screen.getByText('This medication is inactive. Reactivate it to make changes.')
    ).toBeInTheDocument();

    // Confirming reactivates the WHOLE medication in one server-scoped call.
    await user.click(screen.getByRole('button', { name: 'Reactivate' }));
    expect(mockStatusMutateAsync).toHaveBeenCalledWith({
      eventId: 'inactive-1',
      discontinued: false,
      scope: 'medication',
    });
  });

  it('Discontinue opens the shared dialog with the loaded roster (whole-med semantics)', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Discontinue Metformin' }));
    const dialog = screen.getByRole('dialog', { name: 'discontinue-med-dialog' });
    expect(dialog).toHaveTextContent('status-active-1-roster-2');
  });

  // WA3 regression: a mixed-state group (one series of a med discontinued,
  // a sibling series of the SAME name+dose still active) must pick an ACTIVE
  // series root as its representative, and the Discontinue dialog must get
  // an explicit direction from the GROUP, not the representative's own
  // status. Before the fix, the representative-selection rule only preferred
  // "is a root" and ignored discontinued_at, so the discontinued root could
  // win the representative slot; the dialog then derived direction from that
  // stale event and silently REACTIVATED when the user clicked "Discontinue"
  // on an overall-Active card.
  it('mixed-state group: prefers an ACTIVE root as the representative and passes explicit direction', async () => {
    const user = userEvent.setup();
    // Discontinued root loaded FIRST so the old "prefer root over non-root"
    // rule (which never re-examines an existing root) would keep IT as the
    // representative even once the active root arrives.
    const discontinuedRoot = makeMed({
      id: 'root-discontinued',
      scheduled_time: '08:00:00',
      discontinued_at: '2026-07-01T12:00:00Z',
    });
    const activeRoot = makeMed({ id: 'root-active', scheduled_time: '20:00:00' });
    mockUseMedicationRoster.mockReturnValue(rosterResult([discontinuedRoot, activeRoot]));
    renderPage();

    // Group is overall Active (at least one active event of this key) — it
    // must render in the Active section, not Inactive.
    const activeSection = screen.getByRole('region', { name: 'Active' });
    expect(within(activeSection).getByText('Metformin')).toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Inactive / Past medications' })
    ).not.toBeInTheDocument();

    // Edit targets the ACTIVE root, not the discontinued one.
    await user.click(screen.getByRole('button', { name: 'Edit Metformin' }));
    expect(screen.getByRole('dialog', { name: 'add-event-modal' })).toHaveTextContent(
      'editing-root-active'
    );

    // Discontinue passes the GROUP's inactive flag (false — overall Active),
    // not the representative event's own (also now active, since the
    // representative IS the active root — this assertion is the load-bearing
    // one: it fails if the representative ever regresses to the discontinued
    // root).
    await user.click(screen.getByRole('button', { name: 'Discontinue Metformin' }));
    const dialog = screen.getByRole('dialog', { name: 'discontinue-med-dialog' });
    expect(dialog).toHaveTextContent('status-root-active-roster-2-group-inactive-false');
  });

  it('Delete opens the shared DeleteEventDialog flow', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Delete Metformin' }));
    const dialog = screen.getByRole('dialog', { name: 'delete-event-dialog' });
    expect(dialog).toHaveTextContent('deleting-active-1');
  });

  it('hides ALL write affordances when canEdit is false', () => {
    mockUseCircle.mockReturnValue({ canEdit: false, timezone: 'America/New_York' });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Add medication' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Discontinue / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete / })).not.toBeInTheDocument();
    // Read view still renders both sections.
    expect(screen.getByText('Metformin')).toBeInTheDocument();
    expect(screen.getByText('Lisinopril')).toBeInTheDocument();
  });

  it('shows the empty state when there are no medications', () => {
    mockUseMedicationRoster.mockReturnValue(rosterResult([]));
    renderPage();
    expect(screen.getByText('No medications yet')).toBeInTheDocument();
  });

  // Medication-surface proof for the device-aware clock. The schedule line is
  // built by a module-level helper (formatSchedule) that takes the cycle as a
  // parameter — if that thread is ever cut, this flips back to AM/PM.
  it('renders the schedule line in the viewer’s hour cycle', () => {
    const evening = makeMed({ id: 'active-2', scheduled_time: '20:00:00' });
    mockUseMedicationRoster.mockReturnValue(rosterResult([activeMed, evening]));

    const { unmount } = renderPage();
    expect(screen.getByText('8:00 AM ET · 8:00 PM ET · Daily')).toBeInTheDocument();
    unmount();

    mockUseHourCycle.mockReturnValue('24h');
    renderPage();
    expect(screen.getByText('08:00 ET · 20:00 ET · Daily')).toBeInTheDocument();
    expect(screen.queryByText(/8:00 PM ET/)).not.toBeInTheDocument();
  });
});
