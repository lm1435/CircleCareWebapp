import { type ReactNode } from 'react';
import { render, screen, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { addDays } from '@/components/calendar/dateMath';
import { getDateInTimezone } from '@/utils/timezone';
import { GettingStartedChecklist } from '../GettingStartedChecklist';

// Focused unit test for the get-started checklist. The three data signals come
// from useCircle / useCalendarEvents / useEmergencyInfo — all mocked so we drive
// done/pending state directly. Navigation is mocked to assert the pending CTAs.
// The card is gated on CAPABILITY (`canEdit`), not ownership — there is
// deliberately no circle-age window. The default fixture is an owner-viewed,
// editable circle; the gate cases below override `ownerId` / `canEdit`.

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const useCircleMock = vi.fn();
vi.mock('@/hooks/useCircle', () => ({
  useCircle: (id: string) => useCircleMock(id),
}));

// Step 1 is decided by the cheap PRESENCE read (`useEventsPresence`), never the
// 211-day events list: `useCalendarEvents` is mocked only so a regression that
// goes back to it is caught (it answers "pending" and is asserted uncalled).
const useCalendarEventsMock = vi.fn();
const useEventsPresenceMock = vi.fn();
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCalendarEvents: (...args: unknown[]) => useCalendarEventsMock(...args),
  useEventsPresence: (...args: unknown[]) => useEventsPresenceMock(...args),
}));

const useEmergencyInfoMock = vi.fn();
vi.mock('@/hooks/useEmergencyInfo', () => ({
  useEmergencyInfo: (id: string) => useEmergencyInfoMock(id),
}));

// Home had no instrumentation on web: a step press and a dismissal (with the
// progress at that moment) are the two things worth knowing about this card.
const gettingStartedStepTapped = vi.fn();
const gettingStartedDismissed = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    gettingStartedStepTapped: (...args: unknown[]) => gettingStartedStepTapped(...args),
    gettingStartedDismissed: (...args: unknown[]) => gettingStartedDismissed(...args),
  },
}));

const CURRENT_USER_ID = 'owner';
const DAY_MS = 24 * 60 * 60 * 1000;

type QueryStatus = 'pending' | 'error' | 'success';
type FetchStatus = 'fetching' | 'paused' | 'idle';
/** Shorthand for the four (status, fetchStatus) pairs a first load can be in. */
type Phase = 'success' | 'fetching' | 'paused' | 'error';

/**
 * A `useQuery` result whose booleans are DERIVED from `status` + `fetchStatus`
 * exactly as React Query v5 derives them — so a test cannot describe a state
 * the library never produces. A PAUSED (offline) read is `isLoading: false`
 * and `isError: false` with no data; the old gate read that as "settled".
 */
function queryResult<T>(phase: Phase, data: T | undefined) {
  const status: QueryStatus = phase === 'success' ? 'success' : phase === 'error' ? 'error' : 'pending';
  const fetchStatus: FetchStatus = phase === 'fetching' ? 'fetching' : phase === 'paused' ? 'paused' : 'idle';
  const isPending = status === 'pending';
  const isFetching = fetchStatus === 'fetching';
  return {
    status,
    fetchStatus,
    // Pending has no data by construction; a first-load failure has none either.
    data: status === 'success' ? data : undefined,
    isPending,
    isSuccess: status === 'success',
    isError: status === 'error',
    isLoading: isPending && isFetching,
    isFetching,
    isPaused: fetchStatus === 'paused',
    isRefetching: isFetching && !isPending,
    refetch: vi.fn(),
  };
}

interface Signals {
  members?: unknown[];
  pendingInvites?: unknown[];
  events?: unknown[];
  emergency?: Record<string, unknown> | null;
  circleLoading?: boolean;
  eventsLoading?: boolean;
  emergencyLoading?: boolean;
  /** Full state of the events presence read. Overrides `eventsLoading`. */
  eventsPhase?: Phase;
  /** Full state of the emergency-info read. Overrides `emergencyLoading`. */
  emergencyPhase?: Phase;
  /** Circle owner — defaults to the signed-in user. Only filters the invite step. */
  ownerId?: string;
  /** Write capability — the actual gate. Defaults to an editing member. */
  canEdit?: boolean;
  /** ISO creation date — informational only; the checklist has no age gate. */
  createdAt?: string;
}

