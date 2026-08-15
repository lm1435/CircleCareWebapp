import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mirrors the pattern in useInvites.test.tsx — mock the api module's
// join-by-code functions so we can assert exact args and drive success.
vi.mock('@/api/invites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/invites')>();
  return {
    ...actual,
    lookupInviteByCode: vi.fn(),
    acceptInviteByCode: vi.fn(),
  };
});

import {
  lookupInviteByCode,
  acceptInviteByCode,
  type InviteByCode,
} from '@/api/invites';
import { queryKeys } from '@/lib/queryKeys';
import { useLookupInviteByCode, useAcceptInviteByCode } from '@/hooks/useJoinCircle';

const CODE = 'ABC123';

const mockLookup = vi.mocked(lookupInviteByCode);
const mockAccept = vi.mocked(acceptInviteByCode);

const LOOKUP_RESULT: InviteByCode = {
  id: 'invite-1',
  invite_code: CODE,
  member_type: 'caregiver',
  circle: { id: 'circle-1', name: "Rose's Circle", recipient_name: 'Rose Meza' },
  invited_by: { email: 'ada@example.com', first_name: 'Ada', last_name: null },
  expires_at: '2026-07-01T00:00:00Z',
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useLookupInviteByCode', () => {
  it('GETs the invite by code', async () => {
    const { wrapper } = setup();
    mockLookup.mockResolvedValue(LOOKUP_RESULT);

    const { result } = renderHook(() => useLookupInviteByCode(), { wrapper });
    result.current.mutate(CODE);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockLookup).toHaveBeenCalledWith(CODE);
    expect(result.current.data).toEqual(LOOKUP_RESULT);
  });
});

describe('useAcceptInviteByCode', () => {
  it('POSTs accept by code', async () => {
    const { wrapper } = setup();
    mockAccept.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAcceptInviteByCode(), { wrapper });
    result.current.mutate(CODE);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockAccept).toHaveBeenCalledWith(CODE);
  });

  // WB5 REGRESSION — accept-by-code invalidated only `circles`, unlike
  // useAcceptInvite (by-id), which also invalidates `invitesPending`. A code
  // can resolve the SAME invite a user sees in /invites/pending (they typed
  // the code instead of tapping the emailed link's "Accept" button there),
  // which would otherwise keep showing a now-stale row. Old code: only the
  // `circles` assertion below passes; `invitesPending` never gets invalidated.
  it('invalidates invitesPending AND circles on success (matches useAcceptInvite)', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockAccept.mockResolvedValue(undefined);

    const { result } = renderHook(() => useAcceptInviteByCode(), { wrapper });
    result.current.mutate(CODE);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedWith(invalidateSpy, queryKeys.invitesPending)).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('does NOT invalidate anything on failure', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockAccept.mockRejectedValue({ error: { code: 'INVITE_EXPIRED' } });

    const { result } = renderHook(() => useAcceptInviteByCode(), { wrapper });
    result.current.mutate(CODE);

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
