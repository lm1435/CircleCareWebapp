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
    resendInvite: vi.fn(),
    acceptInvite: vi.fn(),
    getPendingInvites: vi.fn(),
  };
});

// Deterministic translations so error toasts assert on a stable key string.
// Interpolation values are appended verbatim (`key:value`) so a message that
// must NAME the blocking invitee is assertable without loading real i18n.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.email != null ? `${key}:${String(opts.email)}` : key,
  }),
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
  createInvite,
  cancelInvite,
  resendInvite,
  acceptInvite,
  getPendingInvites,
  type CreateInviteResponse,
  type PendingInvite,
  type ResendInviteResult,
} from '@/api/invites';
import { queryKeys } from '@/lib/queryKeys';
import {
  useCreateInvite,
  useCancelInvite,
  useResendInvite,
  useAcceptInvite,
  usePendingInvites,
} from '@/hooks/useInvites';

const CIRCLE_ID = 'circle-1';
const INVITE_ID = 'invite-1';

const mockCreate = vi.mocked(createInvite);
const mockCancel = vi.mocked(cancelInvite);
const mockResend = vi.mocked(resendInvite);
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
// 402s that carry the additive `error.details` payload. `pending_invite_seat`
// is RECOVERABLE (cancel the blocking invite) so it must never hit the paywall;
// `members_full` and a details-less envelope both must.
const PENDING_SEAT_ENVELOPE = {
  success: false,
  error: {
    code: 'SUBSCRIPTION_REQUIRED',
    message: 'upgrade',
    details: {
      reason: 'pending_invite_seat',
      active_caregivers: 1,
      caregiver_limit: 2,
      blocking_invite: { id: 'inv-blocking', invited_email: 'blocked@example.com' },
    },
  },
};
const MEMBERS_FULL_ENVELOPE = {
  success: false,
  error: {
    code: 'SUBSCRIPTION_REQUIRED',
    message: 'upgrade',
    details: {
      reason: 'members_full',
      active_caregivers: 2,
      caregiver_limit: 2,
      blocking_invite: null,
    },
  },
};
const PERMISSION_ENVELOPE = {
  success: false,
  error: { code: 'FORBIDDEN', message: 'owner only' },
};
const ALREADY_MEMBER_ENVELOPE = {
  success: false,
  error: { code: 'ALREADY_MEMBER', message: 'already a member' },
};
const PENDING_INVITE_ENVELOPE = {
  success: false,
  error: { code: 'PENDING_INVITE', message: 'invite already pending' },
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
    expect(promptUpgrade).toHaveBeenCalled();
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('names the blocking invitee on a pending_invite_seat 402, and still offers the upgrade', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockCreate.mockRejectedValue(PENDING_SEAT_ENVELOPE);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // The seat is recoverable — a paywall would be the wrong answer.
    // Explains WHY (cancelling the blocking invite is the free way out) while
    // keeping the Upgrade action, since buying more seats is the other way out.
    expect(promptUpgrade).toHaveBeenCalledWith('errors.pendingInviteSeat:blocked@example.com');
    expect(showToast).not.toHaveBeenCalledWith(
      'errors.pendingInviteSeat:blocked@example.com',
      'error'
    );
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('falls back to a nameless pending-seat message when blocking_invite is missing', async () => {
    const { wrapper } = setup();
    mockCreate.mockRejectedValue({
      success: false,
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'upgrade',
        details: { reason: 'pending_invite_seat', blocking_invite: null },
      },
    });

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalledWith('errors.pendingInviteSeatUnknown');
    expect(showToast).not.toHaveBeenCalledWith('errors.pendingInviteSeatUnknown', 'error');
  });

  it('prompts the upgrade for a members_full 402', async () => {
    const { wrapper } = setup();
    mockCreate.mockRejectedValue(MEMBERS_FULL_ENVELOPE);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('prompts the upgrade when an unrecognized reason arrives', async () => {
    const { wrapper } = setup();
    mockCreate.mockRejectedValue({
      success: false,
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'upgrade',
        details: { reason: 'something_new_from_a_future_backend' },
      },
    });

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
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

  it('surfaces an ALREADY_MEMBER error as the already-member toast', async () => {
    const { wrapper } = setup();
    mockCreate.mockRejectedValue(ALREADY_MEMBER_ENVELOPE);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.alreadyMember', 'error');
  });

  it('surfaces a PENDING_INVITE error as the pending-invite toast', async () => {
    const { wrapper } = setup();
    mockCreate.mockRejectedValue(PENDING_INVITE_ENVELOPE);

    const { result } = renderHook(() => useCreateInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ email: 'a@b.com', member_type: 'caregiver' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.pendingInvite', 'error');
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

describe('useResendInvite', () => {
  const RESEND_RESULT: ResendInviteResult = {
    invite: {
      id: INVITE_ID,
      invited_email: 'a@b.com',
      member_type: 'caregiver',
      expires_at: '2026-08-23T00:00:00Z',
      is_expired: false,
    },
    email_sent: true,
  };

  it('POSTs the resend by id and invalidates circle + circleDetail + circles', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockResend.mockResolvedValue(RESEND_RESULT);

    const { result } = renderHook(() => useResendInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ inviteId: INVITE_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockResend).toHaveBeenCalledWith(INVITE_ID);
    expect(invalidatedWith(invalidateSpy, queryKeys.circle(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circleDetail(CIRCLE_ID))).toBe(true);
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('returns the refreshed invite (expires_at extended, is_expired false)', async () => {
    const { wrapper } = setup();
    mockResend.mockResolvedValue(RESEND_RESULT);

    const { result } = renderHook(() => useResendInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ inviteId: INVITE_ID });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(RESEND_RESULT);
  });

  it('routes a 402 (reviving an expired invite past the cap) to promptUpgrade', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockResend.mockRejectedValue(SUBSCRIPTION_ENVELOPE);

    const { result } = renderHook(() => useResendInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ inviteId: INVITE_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalled();
    // No generic error toast on 402 — the upgrade prompt is the whole message.
    expect(showToast).not.toHaveBeenCalled();
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  // The headline case: an invite lapsed, the freed seat was spent on somebody
  // ELSE, and the owner then hit Resend on the old row. Cancelling the live
  // invite fixes it, so resend must read exactly like create here — an
  // explanation, never a paywall.
  it('names the blocking invitee on a pending_invite_seat 402, and still offers the upgrade', async () => {
    const { invalidateSpy, wrapper } = setup();
    mockResend.mockRejectedValue(PENDING_SEAT_ENVELOPE);

    const { result } = renderHook(() => useResendInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ inviteId: INVITE_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Explains WHY (cancelling the blocking invite is the free way out) while
    // keeping the Upgrade action, since buying more seats is the other way out.
    expect(promptUpgrade).toHaveBeenCalledWith('errors.pendingInviteSeat:blocked@example.com');
    expect(showToast).not.toHaveBeenCalledWith(
      'errors.pendingInviteSeat:blocked@example.com',
      'error'
    );
    // Never the generic resend-failed copy — that would hide the real reason.
    expect(showToast).not.toHaveBeenCalledWith('manage.resendInviteFailed', 'error');
    expect(invalidatedWith(invalidateSpy, queryKeys.circles)).toBe(true);
  });

  it('prompts the upgrade for a members_full 402', async () => {
    const { wrapper } = setup();
    mockResend.mockRejectedValue(MEMBERS_FULL_ENVELOPE);

    const { result } = renderHook(() => useResendInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ inviteId: INVITE_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(promptUpgrade).toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('surfaces a 403 as the shared permission toast', async () => {
    const { wrapper } = setup();
    mockResend.mockRejectedValue(PERMISSION_ENVELOPE);

    const { result } = renderHook(() => useResendInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ inviteId: INVITE_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('errors.permissionDenied', 'error');
  });

  it('surfaces an unclassified failure with the resend-specific message', async () => {
    const { wrapper } = setup();
    mockResend.mockRejectedValue({
      success: false,
      error: { code: 'INVITE_NOT_PENDING', message: 'not pending' },
    });

    const { result } = renderHook(() => useResendInvite(CIRCLE_ID), { wrapper });
    result.current.mutate({ inviteId: INVITE_ID });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(showToast).toHaveBeenCalledWith('manage.resendInviteFailed', 'error');
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