/** Points the mocked hooks at a given set of signals. Does not render. */
function configure(s: Signals = {}): void {
  useCircleMock.mockReturnValue({
    circle: {
      owner_id: s.ownerId ?? CURRENT_USER_ID,
      pending_invites: s.pendingInvites ?? [],
    },
    circleSummary: { created_at: s.createdAt ?? new Date().toISOString() },
    members: s.members ?? [{ id: CURRENT_USER_ID }],
    timezone: 'America/New_York',
    canEdit: s.canEdit ?? true,
    isLoading: s.circleLoading ?? false,
  });
  // The presence read answers per-type booleans; `events` is the fixture's way
  // of saying which types exist in the window.
  const types = new Set((s.events ?? []).map((e) => (e as { event_type?: string }).event_type));
  const presence = queryResult(s.eventsPhase ?? (s.eventsLoading ? 'fetching' : 'success'), {
    medication: types.has('medication'),
    appointment: types.has('appointment'),
    task: types.has('task'),
  });
  useEventsPresenceMock.mockReturnValue(presence);
  // A full events list must never be what decides the step.
  const neverList = queryResult('fetching', undefined);
  useCalendarEventsMock.mockReturnValue({ ...neverList, events: [] });
  useEmergencyInfoMock.mockReturnValue(
    queryResult(s.emergencyPhase ?? (s.emergencyLoading ? 'fetching' : 'success'), s.emergency ?? null)
  );
}

function renderChecklist(
  circleId = 'circle-1',
  props: { onAddEvent?: () => void; fallback?: ReactNode } = {}
): RenderResult {
  return render(
    <MemoryRouter>
      <GettingStartedChecklist circleId={circleId} {...props} />
    </MemoryRouter>
  );
}

function setup(s: Signals = {}, onAddEvent = vi.fn()) {
  configure(s);
  const view = renderChecklist('circle-1', { onAddEvent });
  return { onAddEvent, ...view };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useAuthStore.setState({
    user: {
      id: CURRENT_USER_ID,
      email: 'owner@example.com',
      first_name: 'Owner',
      last_name: 'One',
    },
    isAuthenticated: true,
  });
});

