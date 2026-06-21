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
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

import {
  removeMember,
  leaveCircle,
  setMedicationResponsible,
} from '@/api/circleMembers';
import { queryKeys } from '@/lib/queryKeys';
import {
  useRemoveMember,
  useLeaveCircle,
  useSetMedicationResponsible,
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
});
