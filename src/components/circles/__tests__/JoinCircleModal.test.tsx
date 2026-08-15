import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { JoinCircleModal } from '../JoinCircleModal';

// Web port parity test for mobile's JoinCircleModal. Mocks the lookup/accept
// mutations + toast so the test focuses on the two-step flow:
//   - look up a code → preview the circle (name / caring for / role)
//   - a bad code surfaces a localized error
//   - accept → toast + close + onJoined(circleId)
//   - "enter a different code" returns to the code entry step

const lookupMutate = vi.fn();
const acceptMutate = vi.fn();
vi.mock('@/hooks/useJoinCircle', () => ({
  useLookupInviteByCode: () => ({ mutate: lookupMutate, isPending: false }),
  useAcceptInviteByCode: () => ({ mutate: acceptMutate, isPending: false }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

// R4-5 onboarding funnel — a successful join must report completion (guarded
// inside the mocked module, so here we only assert the wire-up).
const trackOnboardingCompleted = vi.fn();
vi.mock('@/lib/onboardingAnalytics', () => ({
  trackOnboardingCompleted: (path: string) => trackOnboardingCompleted(path),
}));

// WB4 — the join-by-code path previously fired no invite_accepted event at all.
const inviteAccepted = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: { inviteAccepted: (...args: unknown[]) => inviteAccepted(...args) },
}));

const INVITE = {
  id: 'invite-1',
  invite_code: 'ABC123',
  member_type: 'caregiver' as const,
  circle: { id: 'circle-1', name: "Rose's Circle", recipient_name: 'Rose Meza' },
  invited_by: { email: 'ada@example.com', first_name: 'Ada', last_name: null },
  expires_at: '2026-07-01T00:00:00Z',
};

function renderModal(overrides: Partial<Parameters<typeof JoinCircleModal>[0]> = {}) {
  const onClose = overrides.onClose ?? vi.fn();
  const onJoined = overrides.onJoined ?? vi.fn();
  render(
    <MemoryRouter>
      <JoinCircleModal onClose={onClose} onJoined={onJoined} />
    </MemoryRouter>
  );
  return { onClose, onJoined };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JoinCircleModal', () => {
  it('looks up a code (normalized) and previews the circle', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    renderModal();

    await user.type(screen.getByLabelText('Invite code'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));

    expect(lookupMutate).toHaveBeenCalledWith('ABC123', expect.anything());
    await waitFor(() => expect(screen.getByText("Rose's Circle")).toBeInTheDocument());
    expect(screen.getByText('Rose Meza')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Your role')).toBeInTheDocument();
    expect(screen.getByText('Caregiver')).toBeInTheDocument();
  });

  it('collapses the duplicate circle row when the circle is named after the recipient', async () => {
    const user = userEvent.setup();
    const sameName = { ...INVITE, circle: { ...INVITE.circle, name: 'Grandma', recipient_name: 'Grandma' } };
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(sameName));
    renderModal();

    await user.type(screen.getByLabelText('Invite code'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));

    // "Caring for" still shows the name; the redundant "Circle" label is gone.
    await waitFor(() => expect(screen.getByText('Caring for')).toBeInTheDocument());
    expect(screen.queryByText('Circle')).not.toBeInTheDocument();
    expect(screen.getByText('Grandma')).toBeInTheDocument();
  });

  it('shows a localized error when the code is invalid', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) =>
      opts?.onError?.({ error: { code: 'INVITE_NOT_FOUND' } })
    );
    renderModal();

    // 6 chars — submit only enables at exactly the normalized code length (R4-2).
    await user.type(screen.getByLabelText('Invite code'), 'BADCOD');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "We couldn't find that invite code. Double-check it and try again."
      )
    );
    // Still on the code-entry step.
    expect(screen.getByRole('button', { name: 'Look up code' })).toBeInTheDocument();
  });

  it('accepts the invite → toast, close, and onJoined with the circle id', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    acceptMutate.mockImplementation((_code, opts) => opts?.onSuccess?.());
    const { onClose, onJoined } = renderModal();

    await user.type(screen.getByLabelText('Invite code'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));
    await screen.findByText("Rose's Circle");
    await user.click(screen.getByRole('button', { name: 'Join circle' }));

    expect(acceptMutate).toHaveBeenCalledWith('ABC123', expect.anything());
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('circle-1'));
    expect(onClose).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("You've joined Rose's Circle.", 'success');
    // R4-5: successful join reports onboarding completion via the join path.
    expect(trackOnboardingCompleted).toHaveBeenCalledWith('joined');
    // WB4 REGRESSION — the code-entry join fired no invite_accepted at all
    // before this fix (only the invite-link and pending-invites paths did).
    expect(inviteAccepted).toHaveBeenCalledWith('circle-1', 'code_entry');
  });

  it('does NOT report onboarding completion when the accept fails', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    acceptMutate.mockImplementation((_code, opts) =>
      opts?.onError?.({ error: { code: 'INVITE_EXPIRED' } })
    );
    renderModal();

    await user.type(screen.getByLabelText('Invite code'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));
    await screen.findByText("Rose's Circle");
    await user.click(screen.getByRole('button', { name: 'Join circle' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(trackOnboardingCompleted).not.toHaveBeenCalled();
  });

  it('"enter a different code" returns to the code-entry step', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    renderModal();

    await user.type(screen.getByLabelText('Invite code'), 'abc123');
    await user.click(screen.getByRole('button', { name: 'Look up code' }));
    await screen.findByText("Rose's Circle");

    await user.click(screen.getByRole('button', { name: 'Enter a different code' }));

    expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
    expect(screen.queryByText("Rose's Circle")).not.toBeInTheDocument();
  });

  // ── Round 4 (R4-2): code normalization + submit gating ────────────────────
  describe('code entry polish (R4-2)', () => {
    it('normalizes typing: uppercase, spaces and dashes stripped', async () => {
      const user = userEvent.setup();
      renderModal();

      await user.type(screen.getByLabelText('Invite code'), 'ab-c 123');

      expect(screen.getByLabelText('Invite code')).toHaveValue('ABC123');
    });

    it('enables submit only at exactly 6 normalized characters', async () => {
      const user = userEvent.setup();
      renderModal();

      const input = screen.getByLabelText('Invite code');
      const submit = screen.getByRole('button', { name: 'Look up code' });

      expect(submit).toBeDisabled();
      await user.type(input, 'ABC12');
      expect(submit).toBeDisabled();
      await user.type(input, '3');
      expect(submit).toBeEnabled();
      await user.type(input, '4');
      expect(submit).toBeDisabled();
    });

    it('looks up with the normalized code', async () => {
      const user = userEvent.setup();
      lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
      renderModal();

      await user.type(screen.getByLabelText('Invite code'), 'a b-c1 2-3');
      await user.click(screen.getByRole('button', { name: 'Look up code' }));

      expect(lookupMutate).toHaveBeenCalledWith('ABC123', expect.anything());
    });
  });

  // ── Round 4 (R4-2): clipboard paste assist ────────────────────────────────
  // navigator.clipboard is mocked directly and the button driven with
  // fireEvent — userEvent.setup() installs its own clipboard stub, which would
  // clobber the mock.
  describe('clipboard paste assist (R4-2)', () => {
    const readText = vi.fn();

    beforeEach(() => {
      readText.mockReset();
      Object.defineProperty(navigator, 'clipboard', {
        value: { readText },
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });
    });

    it('reads the clipboard ON CLICK and fills a normalized 6-char code', async () => {
      readText.mockResolvedValue('ab-c 123');
      renderModal();

      // Never read before the click.
      expect(readText).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Paste code' }));

      await waitFor(() =>
        expect(screen.getByLabelText('Invite code')).toHaveValue('ABC123')
      );
      expect(readText).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Look up code' })).toBeEnabled();
    });

    it('shows the inline no-code hint when the clipboard has no 6-char code', async () => {
      readText.mockResolvedValue('Your code is ABC123');
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: 'Paste code' }));

      await waitFor(() =>
        expect(
          screen.getByText("We didn't find an invite code on your clipboard.")
        ).toBeInTheDocument()
      );
      // Field untouched, no error alert — just the quiet hint.
      expect(screen.getByLabelText('Invite code')).toHaveValue('');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('swallows clipboard permission rejection silently (no hint, no error)', async () => {
      readText.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
      renderModal();

      fireEvent.click(screen.getByRole('button', { name: 'Paste code' }));

      await waitFor(() => expect(readText).toHaveBeenCalledTimes(1));
      expect(
        screen.queryByText("We didn't find an invite code on your clipboard.")
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Invite code')).toHaveValue('');
    });

    it('hides the paste button when clipboard read is unavailable', () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });
      renderModal();

      expect(screen.queryByRole('button', { name: 'Paste code' })).not.toBeInTheDocument();
      // The rest of the form is unaffected.
      expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
    });
  });
});
