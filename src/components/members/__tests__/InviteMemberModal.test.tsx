import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { InviteMemberModal } from '../InviteMemberModal';

// ── Hook mocks ──────────────────────────────────────────────────────────────
const mutate = vi.fn();
vi.mock('@/hooks/useInvites', () => ({
  useCreateInvite: () => ({ mutate, isPending: false }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

// The cap note renders an inline "Upgrade" button only when web billing is
// configured; force it on so the button is testable.
vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: () => true }));

// The cap note's Upgrade button routes via useNavigate — stub it so the modal
// can render outside a Router and we can assert the destination.
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const CIRCLE_ID = 'circle-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InviteMemberModal — email-required', () => {
  it('disables the send button until an email is entered', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled();

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeEnabled();
  });

  it('blocks the invite on a malformed email', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
  });

  /**
   * This used to assert "then closes", and closing on success is precisely what
   * made email the only way an invite could reach anyone: the inviter never saw
   * the link, so they could not text it. Measured acceptance was 13% (71 sent /
   * 9 accepted). The modal now stays open on the share step.
   */
  it('sends an invite with the trimmed email and member_type, then offers the link', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onSuccess?.({ invite: { invite_code: 'ABC123', invite_url: 'https://my.circlecare.app/invite/ABC123' } })
    );
    const onClose = vi.fn();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={onClose} />);

    await user.type(screen.getByLabelText('Email address'), '  ana@example.com  ');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toEqual({
      email: 'ana@example.com',
      member_type: 'caregiver',
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByText('https://my.circlecare.app/invite/ABC123')).toBeInTheDocument();
  });

  // Done used to sit next to "Invite someone else" in the sent-step footer.
  // The Modal's × already closes the dialog and there is no unsaved state
  // left to protect once the invite has sent, so Done is gone — Send
  // another is the only footer action, and closing goes through the ×.
  it('drops Done from the sent step — Send another only, closes via the ×', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onSuccess?.({ invite: { invite_code: 'ABC123', invite_url: 'https://my.circlecare.app/invite/ABC123' } })
    );
    const onClose = vi.fn();
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={onClose} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Invite someone else' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The footer's filled-button count on each step — scoped to the footer
  // container so it can't be satisfied by the BODY's "Copy link" primary on
  // the sent step (an unscoped, document-wide count was passing for the
  // wrong reason: it was counting that body button, not anything in the
  // footer). The Modal shell's footer wrapper has a stable, distinguishing
  // class combination — `shrink-0` + `justify-end` together appear ONLY on
  // that div (the header uses `shrink-0` alone; nothing else in the dialog
  // pairs it with `justify-end`).
  it('has the expected filled-button count in the footer, before and after sending', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onSuccess?.({ invite: { invite_code: 'ABC123', invite_url: 'https://my.circlecare.app/invite/ABC123' } })
    );
    const { container } = render(
      <InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />
    );

    // Exact token match, not a substring check: a ghost button's
    // `hover:bg-moss-soft` class would also satisfy a naive
    // `.includes('bg-moss')` (it's a literal substring), misclassifying a
    // ghost button as filled.
    const FILLED_CLASSES = new Set(['bg-moss', 'bg-terracotta-soft']);
    const countFilledInFooter = () => {
      const footer = container.querySelector('.shrink-0.justify-end');
      if (!footer) throw new Error('footer container not found');
      return within(footer as HTMLElement)
        .getAllByRole('button')
        .filter((button) => button.className.split(/\s+/).some((cls) => FILLED_CLASSES.has(cls)))
        .length;
    };

    // Form step: "Send invite" is the one filled primary.
    expect(countFilledInFooter()).toBe(1);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await screen.findByRole('button', { name: 'Copy link' });
    // Sent step: "Send another" is ghost-only, no Done — zero filled buttons
    // in the footer (the body's "Copy link" primary is scoped out).
    expect(countFilledInFooter()).toBe(0);
  });

  it('passes the chosen role through for a non-self-care circle', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.click(screen.getByRole('radio', { name: /Care Recipient/i }));
    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate.mock.calls[0][0]).toEqual({
      email: 'ana@example.com',
      member_type: 'care_recipient',
    });
  });

  it('hides the role picker for a self-care circle', () => {
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare onClose={vi.fn()} />);
    expect(screen.queryByRole('radio', { name: /Care Recipient/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('surfaces the free-tier cap note when the invite is rejected with 402', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onError?.({ error: { code: 'SUBSCRIPTION_REQUIRED' } })
    );
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/up to two caregivers\. Upgrade to Premium/i);
    });
  });

  // A `pending_invite_seat` 402 is recoverable (cancel the blocking invite), so
  // the in-modal note must explain that instead of leaving a generic cap upsell
  // that contradicts the hook's toast.
  it('names the blocking invitee instead of the cap upsell on a pending_invite_seat 402', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onError?.({
        error: {
          code: 'SUBSCRIPTION_REQUIRED',
          details: {
            reason: 'pending_invite_seat',
            active_caregivers: 1,
            caregiver_limit: 2,
            blocking_invite: { id: 'inv-2', invited_email: 'blocked@example.com' },
          },
        },
      })
    );
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    // role="alert" — the note is announced, not just visible.
    const note = await screen.findByRole('alert');
    expect(note).toHaveTextContent('blocked@example.com');
    expect(note).toHaveTextContent(/Cancel it under Pending invites/i);
    expect(note).not.toHaveTextContent(/Free circles include up to two caregivers/i);
  });

  it('falls back to a nameless pending-seat note when blocking_invite is missing', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onError?.({
        error: {
          code: 'SUBSCRIPTION_REQUIRED',
          details: { reason: 'pending_invite_seat', blocking_invite: null },
        },
      })
    );
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    const note = await screen.findByRole('alert');
    expect(note).toHaveTextContent(/held by another pending invite/i);
  });

  it('keeps the cap upsell for a members_full 402', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onError?.({
        error: {
          code: 'SUBSCRIPTION_REQUIRED',
          details: { reason: 'members_full', blocking_invite: null },
        },
      })
    );
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        /up to two caregivers\. Upgrade to Premium/i
      );
    });
  });

  it('routes to /upgrade from the cap note when web billing is configured', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars, opts) =>
      opts?.onError?.({ error: { code: 'SUBSCRIPTION_REQUIRED' } })
    );
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    const upgrade = await screen.findByRole('button', { name: 'Upgrade' });
    await user.click(upgrade);

    expect(navigate).toHaveBeenCalledWith('/upgrade', {
      state: { paywallContext: 'capacity' },
    });
  });
});