describe('GettingStartedChecklist', () => {
  it('renders all three steps as pending for a brand-new circle', () => {
    setup();

    expect(screen.getByRole('region', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByText('Add a medication')).toBeInTheDocument();
    expect(screen.getByText('Invite family & caregivers')).toBeInTheDocument();
    expect(screen.getByText('Add emergency info')).toBeInTheDocument();

    // All three pending → two "Add" actions (event, emergency) + one "Invite".
    expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(2);
    expect(screen.getByRole('button', { name: /Invite/ })).toBeInTheDocument();
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
  });

  // HOME OVER-FETCH: the step used to read a 211-day events list (1,511 rows,
  // ~1.4 MB, plus two prefetched 211-day neighbours). It needs one boolean.
  it('decides step 1 from the presence read over today-30..today+180 and never fetches an events list', () => {
    setup({ events: [{ id: 'e1', event_type: 'medication' }] });

    const today = getDateInTimezone('America/New_York');
    expect(useEventsPresenceMock).toHaveBeenCalledWith(
      'circle-1',
      addDays(today, -30),
      addDays(today, 180)
    );
    expect(useCalendarEventsMock).not.toHaveBeenCalled();
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
  });

  it('shows a "why this matters" line under each step', () => {
    setup();

    expect(
      screen.getByText('Everyone gets the reminder, so no one has to be the one who remembers.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Share the load — they see the same schedule and updates.')
    ).toBeInTheDocument();
    expect(
      screen.getByText("Allergies, doctors, and contacts ready the moment they're needed.")
    ).toBeInTheDocument();
  });

  /**
   * THE STEP ASKS FOR A MEDICATION, SO ONLY A MEDICATION MAY TICK IT.
   *
   * The check counted any event in the window, so an appointment or a task
   * completed it. Reported on mobile, which had the same defect with a stricter
   * label: create a circle, add a TASK through the first-run wizard, and "Add
   * medications" was struck through on a circle holding no medication. Both
   * surfaces now test `event_type === 'medication'`.
   *
   * Asserted for both non-medication types, because a fix that special-cased
   * tasks alone would still tick on an appointment.
   */
  it.each(['appointment', 'task'])('leaves step 1 pending for a %s', (eventType) => {
    setup({ events: [{ id: 'e1', event_type: eventType }] });

    const label = screen.getByText('Add a medication');
    expect(label.className).not.toContain('line-through');
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
  });

  it('marks step 1 done (strikethrough, no action) when an event exists', () => {
    setup({ events: [{ id: 'e1', event_type: 'medication' }] });

    const label = screen.getByText('Add a medication');
    expect(label.className).toContain('line-through');
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
    // Only the two remaining pending steps still show an action.
    expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Invite/ })).toBeInTheDocument();
  });

  it('marks step 2 done when the circle has more than one member', () => {
    setup({ members: [{ id: 'owner' }, { id: 'caregiver' }] });
    expect(screen.getByText('Invite family & caregivers').className).toContain('line-through');
  });

  it('marks step 2 done when there is a pending invite', () => {
    setup({ pendingInvites: [{ id: 'inv-1' }] });
    expect(screen.getByText('Invite family & caregivers').className).toContain('line-through');
  });

  // An EXPIRED invite is still returned in `pending_invites`, but nobody can
  // join through it — ticking the step off one would leave a solo owner whose
  // single attempt lapsed permanently un-nudged. Resend/cancel exist for
  // exactly this row.
  describe('step 2 vs expired invites', () => {
    it('leaves step 2 pending when the only invite has expired', () => {
      setup({
        pendingInvites: [
          { id: 'inv-1', expires_at: '2020-01-01T00:00:00Z', is_expired: true },
        ],
      });
      expect(screen.getByText('Invite family & caregivers').className).not.toContain(
        'line-through'
      );
      expect(screen.getByRole('button', { name: /Invite/ })).toBeInTheDocument();
      expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
    });

    it('falls back to expires_at when the backend omits is_expired', () => {
      setup({ pendingInvites: [{ id: 'inv-1', expires_at: '2020-01-01T00:00:00Z' }] });
      expect(screen.getByText('Invite family & caregivers').className).not.toContain(
        'line-through'
      );
    });

    it('trusts is_expired over the local clock when they disagree', () => {
      // expires_at reads as lapsed locally, but the server says it is live.
      setup({
        pendingInvites: [
          { id: 'inv-1', expires_at: '2020-01-01T00:00:00Z', is_expired: false },
        ],
      });
      expect(screen.getByText('Invite family & caregivers').className).toContain('line-through');
    });

    it('treats an unusable expires_at as live rather than nagging', () => {
      setup({ pendingInvites: [{ id: 'inv-1', expires_at: 'not-a-date' }] });
      expect(screen.getByText('Invite family & caregivers').className).toContain('line-through');
    });

    it('still counts a live invite alongside an expired one', () => {
      setup({
        pendingInvites: [
          { id: 'inv-1', expires_at: '2020-01-01T00:00:00Z', is_expired: true },
          { id: 'inv-2', expires_at: '2099-01-01T00:00:00Z', is_expired: false },
        ],
      });
      expect(screen.getByText('Invite family & caregivers').className).toContain('line-through');
    });

    it('keeps step 2 done off a real member even when every invite lapsed', () => {
      setup({
        members: [{ id: CURRENT_USER_ID }, { id: 'caregiver' }],
        pendingInvites: [
          { id: 'inv-1', expires_at: '2020-01-01T00:00:00Z', is_expired: true },
        ],
      });
      expect(screen.getByText('Invite family & caregivers').className).toContain('line-through');
    });
  });

  it('marks step 3 done when any emergency content is present', () => {
    setup({ emergency: { blood_type: 'O+' } });
    expect(screen.getByText('Add emergency info').className).toContain('line-through');
  });

  it('hides for good once all steps are complete', () => {
    setup({
      events: [{ id: 'e1', event_type: 'medication' }],
      members: [{ id: 'owner' }, { id: 'caregiver' }],
      emergency: { blood_type: 'O+' },
    });
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();
  });

  it('dismisses when the × is clicked', async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.getByRole('region', { name: 'Get started' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss the get started checklist' }));
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();
  });

  it('reports a dismissal with the progress at that moment', async () => {
    const user = userEvent.setup();
    // One of the owner's three steps done, so the counts are not both trivial.
    setup({ emergency: { blood_type: 'O+' } });

    await user.click(screen.getByRole('button', { name: 'Dismiss the get started checklist' }));
    expect(gettingStartedDismissed).toHaveBeenCalledTimes(1);
    expect(gettingStartedDismissed).toHaveBeenCalledWith(1, 3);
  });

  it('shows the fallback in place of the checklist once dismissed', async () => {
    const user = userEvent.setup();
    configure();
    renderChecklist('circle-1', { fallback: <p>Nothing scheduled yet.</p> });

    expect(screen.queryByText('Nothing scheduled yet.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss the get started checklist' }));
    expect(screen.getByText('Nothing scheduled yet.')).toBeInTheDocument();
  });

  it('persists the dismissal to localStorage and stays hidden after a remount', async () => {
    const user = userEvent.setup();
    const { unmount } = setup();

    await user.click(screen.getByRole('button', { name: 'Dismiss the get started checklist' }));
    expect(localStorage.getItem('getting_started_dismissed_circle-1')).toBe('true');

    // Fresh mount (new session / page reload): storage, not state, keeps it hidden.
    unmount();
    configure();
    renderChecklist('circle-1');
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();
  });

  it('keeps a dismissal scoped to its own circle when the circle changes in place', async () => {
    const user = userEvent.setup();
    configure();
    const { rerender } = renderChecklist('circle-1');

    await user.click(screen.getByRole('button', { name: 'Dismiss the get started checklist' }));
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();

    // Same mounted component, different :circleId route param — circle B was
    // never dismissed, so it must still get its checklist.
    rerender(
      <MemoryRouter>
        <GettingStartedChecklist circleId="circle-2" />
      </MemoryRouter>
    );
    expect(screen.getByRole('region', { name: 'Get started' })).toBeInTheDocument();
    expect(localStorage.getItem('getting_started_dismissed_circle-2')).toBeNull();
  });

  // Ownership is NOT the gate. A non-owner caregiver can add meds/appointments
  // and emergency info — they just can't invite — so they get the card minus
  // the invite step, and the progress count must follow the FILTERED list.
  it('shows the checklist to a non-owner who can edit, without the invite step', () => {
    configure({ ownerId: 'someone-else' });
    renderChecklist('circle-1', { fallback: <p>Nothing scheduled yet.</p> });

    expect(screen.getByRole('region', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing scheduled yet.')).not.toBeInTheDocument();

    expect(screen.getByText('Add a medication')).toBeInTheDocument();
    expect(screen.getByText('Add emergency info')).toBeInTheDocument();
    expect(screen.queryByText('Invite family & caregivers')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Invite/ })).not.toBeInTheDocument();

    // Two real steps → the eyebrow counts out of 2, never 3.
    expect(screen.getByText('0 of 2 done')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(2);
  });

  it('counts a non-owner progress out of 2 as their steps complete', () => {
    configure({ ownerId: 'someone-else', events: [{ id: 'e1', event_type: 'medication' }] });
    renderChecklist('circle-1');

    expect(screen.getByText('1 of 2 done')).toBeInTheDocument();
  });

  it('hides for good for a non-owner once their two steps are done', () => {
    configure({
      ownerId: 'someone-else',
      events: [{ id: 'e1', event_type: 'medication' }],
      emergency: { blood_type: 'O+' },
    });
    renderChecklist('circle-1', { fallback: <p>Nothing scheduled yet.</p> });

    // The un-offered invite step must not hold the checklist open forever.
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing scheduled yet.')).toBeInTheDocument();
  });

  it('shows the fallback instead of the checklist for a view-only member', () => {
    configure({ ownerId: 'someone-else', canEdit: false });
    renderChecklist('circle-1', { fallback: <p>Nothing scheduled yet.</p> });

    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing scheduled yet.')).toBeInTheDocument();
  });

  // Guards against the owner-only filter leaking into the owner's own view.
  it('still shows all three steps, invite included, to the owner', () => {
    configure();
    renderChecklist('circle-1');

    expect(screen.getByText('Add a medication')).toBeInTheDocument();
    expect(screen.getByText('Invite family & caregivers')).toBeInTheDocument();
    expect(screen.getByText('Add emergency info')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Invite/ })).toBeInTheDocument();
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
  });

  // There is no circle-age window: guidance that's still outstanding on an old
  // circle is still worth giving. Dismissal is the only permanent escape hatch.
  it('still shows the checklist for a long-established circle with steps outstanding', () => {
    configure({ createdAt: new Date(Date.now() - 30 * DAY_MS).toISOString() });
    renderChecklist('circle-1', { fallback: <p>Nothing scheduled yet.</p> });

    expect(screen.getByRole('region', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.queryByText('Nothing scheduled yet.')).not.toBeInTheDocument();
  });

  it('renders nothing — not even the fallback — while any signal is still loading', () => {
    configure({ circleLoading: true });
    renderChecklist('circle-1', { fallback: <p>Nothing scheduled yet.</p> });

    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing scheduled yet.')).not.toBeInTheDocument();
  });

  // ==========================================================================
  // A STEP IS "TO DO" ONLY WHEN ITS READ SUCCEEDED AND FOUND NOTHING.
  //
  // The card waited on `isLoading` alone. A FAILED presence read (no data) or a
  // PAUSED one (offline: `isLoading` false) left `hasEvent` false, so a circle
  // that HAS a medication showed "0 of 3 done" with "Add a medication" pending
  // and an Add button — directly above TodaysMeds' "Couldn't load medications".
  // The card now stays hidden until both reads are known; TodaysMeds, which
  // reads the same key, owns the error + Retry.
  // ==========================================================================
  describe('a step is pending only when its read succeeded', () => {
    const MED = [{ id: 'e1', event_type: 'medication' }];

    function expectNoCard(): void {
      expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();
      expect(screen.queryByText('Add a medication')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add/ })).not.toBeInTheDocument();
      // Not counted as pending anywhere: no progress line at all.
      expect(screen.queryByText(/of \d done/)).not.toBeInTheDocument();
    }

    it('(a) events read paused offline: no card and no Add-medication CTA', () => {
      configure({ eventsPhase: 'paused', events: MED });
      renderChecklist('circle-1', { fallback: <p>Nothing scheduled yet.</p> });
      expectNoCard();
      // Not the "all done" fallback either — nothing is known.
      expect(screen.queryByText('Nothing scheduled yet.')).not.toBeInTheDocument();
    });

    it('(a) emergency read paused offline: no card', () => {
      configure({ emergencyPhase: 'paused' });
      renderChecklist();
      expectNoCard();
    });

    it('(b) events read ERRORED on a circle with a medication: no Add-medication CTA, step not counted as pending', () => {
      configure({ eventsPhase: 'error', events: MED });
      renderChecklist('circle-1', { fallback: <p>Nothing scheduled yet.</p> });
      expectNoCard();
      expect(screen.queryByText('Nothing scheduled yet.')).not.toBeInTheDocument();
    });

    it('(b) emergency read ERRORED: no card (the emergency step is not offered as to-do)', () => {
      configure({ emergencyPhase: 'error' });
      renderChecklist();
      expectNoCard();
    });

    it('events read still fetching: no card', () => {
      configure({ eventsPhase: 'fetching' });
      renderChecklist();
      expectNoCard();
    });

    it('(c) both reads succeeded and found nothing: "Add a medication" is pending with its Add', () => {
      configure({ eventsPhase: 'success', emergencyPhase: 'success' });
      renderChecklist();
      expect(screen.getByRole('region', { name: 'Get started' })).toBeInTheDocument();
      expect(screen.getByText('Add a medication').className).not.toContain('line-through');
      expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(2);
    });

    it('(d) events read succeeded with a medication: the step is done, no Add for it', () => {
      configure({ eventsPhase: 'success', events: MED });
      renderChecklist();
      expect(screen.getByText('Add a medication').className).toContain('line-through');
      expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(1);
    });
  });

  it('fires onAddEvent for step 1 and navigates for steps 2 & 3', async () => {
    const user = userEvent.setup();
    const { onAddEvent } = setup();

    const addActions = screen.getAllByRole('button', { name: /Add/ });
    await user.click(addActions[0]); // step 1
    expect(onAddEvent).toHaveBeenCalledTimes(1);
    expect(gettingStartedStepTapped).toHaveBeenCalledWith('event');

    await user.click(screen.getByRole('button', { name: /Invite/ })); // step 2 → members
    expect(navigate).toHaveBeenCalledWith('/circles/circle-1/members');
    expect(gettingStartedStepTapped).toHaveBeenCalledWith('invite');

    await user.click(addActions[1]); // step 3 → emergency
    expect(navigate).toHaveBeenCalledWith('/circles/circle-1/emergency');
    expect(gettingStartedStepTapped).toHaveBeenCalledWith('emergency');
    expect(gettingStartedStepTapped).toHaveBeenCalledTimes(3);
  });
});
