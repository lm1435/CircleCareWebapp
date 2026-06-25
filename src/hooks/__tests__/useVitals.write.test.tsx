import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api module's WRITE functions only (keep types/read fns + isManualVital intact).
vi.mock('@/api/vitals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/vitals')>();
  return {
    ...actual,
    createVital: vi.fn(),
    updateVital: vi.fn(),
    deleteVital: vi.fn(),
  };
});

// Deterministic translations so toast assertions key off a stable string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

const promptUpgrade = vi.fn();
vi.mock('@/hooks/usePremiumGate', () => ({ usePremiumGate: () => ({ promptUpgrade }) }));

import {
  createVital,
  updateVital,
  deleteVital,
  type CreateVitalRequest,
  type HealthVital,
} from '@/api/vitals';
import { queryKeys } from '@/lib/queryKeys';
import {
  canEditVital,
  useCreateVital,
  useUpdateVital,
  useDeleteVital,
} from '@/hooks/useVitals';

const CIRCLE_ID = 'circle-1';
const VITAL_ID = 'vital-1';

const mockCreate = vi.mocked(createVital);
const mockUpdate = vi.mocked(updateVital);
const mockDelete = vi.mocked(deleteVital);

function makeVital(overrides: Partial<HealthVital> = {}): HealthVital {
  return {
    id: VITAL_ID,
    circle_id: CIRCLE_ID,
    vital_type: 'heart_rate',
    value1: 72,
    value2: null,
    unit: 'bpm',
    source: 'manual',
    recorded_at: '2026-06-20T10:00:00.000Z',
    recorded_by: 'user-1',
    notes: null,
    created_at: '2026-06-20T10:00:00.000Z',
    updated_at: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

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

const SUBSCRIPTION_ENVELOPE = {
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'upgrade' },
};
const PERMISSION_ENVELOPE = {
  success: false,
  error: { code: 'FORBIDDEN', message: 'view only' },
};

const CREATE_BODY: CreateVitalRequest = {
  vital_type: 'weight',
  value1: 68.0388555, // 150 lbs already converted to canonical kg by the form layer
  unit: 'kg',
  source: 'manual',
  recorded_at: '2026-06-20T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCreateVital', () => {
  it('posts the canonical body and invalidates vitals + vitalsLatest on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockResolvedValue(makeVital({ vital_type: 'weight', value1: 68.0388555, unit: 'kg' }));

    const { result } = renderHook(() => useCreateVital(CIRCLE_ID), { wrapper });
    result.current.mutate(CREATE_BODY);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCreate).toHaveBeenCalledWith(CIRCLE_ID, CREATE_BODY);
    expect(invalidatedWith(invalidateSpy, queryKeys.vitals(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.vitalsLatest(CIRCLE_ID))).toBe(true);
  });

  it('surfaces a 402 → subscriptionRequired toast + refetch circles', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useCreateVital(CIRCLE_ID), { wrapper });
    result.current.mutate(CREATE_BODY);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalled();
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('surfaces a 403 → permissionDenied toast + refetch circles', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockRejectedValue(PERMISSION_ENVELOPE);

    const { result } = renderHook(() => useCreateVital(CIRCLE_ID), { wrapper });
    result.current.mutate(CREATE_BODY);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });
});

describe('useUpdateVital', () => {
  it('PUTs {id,data} and invalidates vitals + vitalsLatest on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdate.mockResolvedValue(makeVital({ value1: 80 }));

    const data = { value1: 80, unit: 'bpm', recorded_at: '2026-06-20T10:00:00.000Z', notes: null };
    const { result } = renderHook(() => useUpdateVital(CIRCLE_ID), { wrapper });
    result.current.mutate({ id: VITAL_ID, data });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdate).toHaveBeenCalledWith(CIRCLE_ID, VITAL_ID, data);
    expect(invalidatedWith(invalidateSpy, queryKeys.vitals(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.vitalsLatest(CIRCLE_ID))).toBe(true);
  });
});

describe('useDeleteVital', () => {
  it('deletes by id and invalidates vitals + vitalsLatest on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteVital(CIRCLE_ID), { wrapper });
    result.current.mutate(VITAL_ID);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith(CIRCLE_ID, VITAL_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.vitals(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.vitalsLatest(CIRCLE_ID))).toBe(true);
  });
});

describe('canEditVital (manual-only edit/delete guard)', () => {
  it('allows manual readings and blocks synced ones (UI gate; backend 403s too)', () => {
    expect(canEditVital(makeVital({ source: 'manual' }))).toBe(true);
    expect(canEditVital(makeVital({ source: 'apple_health' }))).toBe(false);
    expect(canEditVital(makeVital({ source: 'google_health_connect' }))).toBe(false);
  });
});
