import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useNextStep } from '../useNextStep';
import { useCircle } from '../useCircle';
import { useEventsPresence } from '../useCalendarEvents';
import { getCurrentUser } from '@/api/users';
import { snoozeNextStep, NEXT_STEP_SNOOZE_MS } from '@/lib/todayCoaching';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';

vi.mock('../useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('../useCalendarEvents', () => ({ useEventsPresence: vi.fn() }));
vi.mock('@/api/users', () => ({ getCurrentUser: vi.fn() }));

interface World {
  hasMed: boolean;
  members: number;
  liveInvites: number;
  canManage: boolean;
  canEdit: boolean;
  viewOnly: boolean;
  medRemindersOff: boolean;
}
let world: World;

function apply(): void {
  vi.mocked(useCircle).mockReturnValue({
    circle: {
      id: 'c1',
      view_only: world.viewOnly,
      pending_invites: Array.from({ length: world.liveInvites }, (_, i) => ({
        id: `i${i}`,
        is_expired: false,
      })),
    },
    members: Array.from({ length: world.members }, (_, i) => ({ id: `m${i}` })),
    canEdit: world.canEdit,
    canManageMembers: world.canManage,
    isLoading: false,
  } as unknown as ReturnType<typeof useCircle>);
  vi.mocked(useEventsPresence).mockReturnValue({
    data: { medication: world.hasMed, appointment: false, task: false },
    isSuccess: true,
    isPending: false,
    isError: false,
    isFallback: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useEventsPresence>);
  vi.mocked(getCurrentUser).mockResolvedValue({
    notification_preferences: world.medRemindersOff
      ? { medication_confirmations: false, missed_medications: false }
      : {},
  } as never);
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function mount() {
  const hook = renderHook(() => useNextStep('c1', 'America/Denver'), { wrapper });
  await waitFor(() => expect(hook.result.current.status).not.toBe('unknown'));
  return hook;
}

describe('useNextStep', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useAuthStore.setState({
      user: { id: 'u1', email: 'a@b.c', first_name: 'A', last_name: 'B' },
      isAuthenticated: true,
    } as never);
    world = {
      hasMed: false,
      members: 1,
      liveInvites: 0,
      canManage: true,
      canEdit: true,
      viewOnly: false,
      medRemindersOff: false,
    };
    apply();
    vi.spyOn(Analytics, 'nextStepCompleted').mockImplementation(() => {});
  });

  it('starts at step 1 (first medication) of 3', async () => {
    const { result } = await mount();
    expect(result.current).toMatchObject({ status: 'step', step: 'first_med', position: 1, total: 3 });
  });

  it('then invite once a medication exists', async () => {
    world.hasMed = true;
    apply();
    const { result } = await mount();
    expect(result.current).toMatchObject({ status: 'step', step: 'invite', position: 2, total: 3 });
  });

  it('a live pending invite counts as invited; an EXPIRED one does not', async () => {
    world.hasMed = true;
    world.liveInvites = 1;
    apply();
    expect((await mount()).result.current.status).toBe('none');

    vi.mocked(useCircle).mockReturnValue({
      ...(vi.mocked(useCircle)('c1') as object),
      circle: { id: 'c1', view_only: false, pending_invites: [{ id: 'i', is_expired: true }] },
    } as unknown as ReturnType<typeof useCircle>);
    expect((await mount()).result.current).toMatchObject({ step: 'invite' });
  });

  it('another member counts as invited', async () => {
    world.hasMed = true;
    world.members = 2;
    apply();
    expect((await mount()).result.current.status).toBe('none');
  });

  it('then reminders only when medication reminders were switched off', async () => {
    world.hasMed = true;
    world.members = 2;
    world.medRemindersOff = true;
    apply();
    expect((await mount()).result.current).toMatchObject({ status: 'step', step: 'reminders', position: 3 });
  });

  it('is gone for good once all three are done', async () => {
    world.hasMed = true;
    world.members = 2;
    apply();
    expect((await mount()).result.current.status).toBe('none');
  });

  it('a member who cannot invite gets a 2-step list and never the invite step', async () => {
    world.canManage = false;
    world.hasMed = true;
    world.medRemindersOff = true;
    apply();
    expect((await mount()).result.current).toMatchObject({ step: 'reminders', position: 2, total: 2 });
  });

  it('view-only and read-only seats get no card at all', async () => {
    world.viewOnly = true;
    apply();
    expect((await mount()).result.current.status).toBe('none');
    world.viewOnly = false;
    world.canEdit = false;
    apply();
    expect((await mount()).result.current.status).toBe('none');
  });

  it('is "unknown", not a guess, until the circle and the presence read have answered', () => {
    vi.mocked(useEventsPresence).mockReturnValue({
      data: undefined,
      isSuccess: false,
      isPending: true,
      isError: false,
    } as unknown as ReturnType<typeof useEventsPresence>);
    const { result } = renderHook(() => useNextStep('c1', 'America/Denver'), { wrapper });
    expect(result.current.status).toBe('unknown');
  });

  describe('Not now = 3 days', () => {
    it('hides the WHOLE card (never answered by the next step), same as mobile', async () => {
      const { result } = await mount();
      if (result.current.status !== 'step') throw new Error('expected a step');
      act(() => result.current.status === 'step' && result.current.snooze());
      expect(result.current.status).toBe('none');
    });

    it('an invite-step snooze (set by the wizard\'s "Not now") hides the invite card', async () => {
      world.hasMed = true;
      apply();
      snoozeNextStep('c1', 'invite');
      expect((await mount()).result.current.status).toBe('none');
    });

    it('with every open step snoozed the card is hidden', async () => {
      world.hasMed = true;
      world.members = 2;
      world.medRemindersOff = true;
      apply();
      snoozeNextStep('c1', 'reminders');
      expect((await mount()).result.current.status).toBe('none');
    });

    it('comes back after the 3 days', async () => {
      snoozeNextStep('c1', 'first_med', Date.now() - NEXT_STEP_SNOOZE_MS - 1000);
      expect((await mount()).result.current).toMatchObject({ step: 'first_med' });
    });

    it('is remembered per user', async () => {
      snoozeNextStep('c1', 'first_med');
      expect((await mount()).result.current.status).toBe('none');
      useAuthStore.setState({
        user: { id: 'u2', email: 'x@y.z', first_name: 'X', last_name: 'Y' },
      } as never);
      expect((await mount()).result.current).toMatchObject({ step: 'first_med' });
    });
  });

  describe('next_step_completed', () => {
    it('fires when an open step becomes done while on screen, once', async () => {
      const { result, rerender } = await mount();
      expect(result.current).toMatchObject({ step: 'first_med' });
      expect(Analytics.nextStepCompleted).not.toHaveBeenCalled();
      world.hasMed = true;
      apply();
      rerender();
      expect(Analytics.nextStepCompleted).toHaveBeenCalledWith('first_med');
      rerender();
      expect(Analytics.nextStepCompleted).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire for a step that was already done when the page opened', async () => {
      world.hasMed = true;
      apply();
      const { rerender } = await mount();
      rerender();
      expect(Analytics.nextStepCompleted).not.toHaveBeenCalled();
    });
  });
});
