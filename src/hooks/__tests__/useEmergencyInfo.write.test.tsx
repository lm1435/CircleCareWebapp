import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api module's WRITE fn only (keep types/read fn + Zod intact).
vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return {
    ...actual,
    updateEmergencyInfo: vi.fn(),
  };
});

// Deterministic translations so error toasts assert on a stable key string.
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

import {
  updateEmergencyInfo,
  type EmergencyContact,
  type InsurancePlan,
} from '@/api/emergencyInfo';
import { queryKeys } from '@/lib/queryKeys';
import {
  appendItem,
  filterOutIndex,
  replaceAtIndex,
  upsertWithPrimaryExclusivity,
  useUpdateEmergencyInfo,
} from '@/hooks/useEmergencyInfo';

const CIRCLE_ID = 'circle-1';
const mockUpdate = vi.mocked(updateEmergencyInfo);

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { invalidateSpy, wrapper };
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

const SUBSCRIPTION_ENVELOPE = {
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'upgrade' },
};
const PERMISSION_ENVELOPE = {
  success: false,
  error: { code: 'VIEW_ONLY', message: 'read only' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Pure array helpers
// ---------------------------------------------------------------------------
describe('read-modify-write array helpers', () => {
  const contacts: EmergencyContact[] = [
    { name: 'A', relationship: 'Son', phone: '1' },
    { name: 'B', relationship: 'Daughter', phone: '2' },
  ];

  it('appendItem adds to the end without mutating the input', () => {
    const next = appendItem(contacts, { name: 'C', relationship: 'Nurse', phone: '3' });
    expect(next).toHaveLength(3);
    expect(next[2].name).toBe('C');
    expect(contacts).toHaveLength(2); // unchanged
  });

  it('replaceAtIndex swaps the item at index', () => {
    const next = replaceAtIndex(contacts, 1, { name: 'B2', relationship: 'Daughter', phone: '9' });
    expect(next[1].name).toBe('B2');
    expect(next[0].name).toBe('A');
    expect(contacts[1].name).toBe('B'); // input unchanged
  });

  it('replaceAtIndex appends when index is out of range', () => {
    const next = replaceAtIndex(contacts, 5, { name: 'Z', relationship: 'x', phone: '0' });
    expect(next).toHaveLength(3);
    expect(next[2].name).toBe('Z');
  });

  it('filterOutIndex removes the item at index', () => {
    const next = filterOutIndex(contacts, 0);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('B');
    expect(contacts).toHaveLength(2); // input unchanged
  });

  describe('upsertWithPrimaryExclusivity', () => {
    const withPrimary: EmergencyContact[] = [
      { name: 'A', relationship: 'Son', phone: '1', is_primary: true },
      { name: 'B', relationship: 'Daughter', phone: '2', is_primary: false },
    ];

    it('clears is_primary on others when ADDING a primary item', () => {
      const next = upsertWithPrimaryExclusivity(withPrimary, {
        name: 'C',
        relationship: 'Nurse',
        phone: '3',
        is_primary: true,
      });
      expect(next).toHaveLength(3);
      expect(next.filter((c) => c.is_primary)).toHaveLength(1);
      expect(next[2].name).toBe('C');
      expect(next[2].is_primary).toBe(true);
      expect(next[0].is_primary).toBe(false);
    });

    it('clears is_primary on others when EDITING an item to primary', () => {
      const next = upsertWithPrimaryExclusivity(
        withPrimary,
        { name: 'B', relationship: 'Daughter', phone: '2', is_primary: true },
        1
      );
      expect(next.filter((c) => c.is_primary)).toHaveLength(1);
      expect(next[1].is_primary).toBe(true);
      expect(next[0].is_primary).toBe(false);
    });

    it('does NOT touch other primary flags when the item is not primary', () => {
      const next = upsertWithPrimaryExclusivity(
        withPrimary,
        { name: 'B', relationship: 'Daughter', phone: '2', is_primary: false },
        1
      );
      // A stays primary because the saved item is not primary.
      expect(next[0].is_primary).toBe(true);
      expect(next[1].is_primary).toBe(false);
    });

    it('works the same for insurance plans (primary exclusivity)', () => {
      const plans: InsurancePlan[] = [
        { carrier: 'Aetna', is_primary: true },
        { carrier: 'Cigna', is_primary: false },
      ];
      const next = upsertWithPrimaryExclusivity(plans, { carrier: 'BCBS', is_primary: true });
      expect(next.filter((p) => p.is_primary)).toHaveLength(1);
      expect(next[2].carrier).toBe('BCBS');
      expect(next[0].is_primary).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Mutation hook
// ---------------------------------------------------------------------------
describe('useUpdateEmergencyInfo', () => {
  it('PUTs the partial and invalidates emergencyInfo + activityFeed on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdate.mockResolvedValue({ id: 'ei-1', circle_id: CIRCLE_ID } as never);

    const { result } = renderHook(() => useUpdateEmergencyInfo(CIRCLE_ID), { wrapper });
    const partial = { blood_type: 'O+' };
    result.current.mutate(partial);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdate).toHaveBeenCalledWith(CIRCLE_ID, partial);
    expect(invalidatedWith(invalidateSpy, queryKeys.emergencyInfo(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.activityFeed(CIRCLE_ID))).toBe(true);
  });

  it('surfaces a 402 → subscriptionRequired toast + refetch circles', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdate.mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useUpdateEmergencyInfo(CIRCLE_ID), { wrapper });
    result.current.mutate({ blood_type: 'O+' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalled();
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('surfaces a 403 (view-only) → permissionDenied toast + refetch circles', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdate.mockRejectedValue(PERMISSION_ENVELOPE);

    const { result } = renderHook(() => useUpdateEmergencyInfo(CIRCLE_ID), { wrapper });
    result.current.mutate({ blood_type: 'O+' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });
});
