import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import MembersPage from '@/pages/MembersPage';
import type { CircleDetail, CircleMember, PendingCircleInvite } from '@/api/circleMembers';

// Stage 5 Task 5.4/5.7 — owner-only member management wiring. The read-only
// roster behavior is covered by MembersPage.test.tsx; this suite focuses on the
// owner/non-owner gating and that confirm dialogs fire the right hook.

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const removeMember = vi.fn();
const leaveCircle = vi.fn();
const setMedResponsible = vi.fn();
vi.mock('@/hooks/useCircleMembers', () => ({
  useRemoveMember: () => ({ mutate: removeMember, isPending: false }),
  useLeaveCircle: () => ({ mutate: leaveCircle, isPending: false }),
  useSetMedicationResponsible: () => ({ mutate: setMedResponsible, isPending: false }),
}));

const cancelInvite = vi.fn();
const resendInvite = vi.fn();
vi.mock('@/hooks/useInvites', () => ({
  useCancelInvite: () => ({ mutate: cancelInvite, isPending: false }),
  useResendInvite: () => ({ mutate: resendInvite, isPending: false }),
  // InviteMemberModal (rendered when "Invite member" is clicked) uses this.
  useCreateInvite: () => ({ mutate: vi.fn(), isPending: false }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

let currentUserId: string | null = 'u-owner';
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } | null }) => unknown) =>
    selector({ user: currentUserId ? { id: currentUserId } : null }),
}));

const useCircleResult: {
  circle: CircleDetail | undefined;
  members: CircleMember[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} = {
  circle: undefined,
  members: [],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => useCircleResult,
}));

function makeMember(overrides: Partial<CircleMember> = {}): CircleMember {
  return {
    id: 'u1',
    email: 'ana@example.com',
    first_name: 'Ana',
    last_name: 'Reyes',
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-02-10T15:00:00Z',
    timezone: 'America/Chicago',
    ...overrides,
  };
}

function makeDetail(
  members: CircleMember[],
  overrides: Partial<CircleDetail> = {}
): CircleDetail {
  return {
    id: 'c1',
    name: "Mom's Care",
    recipient_name: 'Rose',
    recipient_photo_url: null,
    recipient_dob: null,
    recipient_conditions: null,
    owner_id: 'u-owner',
    created_at: '2026-01-01T00:00:00Z',
    is_self_care: false,
    care_recipient_timezone: 'America/Chicago',
    members,
    pending_invites: [],
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    ...overrides,
  };
}

/**
 * An `expires_at` exactly `days` from now. Relative (not a hardcoded date) so
 * the expiring-soon window stays true whenever the suite runs.
 */
function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function setCircle(
  members: CircleMember[],
  overrides: Partial<CircleDetail> = {}
): void {
  const detail = makeDetail(members, overrides);
  useCircleResult.circle = detail;
  useCircleResult.members = members;
}

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/circles/c1/members']}>
      <Routes>
        <Route path="/circles/:circleId/members" element={<MembersPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  currentUserId = 'u-owner';
  useCircleResult.circle = undefined;
  useCircleResult.members = [];
});

