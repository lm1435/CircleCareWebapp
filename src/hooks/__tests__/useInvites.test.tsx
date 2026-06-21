import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock the api module's invite functions so we can assert the exact args and
// drive success/rejection. Keep the rest (types) intact.
vi.mock('@/api/invites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/invites')>();
  return {
    ...actual,
    createInvite: vi.fn(),
    cancelInvite: vi.fn(),
    acceptInvite: vi.fn(),
    getPendingInvites: vi.fn(),
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

import {
  createInvite,
  cancelInvite,
  acceptInvite,
  getPendingInvites,
  type CreateInviteResponse,
  type PendingInvite,
} from '@/api/invites';
import { queryKeys } from '@/lib/queryKeys';
import {
  useCreateInvite,
  useCancelInvite,
  useAcceptInvite,
  usePendingInvites,
} from '@/hooks/useInvites';

const CIRCLE_ID = 'circle-1';
const INVITE_ID = 'invite-1';

const mockCreate = vi.mocked(createInvite);
const mockCancel = vi.mocked(cancelInvite);
const mockAccept = vi.mocked(acceptInvite);
const mockPending = vi.mocked(getPendingInvites);

const CREATE_RESULT: CreateInviteResponse = {
  invite: {
    id: INVITE_ID,
    invited_email: 'a@b.com',
    member_type: 'caregiver',
    invite_code: 'ABC123',
    expires_at: '2026-07-01T00:00:00Z',
  },
  message: 'Invite sent',
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

const SUBSCRIPTION_ENVELOPE = {
  success: false,
  error: { code: 'SUBSCRIPTION_REQUIRED', message: 'upgrade' },
};
const PERMISSION_ENVELOPE = {
  success: false,
  error: { code: 'FORBIDDEN', message: 'owner only' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCreateInvite', () => {
  it('POSTs the invite body and invalidates circle + circles on success', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockResolvedValue(CREATE_RESULT);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    const body = { email: 'a@b.com', member_type: 'caregiver' as const };
    result.current.mutate(body);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCreate).toHaveBeenCalledWith(CIRCLE_ID, body);

    expect(invalidatedWith(invalidateSpy, queryKeys.circle(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('surfaces a 402 (free-tier caregiver cap) as the subscription toast', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.subscriptionRequired', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('surfaces a 403 as the permission toast + refetches circles', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockRejectedValue(PERMISSION_ENVELOPE);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });
});

describe('useCancelInvite', () => {
  it('DELETEs the invite by id and invalidates circle queries', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCancel.mockResolvedValue(undefined);

    const { result } = renderHook(() => useCancelInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ inviteId: INVITE_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCancel).toHaveBeenCalledWith(INVITE_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.circle(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });
});

describe('useAcceptInvite', () => {
  it('POSTs accept by id and invalidates invitesPending + circles', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockAccept.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAcceptInvite(), { wrapper });
    result.current.mutate({ inviteId: INVITE_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockAccept).toHaveBeenCalledWith(INVITE_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.invitesPending)).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });
});

describe('usePendingInvites', () => {
  it('reads from the invitesPending key', async () => {
    const { wrapper } = setup();
    const invites: PendingInvite[] = [
      {
        id: INVITE_ID,
        member_type: 'caregiver',
        circle: { id: CIRCLE_ID, name: 'Mom', recipient_name: 'Mom' },
        invited_by: { email: 'x@y.com', first_name: 'X', last_name: 'Y' },
        created_at: '2026-06-01T00:00:00Z',
        expires_at: '2026-07-01T00:00:00Z',
      },
    ];
    mockPending.mockResolvedValue(invites);

    const { result } = renderHook(() => usePendingInvites(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockPending).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(invites);
  });
});
