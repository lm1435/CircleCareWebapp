import { type ReactNode } from 'react';
import { render, screen, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { useAuthStore } from '@/store/authStore';
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

const useCalendarEventsMock = vi.fn();
vi.mock('@/hooks/useCalendarEvents', () => ({
  useCalendarEvents: (...args: unknown[]) => useCalendarEventsMock(...args),
}));

const useEmergencyInfoMock = vi.fn();
vi.mock('@/hooks/useEmergencyInfo', () => ({
  useEmergencyInfo: (id: string) => useEmergencyInfoMock(id),
}));

const CURRENT_USER_ID = 'owner';
const DAY_MS = 24 * 60 * 60 * 1000;

interface Signals {
  members?: unknown[];
  pendingInvites?: unknown[];
  events?: unknown[];
  emergency?: Record<string, unknown> | null;
  circleLoading?: boolean;
  eventsLoading?: boolean;
  emergencyLoading?: boolean;
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
  useCalendarEventsMock.mockReturnValue({
    events: s.events ?? [],
    isLoading: s.eventsLoading ?? false,
  });
  useEmergencyInfoMock.mockReturnValue({
    data: s.emergency ?? null,
    isLoading: s.emergencyLoading ?? false,
  });
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

  it('fires onAddEvent for step 1 and navigates for steps 2 & 3', async () => {
    const user = userEvent.setup();
    const { onAddEvent } = setup();

    const addActions = screen.getAllByRole('button', { name: /Add/ });
    await user.click(addActions[0]); // step 1
    expect(onAddEvent).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Invite/ })); // step 2 → members
    expect(navigate).toHaveBeenCalledWith('/circles/circle-1/members');

    await user.click(addActions[1]); // step 3 → emergency
    expect(navigate).toHaveBeenCalledWith('/circles/circle-1/emergency');
  });
});
