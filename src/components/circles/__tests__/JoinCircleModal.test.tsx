import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '@/i18n';
import { JoinCircleModal } from '../JoinCircleModal';

// Web port parity test for mobile's JoinCircleModal. Mocks the lookup/accept
// mutations + toast so the test focuses on the two-step flow:
//   - look up a code (six-box alphanumeric OtpInput) → preview the circle
//     (name / caring for / role)
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

// The invite code is now a six-box alphanumeric OtpInput (no single labeled
// text field). `codeGroup` finds the accessible group; `codeBoxes` its six
// textboxes; `pasteCode` focuses box 0 and pastes — OtpInput's alphanumeric
// mode uppercases and strips stray punctuation/whitespace itself.
function codeGroup(label = 'Invite code') {
  return screen.getByRole('group', { name: label });
}

function codeBoxes(label = 'Invite code') {
  return within(codeGroup(label)).getAllByRole('textbox');
}

function codeValue(label = 'Invite code') {
  return codeBoxes(label)
    .map((box) => (box as HTMLInputElement).value)
    .join('');
}

async function pasteCode(
  user: ReturnType<typeof userEvent.setup>,
  code: string,
  label = 'Invite code'
) {
  const [first] = codeBoxes(label);
  await user.click(first);
  await user.paste(code);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('JoinCircleModal', () => {
  // WCAG 2.4.3: Modal always used to grab initial focus for its own close
  // button, which made OtpInput's own `autoFocus` dead on arrival.
  it('focuses the first invite-code box on open, not the close button', () => {
    renderModal();
    expect(codeBoxes()[0]).toHaveFocus();
  });

  it('looks up a code (normalized) and previews the circle', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    renderModal();

    await pasteCode(user, 'abc123');
    await user.click(screen.getByRole('button', { name: 'Find circle' }));

    expect(lookupMutate).toHaveBeenCalledWith('ABC123', expect.anything());
    await waitFor(() => expect(screen.getByText("Rose's Circle")).toBeInTheDocument());
    expect(screen.getByText('Rose Meza')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText('Your role')).toBeInTheDocument();
    expect(screen.getByText('Caregiver')).toBeInTheDocument();
  });

  it('shows the care-recipient role badge in coral, not terracotta', async () => {
    const user = userEvent.setup();
    const careRecipientInvite = { ...INVITE, member_type: 'care_recipient' as const };
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(careRecipientInvite));
    renderModal();

    await pasteCode(user, 'abc123');
    await user.click(screen.getByRole('button', { name: 'Find circle' }));

    const badge = await screen.findByText('Care recipient');
    // Coral is warmth/identity, not the terracotta danger tint — this badge
    // is a role label, not an error state.
    expect(badge).toHaveClass('bg-coral-soft', 'text-coral-deep');
  });

  it('shows the caregiver role badge in the neutral default variant, not coral', async () => {
    const user = userEvent.setup();
    // INVITE.member_type is 'caregiver' — distinct branch from the
    // care-recipient test above; guards a mutation that collapses the
    // ternary to always return the same variant.
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    renderModal();

    await pasteCode(user, 'abc123');
    await user.click(screen.getByRole('button', { name: 'Find circle' }));

    const badge = await screen.findByText('Caregiver');
    expect(badge).toHaveClass('bg-line-2', 'text-ink-2');
  });

  it('puts the filled action LAST in DOM order on both steps (ghost before filled)', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    renderModal();

    // Step 1: code entry — ghost "Cancel" before the filled "Find circle".
    let labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels.indexOf('Find circle')).toBeGreaterThan(-1);
    expect(labels.indexOf('Cancel')).toBeLessThan(labels.indexOf('Find circle'));

    await pasteCode(user, 'abc123');
    await user.click(screen.getByRole('button', { name: 'Find circle' }));
    await screen.findByText("Rose's Circle");

    // Step 2: preview — ghost "Enter a different code" before the filled "Join circle".
    labels = screen.getAllByRole('button').map((button) => button.textContent);
    expect(labels.indexOf('Join circle')).toBeGreaterThan(-1);
    expect(labels.indexOf('Enter a different code')).toBeLessThan(labels.indexOf('Join circle'));
  });

  it('collapses the duplicate circle row when the circle is named after the recipient', async () => {
    const user = userEvent.setup();
    const sameName = {
      ...INVITE,
      circle: { ...INVITE.circle, name: 'Grandma', recipient_name: 'Grandma' },
    };
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(sameName));
    renderModal();

    await pasteCode(user, 'abc123');
    await user.click(screen.getByRole('button', { name: 'Find circle' }));

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
    await pasteCode(user, 'BADCOD');
    await user.click(screen.getByRole('button', { name: 'Find circle' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        "We couldn't find that invite code. Double-check it and try again."
      )
    );
    // Still on the code-entry step.
    expect(screen.getByRole('button', { name: 'Find circle' })).toBeInTheDocument();
  });

  it('accepts the invite → toast, close, and onJoined with the circle id', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    acceptMutate.mockImplementation((_code, opts) => opts?.onSuccess?.());
    const { onClose, onJoined } = renderModal();

    await pasteCode(user, 'abc123');
    await user.click(screen.getByRole('button', { name: 'Find circle' }));
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

    await pasteCode(user, 'abc123');
    await user.click(screen.getByRole('button', { name: 'Find circle' }));
    await screen.findByText("Rose's Circle");
    await user.click(screen.getByRole('button', { name: 'Join circle' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(trackOnboardingCompleted).not.toHaveBeenCalled();
  });

  it('"enter a different code" returns to the code-entry step', async () => {
    const user = userEvent.setup();
    lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
    renderModal();

    await pasteCode(user, 'abc123');
    await user.click(screen.getByRole('button', { name: 'Find circle' }));
    await screen.findByText("Rose's Circle");

    await user.click(screen.getByRole('button', { name: 'Enter a different code' }));

    expect(codeGroup()).toBeInTheDocument();
    expect(screen.queryByText("Rose's Circle")).not.toBeInTheDocument();
  });

  // ── Round 4 (R4-2): code normalization + submit gating ────────────────────
  describe('code entry polish (R4-2)', () => {
    it('normalizes pasted text: uppercase, spaces and dashes stripped', async () => {
      const user = userEvent.setup();
      renderModal();

      await pasteCode(user, 'ab-c 123');

      expect(codeValue()).toBe('ABC123');
    });

    it('enables submit only once all 6 boxes hold a normalized character', async () => {
      const user = userEvent.setup();
      renderModal();

      const submit = screen.getByRole('button', { name: 'Find circle' });

      expect(submit).toBeDisabled();
      await pasteCode(user, 'ABC12');
      expect(submit).toBeDisabled();
      // The paste above left focus on the last (6th, still-empty) box.
      await user.paste('3');
      expect(submit).toBeEnabled();
    });

    it('looks up with the normalized code', async () => {
      const user = userEvent.setup();
      lookupMutate.mockImplementation((_code, opts) => opts?.onSuccess?.(INVITE));
      renderModal();

      await pasteCode(user, 'a b-c1 2-3');
      await user.click(screen.getByRole('button', { name: 'Find circle' }));

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

      await waitFor(() => expect(codeValue()).toBe('ABC123'));
      expect(readText).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Find circle' })).toBeEnabled();
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
      expect(codeValue()).toBe('');
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
      expect(codeValue()).toBe('');
    });

    it('hides the paste button when clipboard read is unavailable', () => {
      Object.defineProperty(navigator, 'clipboard', {
        value: undefined,
        configurable: true,
      });
      renderModal();

      expect(screen.queryByRole('button', { name: 'Paste code' })).not.toBeInTheDocument();
      // The rest of the form is unaffected.
      expect(codeGroup()).toBeInTheDocument();
    });
  });
  // ── CIRCLE_ARCHIVED / CARE_RECIPIENT_EXISTS (mobile parity) ───────────────
  //
  // The backend now refuses both invite paths for a circle its owner deleted
  // (400 CIRCLE_ARCHIVED) and a second care-recipient accept
  // (400 CARE_RECIPIENT_EXISTS). Neither was mapped here, so both fell through
  // to "We couldn't find that invite code. Double-check it and try again." —
  // which sends the invitee hunting for a typo that does not exist.
  describe('archived circle / existing care recipient', () => {
    // The i18n instance is a module singleton; hand it back in English or every
    // later assertion in this file drifts.
    afterEach(async () => {
      await i18n.changeLanguage('en');
    });

    // The control labels are themselves translated, so the ES case drives the
    // same flow through the Spanish ones.
    const EN = { codeLabel: 'Invite code', lookUp: 'Find circle', join: 'Join circle' };
    const ES = {
      codeLabel: 'Código de invitación',
      lookUp: 'Buscar círculo',
      join: 'Unirte al círculo',
    };
    type Labels = typeof EN;

    async function failLookupWith(code: string, L: Labels = EN) {
      const user = userEvent.setup();
      lookupMutate.mockImplementation((_c, opts) => opts?.onError?.({ error: { code } }));
      renderModal();
      await pasteCode(user, 'ABC123', L.codeLabel);
      await user.click(screen.getByRole('button', { name: L.lookUp }));
      return screen.findByRole('alert');
    }

    async function failAcceptWith(code: string, L: Labels = EN) {
      const user = userEvent.setup();
      lookupMutate.mockImplementation((_c, opts) => opts?.onSuccess?.(INVITE));
      acceptMutate.mockImplementation((_c, opts) => opts?.onError?.({ error: { code } }));
      renderModal();
      await pasteCode(user, 'ABC123', L.codeLabel);
      await user.click(screen.getByRole('button', { name: L.lookUp }));
      await screen.findByText("Rose's Circle");
      await user.click(screen.getByRole('button', { name: L.join }));
      return screen.findByRole('alert');
    }

    it('explains CIRCLE_ARCHIVED on look-up instead of blaming the code', async () => {
      const alert = await failLookupWith('CIRCLE_ARCHIVED');

      expect(alert).toHaveTextContent(
        'This circle is no longer active. Ask the person who invited you to check with the circle owner.'
      );
      // The specific reason REPLACES the generic "double-check it" copy.
      expect(alert).not.toHaveTextContent('Double-check it');
    });

    it('explains CIRCLE_ARCHIVED on accept', async () => {
      const alert = await failAcceptWith('CIRCLE_ARCHIVED');

      expect(alert).toHaveTextContent(
        'This circle is no longer active. Ask the person who invited you to check with the circle owner.'
      );
      expect(alert).not.toHaveTextContent("We couldn't join this circle");
    });

    it('explains CARE_RECIPIENT_EXISTS on accept', async () => {
      const alert = await failAcceptWith('CARE_RECIPIENT_EXISTS');

      expect(alert).toHaveTextContent(
        'This circle already has a care recipient. Ask the person who invited you to send a caregiver invite instead.'
      );
      expect(alert).not.toHaveTextContent("We couldn't join this circle");
    });

    // The key-parity audit proves a Spanish key EXISTS; only reading it proves
    // it is the right sentence.
    it('renders both new codes in Spanish', async () => {
      await i18n.changeLanguage('es');

      const archived = await failLookupWith('CIRCLE_ARCHIVED', ES);
      expect(archived).toHaveTextContent(
        'Este círculo ya no está activo. Pídele a quien te invitó que consulte con el dueño del círculo.'
      );

      cleanup();
      vi.clearAllMocks();

      const recipient = await failAcceptWith('CARE_RECIPIENT_EXISTS', ES);
      expect(recipient).toHaveTextContent(
        'Este círculo ya tiene un receptor de cuidado. Pídele a quien te invitó que te envíe una invitación de cuidador.'
      );
    });

    // Guards the fallback the two new cases were carved out of: an UNMAPPED
    // code must still read as the generic message, on both steps.
    it('leaves an unmapped code on the generic fallback', async () => {
      const lookupAlert = await failLookupWith('SERVER_ERROR');
      expect(lookupAlert).toHaveTextContent(
        "We couldn't find that invite code. Double-check it and try again."
      );

      cleanup();
      vi.clearAllMocks();

      const acceptAlert = await failAcceptWith('SERVER_ERROR');
      expect(acceptAlert).toHaveTextContent("We couldn't join this circle. Please try again.");
    });
  });
});
