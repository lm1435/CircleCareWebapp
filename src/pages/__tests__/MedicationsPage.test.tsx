import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import MedicationsPage from '../MedicationsPage';
import type { CalendarEvent } from '@/api/calendarEvents';

// Pin the "device" timezone. A rendered time is labelled with the care
// recipient's zone only when the VIEWER is elsewhere, so without this the
// assertions below would depend on the machine running the suite (the dev
// machine is America/Denver; CI is not). Only getDeviceTimezone reads
// resolvedOptions — format/formatToParts are unaffected.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Denver',
} as Intl.ResolvedDateTimeFormatOptions);


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

// The History tab's two queries. Pinned so this page test needs no
// QueryClientProvider; the History tab's own behaviour is covered by
// AdherenceHero / HistoryList / MedicationFilter's tests.
const mockUseMedicationConfirmations = vi.fn();
const mockUseAdherenceReport = vi.fn();
vi.mock('@/hooks/useMedConfirmation', () => ({
  useMedicationConfirmations: (circleId: string, params: unknown, options: unknown) =>
    mockUseMedicationConfirmations(circleId, params, options),
  useAdherenceReport: (circleId: string, period: string) =>
    mockUseAdherenceReport(circleId, period),
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

function renderPage(entry = '/circles/circle-1/meds') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/circles/:circleId/meds" element={<MedicationsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/**
 * The roster's three actions moved behind ONE overflow menu (spec §6.4), so
 * every action assertion is now "open this medication's menu, then choose".
 * The trigger is named after the medication — that name is the only thing
 * telling two identical "Edit" items apart.
 */
async function chooseAction(
  user: ReturnType<typeof userEvent.setup>,
  medication: string,
  action: string
) {
  await user.click(screen.getByRole('button', { name: `More actions for ${medication}` }));
  await user.click(screen.getByRole('menuitem', { name: action }));
}

/**
 * A tab of the PAGE's own Medications · History control.
 *
 * Scoped by tablist: `CareTabs` sits right above it with its own "Medications"
 * tab (Calendar · Meds · Tasks · Notes), so an unscoped query for that name
 * matches two controls that navigate to different places.
 */
function pageTab(name: 'Medications' | 'History'): HTMLElement {
  return within(screen.getByRole('tablist', { name: 'Medications' })).getByRole('tab', { name });
}

/** One history row, enough for the filter menu to name a medication. */
function conf(id: string, medication: string) {
  return {
    id,
    event_id: id,
    circle_id: 'circle-1',
    confirmed_by: 'u1',
    confirmed_at: '2026-09-05T14:00:00Z',
    status: 'taken' as const,
    scheduled_time: '08:00:00',
    confirmed_by_user: { email: 'ana@example.com', first_name: 'Ana', last_name: 'Ruiz' },
    event: {
      id,
      title: medication,
      medication_name: medication,
      medication_dosage: '5 mg',
      scheduled_date: '2026-09-05',
    },
  };
}

function historyPage(confirmations: ReturnType<typeof conf>[]) {
  return {
    data: { confirmations, hasMore: false },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseHourCycle.mockReturnValue('12h');
  mockUseCircle.mockReturnValue({ canEdit: true, timezone: 'America/New_York' });
  mockUseMedicationRoster.mockReturnValue(rosterResult([activeMed, inactiveMed]));
  mockStatusMutateAsync.mockResolvedValue({ discontinued: false, affected_count: 1, series_count: 1 });
  mockUseMedicationConfirmations.mockReturnValue({
    data: { confirmations: [], hasMore: false },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  });
  mockUseAdherenceReport.mockReturnValue({ data: undefined, isPending: false, isError: false });
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
  it('offers no dose-confirmation control on either section — this roster is not a calendar surface', async () => {
    const user = userEvent.setup();
    renderPage();

    for (const label of ['Mark taken', 'Skip dose', 'Confirm', 'Skip']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    // ...while the medication-level action set is intact on the inactive card.
    const inactiveSection = screen.getByRole('region', { name: 'Inactive / Past medications' });
    await user.click(
      within(inactiveSection).getByRole('button', { name: 'More actions for Lisinopril' })
    );
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reactivate' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    // Still no way to answer a DOSE from here.
    expect(screen.queryByRole('menuitem', { name: /taken/i })).toBeNull();
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

    await chooseAction(user, 'Metformin', 'Edit');
    const dialog = screen.getByRole('dialog', { name: 'add-event-modal' });
    expect(dialog).toHaveTextContent('editing-active-1');
  });

  it('Edit on an INACTIVE med shows the reactivate-first prompt instead of the editor', async () => {
    const user = userEvent.setup();
    renderPage();

    await chooseAction(user, 'Lisinopril', 'Edit');

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

    await chooseAction(user, 'Metformin', 'Discontinue');
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
    await chooseAction(user, 'Metformin', 'Edit');
    expect(screen.getByRole('dialog', { name: 'add-event-modal' })).toHaveTextContent(
      'editing-root-active'
    );

    // Discontinue passes the GROUP's inactive flag (false — overall Active),
    // not the representative event's own (also now active, since the
    // representative IS the active root — this assertion is the load-bearing
    // one: it fails if the representative ever regresses to the discontinued
    // root).
    await chooseAction(user, 'Metformin', 'Discontinue');
    const dialog = screen.getByRole('dialog', { name: 'discontinue-med-dialog' });
    expect(dialog).toHaveTextContent('status-root-active-roster-2-group-inactive-false');
  });

  it('Delete opens the shared DeleteEventDialog flow', async () => {
    const user = userEvent.setup();
    renderPage();

    await chooseAction(user, 'Metformin', 'Delete');
    const dialog = screen.getByRole('dialog', { name: 'delete-event-dialog' });
    expect(dialog).toHaveTextContent('deleting-active-1');
  });

  it('hides ALL write affordances when canEdit is false', () => {
    mockUseCircle.mockReturnValue({ canEdit: false, timezone: 'America/New_York' });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Add medication' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More actions for/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
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
    expect(screen.getByText('8:00 AM (New York) · 8:00 PM (New York) · Daily')).toBeInTheDocument();
    unmount();

    mockUseHourCycle.mockReturnValue('24h');
    renderPage();
    expect(screen.getByText('08:00 (New York) · 20:00 (New York) · Daily')).toBeInTheDocument();
    expect(screen.queryByText(/8:00 PM ET/)).not.toBeInTheDocument();
  });

  // ── Low-stock badge (mobile parity) ──────────────────────────────────────
  // The web roster showed no stock signal at all while mobile's roster carried
  // a "Low stock · N days left" pill, so the same medication read as fine on
  // one platform and urgent on the other. The data was already on the wire —
  // `quantity_remaining` / `pills_per_day` ship on the roster response and were
  // simply never read here.
  describe('low-stock badge', () => {
    it('shows "Low stock · N days left" once supply drops under 14 days', () => {
      // 24 pills at 2/day = 12 days — under the threshold.
      mockUseMedicationRoster.mockReturnValue(
        rosterResult([makeMed({ id: 'low-1', quantity_remaining: 24, pills_per_day: 2 })])
      );
      renderPage();

      expect(screen.getByText(/Low stock · 12 days left/)).toBeInTheDocument();
    });

    it('stays silent above the threshold and when the med is not refill-tracked', () => {
      // 40 at 2/day = 20 days — comfortably stocked.
      mockUseMedicationRoster.mockReturnValue(
        rosterResult([
          makeMed({ id: 'stocked-1', quantity_remaining: 40, pills_per_day: 2 }),
          // No counters at all — the badge must not appear from nowhere, and
          // must never render as "Low stock · NaN days left".
          makeMed({ id: 'untracked-1', title: 'Aspirin', medication_name: 'Aspirin' }),
        ])
      );
      renderPage();

      expect(screen.queryByText(/Low stock/)).not.toBeInTheDocument();
      expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });

    it('singularises the countdown at one day left', () => {
      mockUseMedicationRoster.mockReturnValue(
        rosterResult([makeMed({ id: 'low-2', quantity_remaining: 2, pills_per_day: 2 })])
      );
      renderPage();

      expect(screen.getByText(/Low stock · 1 day left/)).toBeInTheDocument();
    });

    // REGRESSION — a multi-dose med is ONE card built from several series, and
    // only the refill-group primary row carries the bottle; its siblings are
    // written with no counter on purpose. `representativeScore` picks the
    // Edit/Delete target, which is often one of those empty siblings, so
    // reading stock off the representative hid the badge on exactly the
    // multi-dose meds that run out fastest. Stock is aggregated over the group.
    it('reads stock across the whole group, not off the representative row', () => {
      const primary = makeMed({
        id: 'multi-primary',
        // NOT a series root, so representativeScore prefers the sibling below.
        parent_event_id: 'parent-1',
        scheduled_time: '08:00:00',
        quantity_remaining: 12,
        pills_per_day: 2,
      });
      const sibling = makeMed({
        id: 'multi-sibling',
        parent_event_id: null,
        scheduled_time: '20:00:00',
        quantity_remaining: undefined,
        pills_per_day: undefined,
      });
      mockUseMedicationRoster.mockReturnValue(rosterResult([primary, sibling]));
      renderPage();

      // One card, both times, and the badge sourced from the non-representative
      // row: 12 / 2 = 6 days.
      expect(screen.getByText(/8:00 AM \(New York\) · 8:00 PM \(New York\)/)).toBeInTheDocument();
      expect(screen.getByText(/Low stock · 6 days left/)).toBeInTheDocument();
    });

    // A stopped medication has no future to run out in — "Low stock · 3 days
    // left" describes a schedule that no longer runs. The INACTIVE badge owns
    // this slot instead, exactly as on mobile.
    it('never marks a discontinued medication low, even with an empty bottle', () => {
      mockUseMedicationRoster.mockReturnValue(
        rosterResult([
          makeMed({
            id: 'stopped-1',
            title: 'Warfarin',
            medication_name: 'Warfarin',
            discontinued_at: '2026-07-01T12:00:00Z',
            quantity_remaining: 2,
            pills_per_day: 2,
          }),
        ])
      );
      renderPage();

      expect(screen.getByText('Inactive')).toBeInTheDocument();
      expect(screen.queryByText(/Low stock/)).not.toBeInTheDocument();
    });

    /**
     * THE MIXED GROUP — a stopped row and a live row under ONE card.
     *
     * The guard above is the WHOLE-GROUP one (`!group.inactive`), and it cannot
     * see this: `getMedKey` keys on name + dosage, so re-adding a medication at
     * the same dose lands the new bottle in the same group as the old one, and a
     * single live row makes the group Active. The aggregation then took the
     * MINIMUM across every row in it — including the stopped one, whose counter
     * froze at whatever was left the day it was stopped.
     *
     * That is the exact claim the card's own comment forbids ("A STOPPED
     * MEDICATION IS NEVER LOW"), made about a bottle that is full.
     */
    it('ignores a discontinued series’ leftover count when a live one shares the card', () => {
      const stopped = makeMed({
        id: 'warfarin-stopped',
        title: 'Warfarin',
        medication_name: 'Warfarin',
        medication_dosage: '5 mg',
        discontinued_at: '2026-07-01T12:00:00Z',
        // Four tablets were left in the old bottle when it was stopped. The
        // column never moves again — nothing decrements a stopped series.
        quantity_remaining: 4,
        pills_per_day: 1,
      });
      const reAdded = makeMed({
        id: 'warfarin-active',
        title: 'Warfarin',
        medication_name: 'Warfarin',
        medication_dosage: '5 mg',
        discontinued_at: null,
        // A fresh 90-count bottle: three months of supply, in the house.
        quantity_remaining: 90,
        pills_per_day: 1,
      });
      mockUseMedicationRoster.mockReturnValue(rosterResult([stopped, reAdded]));
      renderPage();

      // One Active card, and no low-stock claim: 90 days of supply.
      expect(screen.queryByText('Inactive')).not.toBeInTheDocument();
      expect(screen.queryByText(/Low stock/)).not.toBeInTheDocument();
    });

    /**
     * The companion that keeps the fix from being "never aggregate": the LIVE
     * row still has to be able to raise the badge on its own.
     */
    it('still badges the live series in a mixed group when the live bottle runs low', () => {
      const stopped = makeMed({
        id: 'warfarin-stopped-2',
        title: 'Warfarin',
        medication_name: 'Warfarin',
        medication_dosage: '5 mg',
        discontinued_at: '2026-07-01T12:00:00Z',
        quantity_remaining: 400,
        pills_per_day: 1,
      });
      const reAdded = makeMed({
        id: 'warfarin-active-2',
        title: 'Warfarin',
        medication_name: 'Warfarin',
        medication_dosage: '5 mg',
        discontinued_at: null,
        quantity_remaining: 6,
        pills_per_day: 1,
      });
      mockUseMedicationRoster.mockReturnValue(rosterResult([stopped, reAdded]));
      renderPage();

      expect(screen.getByText(/Low stock · 6 days left/)).toBeInTheDocument();
    });

    // The badge lives in `careCardBadgeRow` — the row directly beneath the
    // name, the slot the INACTIVE badge already uses — NOT pinned to the far
    // edge of the card. Mobile's roster had it floating right, vertically
    // wedged between the drug name and the schedule line, and it read as a
    // detached, colliding mark.
    it('sits in the badge row under the name, not pinned to the edge of the card', () => {
      mockUseMedicationRoster.mockReturnValue(
        rosterResult([makeMed({ id: 'low-3', quantity_remaining: 24, pills_per_day: 2 })])
      );
      renderPage();

      const badge = screen.getByText(/Low stock · 12 days left/);
      const badgeRow = badge.parentElement as HTMLElement;
      const textColumn = badgeRow.parentElement as HTMLElement;

      // Same text column as the name; the badge row follows the name in
      // reading order, so a screen reader and the eye both get name → status.
      const name = within(textColumn).getByRole('button', {
        name: /View details for Metformin/,
      });
      const order = Array.from(textColumn.children);
      expect(order.indexOf(badgeRow)).toBeGreaterThan(order.indexOf(name));

      // Nothing pushes the badge itself to the far edge. `ml-auto` /
      // `justify-end` / `absolute` are how the mobile version ended up
      // detached.
      const cls = badge.className;
      expect(cls).not.toMatch(/\bml-auto\b/);
      expect(cls).not.toMatch(/\bjustify-end\b/);
      expect(cls).not.toMatch(/\babsolute\b/);
    });
  });

  // ── Tabs ────────────────────────────────────────────────────────────────
  //
  // MEDICATIONS · HISTORY (spec §6.4), with the choice in the URL so a reload
  // — or a shared link — lands where the caregiver was.
  describe('Medications · History tabs', () => {
    it('opens on the roster and switches to History from the segmented control', async () => {
      const user = userEvent.setup();
      renderPage();

      expect(screen.getByRole('region', { name: 'Active' })).toBeInTheDocument();

      await user.click(screen.getByRole('tab', { name: 'History' }));

      expect(screen.queryByRole('region', { name: 'Active' })).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      // The page's own copy of the query (the filter's options) only runs once
      // the tab is actually showing. HistoryList issues the same query without
      // options — React Query dedupes the two onto one fetch.
      expect(mockUseMedicationConfirmations).toHaveBeenCalledWith(
        'circle-1',
        expect.objectContaining({ start_date: expect.any(String), end_date: expect.any(String) }),
        { enabled: true }
      );
    });

    it('restores the History tab from ?tab=history on first render', () => {
      renderPage('/circles/circle-1/meds?tab=history');

      expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.queryByRole('region', { name: 'Active' })).not.toBeInTheDocument();
      expect(screen.getByText('No medication history')).toBeInTheDocument();
    });

    it('leaves the history queries idle while the roster tab is showing', () => {
      renderPage();
      expect(mockUseMedicationConfirmations).toHaveBeenLastCalledWith(
        'circle-1',
        expect.anything(),
        { enabled: false }
      );
    });

    it('asks the confirmations endpoint for the last 30 days in the CIRCLE timezone', () => {
      // Kiritimati is UTC+14 — a zone where the recipient's "today" is a
      // different calendar day from the viewer's for ten hours out of every
      // twenty-four. Reading the window off the device would silently shift it.
      mockUseCircle.mockReturnValue({ canEdit: true, timezone: 'Pacific/Kiritimati' });
      renderPage('/circles/circle-1/meds?tab=history');

      const params = mockUseMedicationConfirmations.mock.calls.at(-1)?.[1] as {
        start_date: string;
        end_date: string;
      };
      const expectedEnd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Pacific/Kiritimati',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
      expect(params.end_date).toBe(expectedEnd);
      // 29 days back plus today = the 30 local days the adherence hero reports.
      const spanDays =
        (Date.parse(`${params.end_date}T00:00:00Z`) -
          Date.parse(`${params.start_date}T00:00:00Z`)) /
        86400000;
      expect(spanDays).toBe(29);
    });
  });

  // A FILTER THAT AGES OUT MUST NOT STAY ON SILENTLY.
  //
  // The filter holds a medication NAME and the options come from the loaded
  // 30-day history. When a medication scrolls out of that window the name is
  // still selected with no option to match it, so the trigger falls back to
  // "All medications" while the list is STILL filtering by the vanished name —
  // an empty history under a control that says nothing is filtered.
  describe('a filter whose medication ages out', () => {
    it('resets to All medications, and the list stops filtering', async () => {
      const user = userEvent.setup();
      mockUseMedicationConfirmations.mockReturnValue(
        historyPage([conf('c1', 'Metformin'), conf('c2', 'Warfarin')])
      );
      renderPage('/circles/circle-1/meds?tab=history');

      await user.click(screen.getByRole('button', { name: 'Filter by: All medications' }));
      await user.click(screen.getByRole('menuitem', { name: 'Warfarin' }));

      expect(screen.getByRole('button', { name: 'Filter by: Warfarin' })).toBeInTheDocument();
      expect(screen.queryByText('Metformin')).toBeNull();

      // Warfarin's last dose ages past the window.
      mockUseMedicationConfirmations.mockReturnValue(historyPage([conf('c1', 'Metformin')]));
      await user.click(pageTab('Medications'));
      await user.click(pageTab('History'));

      expect(
        screen.getByRole('button', { name: 'Filter by: All medications' })
      ).toBeInTheDocument();
      // …and the list is genuinely unfiltered, not filtered by a ghost.
      expect(screen.getByText('Metformin')).toBeInTheDocument();
      expect(screen.queryByText('No medication history')).toBeNull();
    });

    it('keeps a filter that is still in the options', async () => {
      const user = userEvent.setup();
      mockUseMedicationConfirmations.mockReturnValue(
        historyPage([conf('c1', 'Metformin'), conf('c2', 'Warfarin')])
      );
      renderPage('/circles/circle-1/meds?tab=history');

      await user.click(screen.getByRole('button', { name: 'Filter by: All medications' }));
      await user.click(screen.getByRole('menuitem', { name: 'Warfarin' }));

      await user.click(pageTab('Medications'));
      await user.click(pageTab('History'));

      expect(screen.getByRole('button', { name: 'Filter by: Warfarin' })).toBeInTheDocument();
    });

    // An empty option list mid-fetch is not an aged-out filter. Resetting on it
    // would clear the reader's choice on every refetch — so the choice has to
    // SURVIVE a pending frame and still be there when the rows come back.
    it('survives a refetch instead of resetting on the empty frame', async () => {
      const user = userEvent.setup();
      const loaded = historyPage([conf('c1', 'Metformin'), conf('c2', 'Warfarin')]);
      mockUseMedicationConfirmations.mockReturnValue(loaded);
      renderPage('/circles/circle-1/meds?tab=history');

      await user.click(screen.getByRole('button', { name: 'Filter by: All medications' }));
      await user.click(screen.getByRole('menuitem', { name: 'Warfarin' }));

      // Refetch: no data for a frame…
      mockUseMedicationConfirmations.mockReturnValue({
        ...historyPage([]),
        isPending: true,
        data: undefined,
      });
      await user.click(pageTab('Medications'));
      await user.click(pageTab('History'));

      // …then the same rows return. Warfarin must still be the filter: if the
      // effect had reset on the empty frame, this would read "All medications".
      mockUseMedicationConfirmations.mockReturnValue(loaded);
      await user.click(pageTab('Medications'));
      await user.click(pageTab('History'));

      expect(screen.getByRole('button', { name: 'Filter by: Warfarin' })).toBeInTheDocument();
    });
  });

  // ── Accessibility ───────────────────────────────────────────────────────
  describe('heading outline', () => {
    // The masthead title is the page's h1 and the day groups inside the list
    // are h3, so without a heading for the TAB itself the History view jumped
    // h1 -> h3: an axe `heading-order` violation, and a screen-reader user
    // navigating by heading arrived at "Today" with nothing naming the list.
    it('gives the History tab an h2 between the page title and the day groups', () => {
      renderPage('/circles/circle-1/meds?tab=history');

      const heading = screen.getByRole('heading', { level: 2, name: 'Medication history' });
      // Visually hidden: the segmented control right above already says
      // "History" on screen, so this is outline structure, not a second title.
      expect(heading.className).toContain('sr-only');
    });

    // The roster tab needs no equivalent — its section headers already ARE the
    // h2 level, and a second one would be noise.
    it('uses the ACTIVE / INACTIVE section headers as the roster tab’s h2s', () => {
      renderPage();

      expect(
        screen.getByRole('heading', { level: 2, name: 'Active' })
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { level: 2, name: 'Medication history' })
      ).toBeNull();
    });
  });

  // The detail sheet printed the recurrence twice: the page handed it the roster's
  // full schedule line ("8:00 AM · Daily") right above its own Repeat row. The
  // page now passes the dose times alone, so the recurrence appears once.
  it('opens the detail sheet with the recurrence shown once, in its Repeat row', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'View details for Metformin' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getAllByText(/\bDaily\b/)).toHaveLength(1);
    expect(within(dialog).queryByText(/·\s*Daily/)).toBeNull();
  });

  // WCAG 2.5.5 / 2.5.8. The name is the card's only way into the medication and
  // it used to be the bare title's own text box — a ~21px strip to hit exactly.
  it('gives the medication name a 44px-tall target spanning the name column', () => {
    renderPage();

    const name = screen.getByRole('button', { name: 'View details for Metformin' });
    expect(name.className).toContain('min-h-[44px]');
    // Full width of the name column, so a short name is no harder to hit than
    // a long one, and centred so the type metrics do not move.
    expect(name.className).toContain('w-full');
    expect(name.className).toContain('items-center');
    // …and it is still the same 16/500 title, not a resized one.
    expect(name.className).toContain('text-md');
  });

  // ── Narrow viewport (390px) ─────────────────────────────────────────────
  //
  // The three inline action pills are what broke this row at phone width: the
  // name column had nothing telling it it could shrink, so the pills pushed it
  // wider than the card. One menu button replaces them, and the two classes
  // below are the contract that keeps the row intact.
  it('keeps the name column shrinkable and the menu button fixed at 390px', () => {
    mockUseMedicationRoster.mockReturnValue(
      rosterResult([
        makeMed({
          id: 'long-1',
          title: 'Hydrochlorothiazide-Lisinopril',
          medication_name: 'Hydrochlorothiazide-Lisinopril',
        }),
      ])
    );
    renderPage();

    const name = screen.getByRole('button', {
      name: /View details for Hydrochlorothiazide-Lisinopril/,
    });
    const textColumn = name.parentElement as HTMLElement;
    expect(textColumn.className).toMatch(/\bmin-w-0\b/);
    expect(textColumn.className).toMatch(/\bflex-1\b/);

    const menu = screen.getByRole('button', {
      name: 'More actions for Hydrochlorothiazide-Lisinopril',
    });
    // The trigger's positioning wrapper is what carries the sizing classes.
    expect((menu.parentElement as HTMLElement).className).toMatch(/\bshrink-0\b/);
  });
});
