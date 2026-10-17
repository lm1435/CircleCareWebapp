import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the member-management WRITE functions; keep getCircleDetail (read hook)
// and types intact.
vi.mock('@/api/circleMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circleMembers')>();
  return {
    ...actual,
    removeMember: vi.fn(),
    leaveCircle: vi.fn(),
    setMedicationResponsible: vi.fn(),
    setMemberRole: vi.fn(),
  };
});

// The viewer's role is read from the circle-detail cache at call time (see
// lib/circleViewerRole.ts); stubbed so each test can say who is acting.
const viewerRole = vi.hoisted(() => ({ owner: true, actor: 'owner' as 'owner' | 'manager' }));
vi.mock('@/lib/circleViewerRole', () => ({
  cachedActorRole: () => viewerRole.actor,
  cachedViewerOwnsCircle: () => viewerRole.owner,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

const promptUpgrade = vi.fn();
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade }),
}));

const mockMemberRemoved = vi.fn();
const mockCircleLeft = vi.fn();
const mockRoleChanged = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    memberRemoved: (...args: unknown[]) => mockMemberRemoved(...args),
    circleLeft: (...args: unknown[]) => mockCircleLeft(...args),
    memberRoleChanged: (...args: unknown[]) => mockRoleChanged(...args),
  },
}));

import {
  removeMember,
  leaveCircle,
  setMedicationResponsible,
  setMemberRole,
} from '@/api/circleMembers';
import { queryKeys } from '@/lib/queryKeys';
import {
  useRemoveMember,
  useLeaveCircle,
  useSetMedicationResponsible,
  useSetMemberRole,
} from '@/hooks/useCircleMembers';

const CIRCLE_ID = 'circle-1';
const USER_ID = 'user-9';

const mockRemove = vi.mocked(removeMember);
const mockLeave = vi.mocked(leaveCircle);
const mockSetMedResp = vi.mocked(setMedicationResponsible);

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, invalidateSpy, wrapper };
}

type InvalidateArg = Parameters<QueryClient['invalidateQueries']>[0];