describe('MembersPage — owner management', () => {
  it('shows the Invite member button for the owner', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })]);
    renderPage();
    expect(screen.getByRole('button', { name: 'Invite member' })).toBeInTheDocument();
  });

  it('hides the Invite member button and shows Leave for a non-owner', () => {
    currentUserId = 'u1';
    setCircle([
      makeMember({ id: 'u-owner', first_name: 'Luis', role: 'owner' }),
      makeMember({ id: 'u1' }),
    ]);
    renderPage();
    expect(screen.queryByRole('button', { name: 'Invite member' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave circle' })).toBeInTheDocument();
  });

  it('shows the solo-owner prompt to invite the first caregiver and opens the modal', async () => {
    const user = userEvent.setup();
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })]);
    renderPage();
    expect(screen.getByText('Care is easier together')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Invite your first caregiver' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Invite a member');
  });

  it('hides the solo-owner prompt once another member exists', () => {
    setCircle([
      makeMember({ id: 'u-owner', role: 'owner' }),
      makeMember({ id: 'u1', first_name: 'Ana' }),
    ]);
    renderPage();
    expect(screen.queryByText('Care is easier together')).not.toBeInTheDocument();
  });

  it('opens the invite modal when the owner clicks Invite member', async () => {
    const user = userEvent.setup();
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })]);
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Invite a member');
  });

  it('owner-removing a caregiver fires useRemoveMember after confirm', async () => {
    const user = userEvent.setup();
    setCircle([
      makeMember({ id: 'u-owner', first_name: 'Luis', role: 'owner' }),
      makeMember({ id: 'u1', first_name: 'Ana' }),
    ]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Remove Ana Reyes' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(removeMember).toHaveBeenCalledTimes(1);
    expect(removeMember.mock.calls[0][0]).toEqual({ userId: 'u1' });
  });

  it('does not offer remove/med-manager actions for the care recipient', () => {
    setCircle([
      makeMember({ id: 'u-owner', role: 'owner' }),
      makeMember({ id: 'u3', first_name: 'Rose', is_care_recipient: true }),
    ]);
    renderPage();
    expect(screen.queryByRole('button', { name: /Remove Rose/ })).not.toBeInTheDocument();
  });

  it('toggling the medication manager fires useSetMedicationResponsible with the user id', async () => {
    const user = userEvent.setup();
    setCircle([
      makeMember({ id: 'u-owner', role: 'owner' }),
      makeMember({ id: 'u1', first_name: 'Ana', is_medication_responsible: false }),
    ]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Make medication manager' }));
    expect(setMedResponsible).toHaveBeenCalledWith('u1', expect.anything());
    expect(setMedResponsible.mock.calls[0][0]).toBe('u1');
  });

  it('clearing the medication manager passes null', async () => {
    const user = userEvent.setup();
    setCircle([
      makeMember({ id: 'u-owner', role: 'owner' }),
      makeMember({ id: 'u1', first_name: 'Ana', is_medication_responsible: true }),
    ]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Remove medication manager' }));
    expect(setMedResponsible.mock.calls[0][0]).toBeNull();
  });

  it('leaving the circle fires useLeaveCircle and navigates to /circles', async () => {
    const user = userEvent.setup();
    currentUserId = 'u1';
    leaveCircle.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    setCircle([
      makeMember({ id: 'u-owner', first_name: 'Luis', role: 'owner' }),
      makeMember({ id: 'u1' }),
    ]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Leave circle' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Leave circle' }));

    expect(leaveCircle).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/circles');
  });

  it('lists pending invites and cancels one via useCancelInvite after confirm', async () => {
    const user = userEvent.setup();
    const invite: PendingCircleInvite = {
      id: 'inv-1',
      invited_email: 'pending@example.com',
      created_at: '2026-06-01T00:00:00Z',
      // Relative, not hardcoded: a fixed date silently becomes an EXPIRED
      // row once it passes, changing what this test renders.
      expires_at: inDays(6),
    };
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], { pending_invites: [invite] });
    renderPage();

    expect(screen.getByText('pending@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel invite for pending@example.com' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel invite' }));

    expect(cancelInvite).toHaveBeenCalledTimes(1);
    expect(cancelInvite.mock.calls[0][0]).toEqual({ inviteId: 'inv-1' });
  });
});

