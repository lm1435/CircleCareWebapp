import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Plan Stage 8, Task 8.5 — useUpdateCircle / useDeleteCircle hook slice.
// Mocks the circle WRITE API functions (keep getCircles + the Zod schema/types
// intact) and asserts: right api call, right invalidation, 402/403 toasts.

vi.mock('@/api/circles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circles')>();
  return {
    ...actual,
    createCircle: vi.fn(),
    updateCircle: vi.fn(),
    deleteCircle: vi.fn(),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

import { createCircle, updateCircle, deleteCircle, type Circle } from '@/api/circles';
import { queryKeys } from '@/lib/queryKeys';
import { useCreateCircle, useUpdateCircle, useDeleteCircle } from '@/hooks/useCircleAdmin';

const CIRCLE_ID = 'circle-1';

const mockCreate = vi.mocked(createCircle);
const mockUpdate = vi.mocked(updateCircle);
const mockDelete = vi.mocked(deleteCircle);

const NEW_CIRCLE = { id: 'circle-new', name: 'Rose' } as Circle;

const CIRCLE_LIMIT_ENVELOPE = {
  success: false,
  error: { code: 'CIRCLE_LIMIT_REACHED', message: 'max 5' },
};

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

const FORBIDDEN_ENVELOPE = {
  success: false,
  error: { code: 'FORBIDDEN', message: 'owner only' },
};

const SUBSCRIPTION_ENVELOPE = {
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'upgrade' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCreateCircle', () => {
  it('POSTs the body, invalidates the list, and returns the new circle', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockResolvedValue(NEW_CIRCLE);

    const body = {
      recipient_name: 'Rose Meza',
      recipient_dob: '1948-05-02',
      recipient_conditions: ['Diabetes'],
      is_self_care: false,
    };

    const { result } = renderHook(() => useCreateCircle(), { wrapper });
    result.current.mutate(body);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCreate).toHaveBeenCalledWith(body);
    expect(result.current.data).toEqual(NEW_CIRCLE);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('surfaces a 402 as the subscription (open app to upgrade) toast', async () => {
    const { wrapper } = setup();
    mockCreate.mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useCreateCircle(), { wrapper });
    result.current.mutate({ recipient_name: 'Rose' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('common:errors.subscriptionRequired', 'error');
  });

  it('surfaces a 403 CIRCLE_LIMIT_REACHED as the distinct max-circles toast', async () => {
    const { wrapper } = setup();
    mockCreate.mockRejectedValue(CIRCLE_LIMIT_ENVELOPE);

    const { result } = renderHook(() => useCreateCircle(), { wrapper });
    result.current.mutate({ recipient_name: 'Rose' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('circles:create.limitReached', 'error');
    // It must NOT use the upgrade copy — the limit can't be lifted by upgrading.
    expect(showToast).not.toHaveBeenCalledWith('common:errors.subscriptionRequired', 'error');
  });
});

describe('useUpdateCircle', () => {
  it('PATCHes the body and invalidates circle queries', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockUpdate.mockResolvedValue(undefined);

    const body = {
      recipient_name: 'Rose Meza',
      recipient_dob: '1948-05-02',
      recipient_conditions: ['Diabetes', 'Hypertension'],
    };

    const { result } = renderHook(() => useUpdateCircle(CIRCLE_ID), { wrapper });
    result.current.mutate(body);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdate).toHaveBeenCalledWith(CIRCLE_ID, body);
    expect(invalidatedWith(invalidateSpy, queryKeys.circle(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('surfaces a 403 as the permission toast', async () => {
    const { wrapper } = setup();
    mockUpdate.mockRejectedValue(FORBIDDEN_ENVELOPE);

    const { result } = renderHook(() => useUpdateCircle(CIRCLE_ID), { wrapper });
    result.current.mutate({ recipient_name: 'Rose' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
  });

  it('surfaces a 402 as the subscription toast', async () => {
    const { wrapper } = setup();
    mockUpdate.mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useUpdateCircle(CIRCLE_ID), { wrapper });
    result.current.mutate({ recipient_name: 'Rose' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.subscriptionRequired', 'error');
  });
});

describe('useDeleteCircle', () => {
  it('DELETEs the circle and invalidates detail + list', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockDelete.mockResolvedValue(undefined);

    const { result } = renderHook(() => useDeleteCircle(CIRCLE_ID), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDelete).toHaveBeenCalledWith(CIRCLE_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('surfaces a 403 as the permission toast', async () => {
    const { wrapper } = setup();
    mockDelete.mockRejectedValue(FORBIDDEN_ENVELOPE);

    const { result } = renderHook(() => useDeleteCircle(CIRCLE_ID), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
  });
});