function invalidatedWith(
  invalidateSpy: { mock: { calls: [InvalidateArg?, ...unknown[]][] } },
  key: readonly unknown[]
) {
  return invalidateSpy.mock.calls.some(
    (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(key)
  );
}

const PERMISSION_ENVELOPE = {
  success: false,
  error: { code: 'FORBIDDEN', message: 'owner only' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRemoveMember', () => {
  it('DELETEs the member by id and invalidates circle queries', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockRemove.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRemoveMember(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: USER_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRemove).toHaveBeenCalledWith(CIRCLE_ID, USER_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.circle(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('fires Analytics.memberRemoved(circleId) — deliberately NO removed-user id', async () => {
    const { wrapper } = setup();
    mockRemove.mockResolvedValue(undefined);

    const { result } = renderHook(() => useRemoveMember(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: USER_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockMemberRemoved).toHaveBeenCalledWith(CIRCLE_ID, 'owner');
    expect(mockMemberRemoved.mock.calls[0]).not.toContain(USER_ID);
  });

  it("carries actor_role 'manager' when a manager removed the member", async () => {
    const { wrapper } = setup();
    mockRemove.mockResolvedValue(undefined);
    viewerRole.actor = 'manager';
    try {
      const { result } = renderHook(() => useRemoveMember(CIRCLE_ID), { wrapper });
      result.current.mutate({ userId: USER_ID });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(mockMemberRemoved).toHaveBeenLastCalledWith(CIRCLE_ID, 'manager');
    } finally {
      viewerRole.actor = 'owner';
    }
  });

  it('toasts the inactive-circle copy and refreshes on 400 CIRCLE_ARCHIVED (manager path)', async () => {
    const { invalidateSpy, wrapper } = setup();
    showToast.mockClear();
    mockRemove.mockRejectedValue({ success: false, error: { code: 'CIRCLE_ARCHIVED', message: 'x' } });

    const { result } = renderHook(() => useRemoveMember(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: USER_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.circleInactive', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
  });

  it('surfaces a 403 as the permission toast', async () => {
    const { wrapper } = setup();
    mockRemove.mockRejectedValue(PERMISSION_ENVELOPE);

    const { result } = renderHook(() => useRemoveMember(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: USER_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
  });
});

describe('useLeaveCircle', () => {
  it('POSTs to leave and invalidates circle detail + list', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockLeave.mockResolvedValue(undefined);

    const { result } = renderHook(() => useLeaveCircle(CIRCLE_ID), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockLeave).toHaveBeenCalledWith(CIRCLE_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('fires Analytics.circleLeft(circleId) on success', async () => {
    const { wrapper } = setup();
    mockLeave.mockResolvedValue(undefined);

    const { result } = renderHook(() => useLeaveCircle(CIRCLE_ID), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCircleLeft).toHaveBeenCalledWith(CIRCLE_ID);
  });

  it('toasts errors.saveFailed on a generic rejection', async () => {
    const { wrapper } = setup();
    showToast.mockClear();
    mockLeave.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useLeaveCircle(CIRCLE_ID), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.saveFailed', 'error');
    expect(mockCircleLeft).not.toHaveBeenCalledWith(CIRCLE_ID);
  });
});

describe('useSetMedicationResponsible', () => {
  it('PUTs the userId and invalidates circle queries', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockSetMedResp.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSetMedicationResponsible(CIRCLE_ID), { wrapper });
    result.current.mutate(USER_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockSetMedResp).toHaveBeenCalledWith(CIRCLE_ID, USER_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.circle(CIRCLE_ID))).toBe(true);
  });

  it('PUTs null to clear the assignment', async () => {
    const { wrapper } = setup();
    mockSetMedResp.mockResolvedValue(undefined);

    const { result } = renderHook(() => useSetMedicationResponsible(CIRCLE_ID), { wrapper });
    result.current.mutate(null);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockSetMedResp).toHaveBeenCalledWith(CIRCLE_ID, null);
  });

  it('toasts errors.saveFailed on a generic rejection', async () => {
    const { wrapper } = setup();
    showToast.mockClear();
    mockSetMedResp.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useSetMedicationResponsible(CIRCLE_ID), { wrapper });
    result.current.mutate(USER_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.saveFailed', 'error');
  });

  it('toasts errors.permissionDenied on a 403', async () => {
    const { wrapper } = setup();
    showToast.mockClear();
    mockSetMedResp.mockRejectedValue(PERMISSION_ENVELOPE);

    const { result } = renderHook(() => useSetMedicationResponsible(CIRCLE_ID), { wrapper });
    result.current.mutate(USER_ID);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
  });
});

describe('useSetMemberRole', () => {
  const mockSetRole = vi.mocked(setMemberRole);
  const reject = (code: string) => ({ success: false, error: { code, message: 'x' } });

  beforeEach(() => {
    showToast.mockClear();
    promptUpgrade.mockClear();
    mockRoleChanged.mockClear();
    mockSetRole.mockReset();
  });

  it('PATCHes the role, toasts by name, fires member_role_changed and refreshes the circle', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockSetRole.mockResolvedValue({ user_id: USER_ID, role: 'manager', changed: true });

    const { result } = renderHook(() => useSetMemberRole(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: USER_ID, role: 'manager', name: 'Ana' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockSetRole).toHaveBeenCalledWith(CIRCLE_ID, USER_ID, 'manager');
    expect(showToast).toHaveBeenCalledWith('manage.madeManager', 'success');
    expect(mockRoleChanged).toHaveBeenCalledWith('manager');
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('demotes with the "no longer a manager" toast', async () => {
    const { wrapper } = setup();
    mockSetRole.mockResolvedValue({ user_id: USER_ID, role: 'member', changed: true });

    const { result } = renderHook(() => useSetMemberRole(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: USER_ID, role: 'member', name: 'Ana' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(showToast).toHaveBeenCalledWith('manage.removedManager', 'success');
    expect(mockRoleChanged).toHaveBeenCalledWith('member');
  });

  it('fires no analytics when nothing changed (changed:false)', async () => {
    const { wrapper } = setup();
    mockSetRole.mockResolvedValue({ user_id: USER_ID, role: 'manager', changed: false });

    const { result } = renderHook(() => useSetMemberRole(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: USER_ID, role: 'manager', name: 'Ana' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRoleChanged).not.toHaveBeenCalled();
  });

  it('routes 402 SUBSCRIPTION_REQUIRED to the owner-aware upgrade gate, never a toast of its own', async () => {
    const { wrapper } = setup();
    mockSetRole.mockRejectedValue(reject('SUBSCRIPTION_REQUIRED'));

    const { result } = renderHook(() => useSetMemberRole(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: USER_ID, role: 'manager', name: 'Ana' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it.each([
    ['FEATURE_DISABLED', 'errors.managerUnavailable'],
    ['CARE_RECIPIENT_CANNOT_MANAGE', 'errors.careRecipientCannotManage'],
    ['VIEW_ONLY_CANNOT_MANAGE', 'errors.viewOnlyCannotManage'],
    ['CIRCLE_ARCHIVED', 'errors.circleInactive'],
    ['FORBIDDEN', 'errors.permissionDenied'],
    ['NOT_FOUND', 'errors.saveFailed'],
    ['INVALID_REQUEST', 'errors.saveFailed'],
    ['SERVICE_UNAVAILABLE', 'errors.saveFailed'],
  ])('maps %s to %s and refreshes the circle', async (code, key) => {
    const { invalidateSpy, wrapper } = setup();
    mockSetRole.mockRejectedValue(reject(code));

    const { result } = renderHook(() => useSetMemberRole(CIRCLE_ID), { wrapper });
    result.current.mutate({ userId: USER_ID, role: 'manager', name: 'Ana' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith(key, 'error');
    expect(promptUpgrade).not.toHaveBeenCalled();
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
  });
});