// Expired invites stay in `pending_invites`; `is_expired` (server-computed) is
// the only thing separating them from live ones, with an `expires_at` fallback
// for backends that predate the field.
describe('MembersPage — expired invites', () => {
  function makeInvite(overrides: Partial<PendingCircleInvite> = {}): PendingCircleInvite {
    return {
      id: 'inv-1',
      invited_email: 'lapsed@example.com',
      created_at: '2026-06-01T00:00:00Z',
      // Relative, not hardcoded: a fixed date silently becomes an EXPIRED
      // row once it passes, changing what this test renders.
      expires_at: inDays(6),
      ...overrides,
    };
  }

  it('badges an expired invite and offers Resend', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ is_expired: true })],
    });
    renderPage();

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Resend invite for lapsed@example.com' })
    ).toBeInTheDocument();
  });

  it('shows no badge and no Resend for a live invite', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [
        makeInvite({ is_expired: false, expires_at: '2099-01-01T00:00:00Z' }),
      ],
    });
    renderPage();

    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resend invite for/ })).not.toBeInTheDocument();
    // Cancel is still available on a live invite.
    expect(
      screen.getByRole('button', { name: 'Cancel invite for lapsed@example.com' })
    ).toBeInTheDocument();
  });

  it('falls back to expires_at when the backend omits is_expired', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      // No `is_expired` key at all — an older backend. expires_at is in the past.
      pending_invites: [makeInvite({ expires_at: '2020-01-01T00:00:00Z' })],
    });
    renderPage();

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Resend invite for lapsed@example.com' })
    ).toBeInTheDocument();
  });

  it('trusts is_expired over the local clock when they disagree', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      // expires_at is in the past locally, but the server says it is still live.
      pending_invites: [makeInvite({ is_expired: false, expires_at: '2020-01-01T00:00:00Z' })],
    });
    renderPage();

    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });

  it('resending fires useResendInvite with the invite id and toasts on success', async () => {
    const user = userEvent.setup();
    resendInvite.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ is_expired: true })],
    });
    renderPage();

    await user.click(
      screen.getByRole('button', { name: 'Resend invite for lapsed@example.com' })
    );

    expect(resendInvite).toHaveBeenCalledTimes(1);
    expect(resendInvite.mock.calls[0][0]).toEqual({ inviteId: 'inv-1' });
    expect(showToast).toHaveBeenCalledWith(
      'Invitation sent again to lapsed@example.com.',
      'success'
    );
  });

  it('labels each row distinctly so several expired invites stay distinguishable', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [
        makeInvite({ id: 'inv-1', invited_email: 'a@example.com', is_expired: true }),
        makeInvite({ id: 'inv-2', invited_email: 'b@example.com', is_expired: true }),
      ],
    });
    renderPage();

    expect(screen.getAllByText('Expired')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Resend invite for a@example.com' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resend invite for b@example.com' })).toBeInTheDocument();
  });

  // An expired invite is not "someone you invited" — it can't be accepted. The
  // solo-owner nudge keys off the SAME pending_invites array the checklist does,
  // so both must ignore lapsed rows or a solo owner is silently never nudged.
  it('still shows the solo-owner nudge when the only pending invite has expired', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ is_expired: true })],
    });
    renderPage();

    expect(screen.getByText('Care is easier together')).toBeInTheDocument();
    // The lapsed invite is still listed, with the way out.
    expect(
      screen.getByRole('button', { name: 'Resend invite for lapsed@example.com' })
    ).toBeInTheDocument();
  });

  it('hides the solo-owner nudge while a LIVE invite is outstanding', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ is_expired: false, expires_at: '2099-01-01T00:00:00Z' })],
    });
    renderPage();

    expect(screen.queryByText('Care is easier together')).not.toBeInTheDocument();
  });

  // The 402 message itself is the shared hook mapper's job (mocked here), so
  // what this asserts is that the PAGE stays out of its way: no contradicting
  // toast of its own, and the row unlocks so the owner can retry after
  // cancelling the invite that is holding the seat.
  it('re-enables the row and adds no toast of its own when resend is refused for a held seat', async () => {
    const user = userEvent.setup();
    const PENDING_SEAT_ENVELOPE = {
      success: false,
      error: {
        code: 'SUBSCRIPTION_REQUIRED',
        message: 'upgrade',
        details: {
          reason: 'pending_invite_seat',
          active_caregivers: 1,
          caregiver_limit: 2,
          blocking_invite: { id: 'inv-2', invited_email: 'other@example.com' },
        },
      },
    };
    resendInvite.mockImplementation((_vars, opts) => opts?.onError?.(PENDING_SEAT_ENVELOPE));
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ is_expired: true })],
    });
    renderPage();

    const button = screen.getByRole('button', {
      name: 'Resend invite for lapsed@example.com',
    });
    await user.click(button);

    expect(resendInvite).toHaveBeenCalledTimes(1);
    // No success toast, and no page-level failure toast competing with the
    // hook's explanation.
    expect(showToast).not.toHaveBeenCalled();
    expect(button).toBeEnabled();

    // The seat can be freed by cancelling — so a retry must still be possible.
    await user.click(button);
    expect(resendInvite).toHaveBeenCalledTimes(2);
  });

  it('shows a muted countdown but no Resend for a comfortably live invite', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ is_expired: false, expires_at: inDays(6) })],
    });
    renderPage();

    const line = screen.getByText('Expires in 6 days');
    expect(line).toBeInTheDocument();
    // Muted/secondary tone — a live invite is not a problem to solve.
    expect(line.parentElement?.className).toContain('text-ink-3');
    expect(line.parentElement?.className).not.toContain('text-clay-deep');
    expect(screen.queryByRole('button', { name: /^Resend invite for/ })).not.toBeInTheDocument();
  });

  it('does not fire a second resend while one is in flight', async () => {
    const user = userEvent.setup();
    // Never settles — the in-handler guard is the only thing stopping a double fire.
    resendInvite.mockImplementation(() => undefined);
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ is_expired: true })],
    });
    renderPage();

    const button = screen.getByRole('button', { name: 'Resend invite for lapsed@example.com' });
    await user.click(button);
    await user.click(button);

    expect(resendInvite).toHaveBeenCalledTimes(1);
  });
});

