import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { GettingStartedChecklist } from '../GettingStartedChecklist';

// Focused unit test for the first-run checklist. The three data signals come from
// useCircle / useCalendarEvents / useEmergencyInfo — all mocked so we drive
// done/pending state directly. Navigation is mocked to assert the pending CTAs.

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

interface Signals {
  members?: unknown[];
  pendingInvites?: unknown[];
  events?: unknown[];
  emergency?: Record<string, unknown> | null;
  circleLoading?: boolean;
  eventsLoading?: boolean;
  emergencyLoading?: boolean;
}

function setup(s: Signals = {}, onAddEvent = vi.fn()) {
  useCircleMock.mockReturnValue({
    circle: { pending_invites: s.pendingInvites ?? [] },
    members: s.members ?? [{ id: 'owner' }],
    timezone: 'America/New_York',
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

  render(
    <MemoryRouter>
      <GettingStartedChecklist circleId="circle-1" onAddEvent={onAddEvent} />
    </MemoryRouter>
  );
  return { onAddEvent };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GettingStartedChecklist', () => {
  it('renders all three steps as pending for a brand-new circle', () => {
    setup();

    expect(screen.getByRole('region', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByText('Add a medication or appointment')).toBeInTheDocument();
    expect(screen.getByText('Invite family & caregivers')).toBeInTheDocument();
    expect(screen.getByText('Add emergency info')).toBeInTheDocument();

    // All three pending → three "Add" action buttons.
    expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(3);
    expect(screen.getByText('0 of 3 done')).toBeInTheDocument();
  });

  it('shows a "why this matters" line under each step', () => {
    setup();

    expect(
      screen.getByText('Everyone on the app gets a reminder, so no dose or visit is missed.')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Share the load — they see the same schedule and updates.')
    ).toBeInTheDocument();
    expect(
      screen.getByText("Allergies, doctors, and contacts ready the moment they're needed.")
    ).toBeInTheDocument();
  });

  it('marks step 1 done (strikethrough, no action) when an event exists', () => {
    setup({ events: [{ id: 'e1' }] });

    const label = screen.getByText('Add a medication or appointment');
    expect(label.className).toContain('line-through');
    expect(screen.getByText('1 of 3 done')).toBeInTheDocument();
    // Only the two remaining pending steps still show an action.
    expect(screen.getAllByRole('button', { name: /Add/ })).toHaveLength(2);
  });

  it('marks step 2 done when the circle has more than one member', () => {
    setup({ members: [{ id: 'owner' }, { id: 'caregiver' }] });
    expect(screen.getByText('Invite family & caregivers').className).toContain('line-through');
  });

  it('marks step 2 done when there is a pending invite', () => {
    setup({ pendingInvites: [{ id: 'inv-1' }] });
    expect(screen.getByText('Invite family & caregivers').className).toContain('line-through');
  });

  it('marks step 3 done when any emergency content is present', () => {
    setup({ emergency: { blood_type: 'O+' } });
    expect(screen.getByText('Add emergency info').className).toContain('line-through');
  });

  it('returns null while any signal is still loading', () => {
    setup({ circleLoading: true });
    expect(screen.queryByRole('region', { name: 'Get started' })).not.toBeInTheDocument();
  });

  it('hides for good once all steps are complete', () => {
    setup({
      events: [{ id: 'e1' }],
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

  it('fires onAddEvent for step 1 and navigates for steps 2 & 3', async () => {
    const user = userEvent.setup();
    const { onAddEvent } = setup();

    const actions = screen.getAllByRole('button', { name: /Add/ });
    await user.click(actions[0]); // step 1
    expect(onAddEvent).toHaveBeenCalledTimes(1);

    await user.click(actions[1]); // step 2 → members
    expect(navigate).toHaveBeenCalledWith('/circles/circle-1/members');

    await user.click(actions[2]); // step 3 → emergency
    expect(navigate).toHaveBeenCalledWith('/circles/circle-1/emergency');
  });
});