/**
 * Sharing the invite link from the web.
 *
 * The webapp had no share or copy at all: it closed on success, so the inviter
 * never saw the link and email was the ONLY way an invite could reach anyone.
 * Measured acceptance was 13% (71 sent / 9 accepted since 2026-08-10), and only
 * 8 of 31 circles ever gained a second member.
 *
 * Unlike mobile, COPY is the primary action here and share is the enhancement:
 * navigator.share exists on iOS Safari and Android Chrome and largely not on
 * desktop, so a share-only design would leave desktop users with nothing.
 */
describe('InviteMemberModal — sharing the link', () => {
  const succeedWith = (invite: Record<string, unknown>) =>
    mutate.mockImplementation((_vars, opts) => opts?.onSuccess?.({ invite }));

  /**
   * `userEvent.setup()` installs its OWN navigator.clipboard stub, so any stub
   * applied before it is silently replaced — which is why the copy assertions
   * saw zero calls. Stubs are therefore applied AFTER setup, here.
   */
  async function sendInvite(navStubs: Record<string, unknown> = {}) {
    const user = userEvent.setup();
    stubNavigator(navStubs);
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    return user;
  }

  /**
   * jsdom exposes navigator.clipboard as a GETTER-ONLY property, so
   * Object.assign throws "Cannot set property clipboard". defineProperty is the
   * supported way to stub it, and both stubs are removed after each test so a
   * share-capable case cannot leak into the desktop case below.
   */
  const stubNavigator = (props: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(props)) {
      Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
    }
  };

  afterEach(() => {
    for (const key of ['share', 'clipboard']) {
      if (key in navigator) {
        Object.defineProperty(navigator, key, { value: undefined, configurable: true, writable: true });
      }
    }
  });

  it('copies the server-provided link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    succeedWith({ invite_code: 'ABC123', invite_url: 'https://my.circlecare.app/invite/ABC123' });

    const user = await sendInvite({ clipboard: { writeText } });
    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith('https://my.circlecare.app/invite/ABC123');
  });

  /**
   * A backend older than the release that added `invite_url` sends nothing. A
   * button that copies "undefined" is worse than no button.
   */
  it('falls back to a link built from the code when the backend sends no invite_url', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    succeedWith({ invite_code: 'XYZ789' });

    const user = await sendInvite({ clipboard: { writeText } });
    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite/XYZ789`);
  });

  /** Desktop has no Web Share API — the button must not be offered at all. */
  it('hides Share where navigator.share does not exist', async () => {
    succeedWith({ invite_code: 'ABC123', invite_url: 'https://x/invite/ABC123' });

    await sendInvite({ clipboard: { writeText: vi.fn() } });

    expect(screen.queryByRole('button', { name: 'Share invite link' })).toBeNull();
    // Copy is always available, which is why it is the primary action.
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('offers Share where the Web Share API exists, and passes the link', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    succeedWith({ invite_code: 'ABC123', invite_url: 'https://x/invite/ABC123' });

    const user = await sendInvite({ share, clipboard: { writeText: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'Share invite link' }));

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].text).toContain('https://x/invite/ABC123');
    // Message only, like mobile: Safari/Android prepend `title` to the text,
    // which stacked a second line over the sentence in Messages.
    expect(share.mock.calls[0][0]).not.toHaveProperty('title');
  });

  /** navigator.share REJECTS on cancel. That must not surface as an error. */
  it('survives the user dismissing the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Abort', 'AbortError'));
    succeedWith({ invite_code: 'ABC123', invite_url: 'https://x/invite/ABC123' });

    const user = await sendInvite({ share, clipboard: { writeText: vi.fn() } });
    await user.click(screen.getByRole('button', { name: 'Share invite link' }));

    // Still usable — the link did not disappear with the sheet.
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  /**
   * Clipboard access can be denied outright (permissions policy, insecure
   * context), so the link is rendered as selectable text as well.
   */
  it('shows the link as text so it is recoverable without the clipboard', async () => {
    succeedWith({ invite_code: 'ABC123', invite_url: 'https://x/invite/ABC123' });

    await sendInvite({ clipboard: { writeText: vi.fn() } });

    expect(screen.getByText('https://x/invite/ABC123')).toBeInTheDocument();
  });
});