// An invite inside the 3-day window is still usable — the owner just has a
// closing door. Resend extends it by 7 days server-side and consumes no extra
// seat, so it is offered BEFORE the lapse, not only after.
describe('MembersPage — invites expiring soon', () => {
  function makeInvite(overrides: Partial<PendingCircleInvite> = {}): PendingCircleInvite {
    return {
      id: 'inv-1',
      invited_email: 'soon@example.com',
      created_at: '2026-06-01T00:00:00Z',
      expires_at: inDays(2),
      ...overrides,
    };
  }

  it('warns with an emphasized countdown but offers NO Resend', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ is_expired: false })],
    });
    renderPage();

    const line = screen.getByText('Expires in 2 days');
    expect(line).toBeInTheDocument();
    // Caution tone (clay-deep, 8.03:1 on cream) — NOT the terracotta error tone.
    expect(line.parentElement?.className).toContain('text-clay-deep');
    expect(line.parentElement?.className).not.toContain('terracotta');
    // Not dead yet: no Expired badge.
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    // Resend is expired-only by design: the recipient still holds a working
    // link, so "Resend" would imply a failure that has not happened.
    expect(
      screen.queryByRole('button', { name: 'Resend invite for soon@example.com' })
    ).not.toBeInTheDocument();
    // Cancel stays available in every state.
    expect(
      screen.getByRole('button', { name: 'Cancel invite for soon@example.com' })
    ).toBeInTheDocument();
  });

  it('singularizes the countdown on the last day', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      // A few hours left rounds UP to 1 day — never "0 days".
      pending_invites: [makeInvite({ expires_at: inDays(0.25) })],
    });
    renderPage();

    expect(screen.getByText('Expires in 1 day')).toBeInTheDocument();
  });

  it('resending an EXPIRED invite fires useResendInvite with its id', async () => {
    const user = userEvent.setup();
    resendInvite.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ id: 'inv-9', is_expired: true })],
    });
    renderPage();

    await user.click(
      screen.getByRole('button', { name: 'Resend invite for soon@example.com' })
    );

    expect(resendInvite.mock.calls[0][0]).toEqual({ inviteId: 'inv-9' });
    expect(showToast).toHaveBeenCalledWith(
      'Invitation sent again to soon@example.com.',
      'success'
    );
  });

  it('carries the email in the announced countdown so rows stay distinguishable', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [
        makeInvite({ id: 'inv-1', invited_email: 'a@example.com' }),
        makeInvite({ id: 'inv-2', invited_email: 'b@example.com' }),
      ],
    });
    renderPage();

    // The visible copy repeats verbatim; the screen-reader copy does not.
    expect(screen.getAllByText('Expires in 2 days')).toHaveLength(2);
    expect(
      screen.getByText('Invitation for a@example.com expires in 2 days')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Invitation for b@example.com expires in 2 days')
    ).toBeInTheDocument();
  });

  it('shows no countdown at all when expires_at is unusable', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite({ expires_at: 'not-a-date' })],
    });
    renderPage();

    // Treated as live: no invented countdown, no Expired badge, no Resend.
    expect(screen.queryByText(/^Expires in/)).not.toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resend invite for/ })).not.toBeInTheDocument();
  });

  it('keeps a soon-to-lapse invite suppressing the solo-owner nudge', () => {
    setCircle([makeMember({ id: 'u-owner', role: 'owner' })], {
      pending_invites: [makeInvite()],
    });
    renderPage();

    expect(screen.queryByText('Care is easier together')).not.toBeInTheDocument();
  });
});
