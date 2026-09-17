import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { InviteMemberModal } from '../InviteMemberModal';
import { submitFormTwice } from '@/test/doubleSubmit';
import { Analytics } from '@/lib/analytics';

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

/**
 * The app's current UI language, as the modal sees it.
 *
 * The modal reads `useTranslation().i18n.language` to decide whether the
 * shared link needs the `?lang=es` link-preview marker. We override ONLY that
 * property rather than calling `i18n.changeLanguage('es')`, on purpose: the
 * real switch lazily imports the whole Spanish bundle and suspends, and would
 * turn every label query in this file ("Send invite", "Copy link") Spanish.
 * The contract under test is "the component reads the app language and marks
 * the URL", and this exercises exactly that, with English labels intact.
 *
 * `Object.create` keeps the real i18next instance as the prototype, so
 * anything else reading off `i18n` still gets the genuine methods.
 */
let appLanguage = 'en';
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: (...args: Parameters<typeof actual.useTranslation>) => {
      const result = actual.useTranslation(...args);
      // Patch in place, not `{ ...result }`: react-i18next returns an ARRAY
      // with `t`/`i18n`/`ready` attached, and spreading it into a plain object
      // silently breaks `const [t] = useTranslation()` for every component in
      // the tree by dropping Symbol.iterator.
      Object.defineProperty(result, 'i18n', {
        value: Object.create(result.i18n, {
          language: { value: appLanguage, enumerable: true },
        }) as typeof result.i18n,
        configurable: true,
      });
      return result;
    },
  };
});

const CIRCLE_ID = 'circle-1';

beforeEach(() => {
  vi.clearAllMocks();
  appLanguage = 'en';
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
   *
   * WHITESPACE: this pins the OUTCOME (spaces typed around the address never
   * reach the request), not the component's own `.trim()` calls. jsdom — like
   * every browser — sanitizes a `type="email"` value, stripping surrounding
   * whitespace before React's onChange sees it, so those calls are not
   * observable through the field at all (removing both stays green).
   */
  it('sends an invite with the email (surrounding spaces never reach the request) and member_type, then offers the link', async () => {
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

  /**
   * navigator.share REJECTS on cancel. That must not surface as an error.
   *
   * Each consequence is asserted on its own. "Copy link is still there" alone
   * held whatever the handler did — a rejection escaping the click handler only
   * failed through vitest's global unhandled-error check, never through this
   * test — so the rejection is now listened for explicitly, and a dismissal is
   * checked not to be COUNTED as a share (the event must mean a completed one).
   */
  it('survives the user dismissing the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Abort', 'AbortError'));
    succeedWith({ invite_code: 'ABC123', invite_url: 'https://x/invite/ABC123' });
    const shared = vi.spyOn(Analytics, 'inviteLinkShared');
    // tsconfig carries no Node types; the runner's `process` is there regardless.
    type Listener = (reason: unknown) => void;
    const nodeProcess = (
      globalThis as unknown as {
        process: { on: (e: string, l: Listener) => void; off: (e: string, l: Listener) => void };
      }
    ).process;
    const unhandled = vi.fn<Listener>();
    nodeProcess.on('unhandledRejection', unhandled);

    try {
      const user = await sendInvite({ share, clipboard: { writeText: vi.fn() } });
      await user.click(screen.getByRole('button', { name: 'Share invite link' }));
      // Let the rejected share settle and Node's unhandled-rejection check run.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(share).toHaveBeenCalledTimes(1);
      // Caught — not left to escape the click handler.
      expect(unhandled).not.toHaveBeenCalled();
      // A dismissal is not a share.
      expect(shared).not.toHaveBeenCalled();
      // Nothing interrupts the user over it.
      expect(showToast).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).toBeNull();
      // Still usable — the link did not disappear with the sheet.
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
      expect(screen.getByText('https://x/invite/ABC123')).toBeInTheDocument();
    } finally {
      nodeProcess.off('unhandledRejection', unhandled);
      shared.mockRestore();
    }
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

  /**
   * SPANISH LINK-PREVIEW MARKER.
   *
   * Link-preview crawlers (iMessage, WhatsApp, Slack) do not run JS, so the
   * card an invite previews as is baked into the served HTML — English, for
   * everyone. A Spanish-speaking sender was texting an English card into a
   * Spanish conversation. The sender's client now appends `?lang=es`, which
   * .htaccess answers with the prerendered index.es.html.
   *
   * All three surfaces are asserted, because the failure that matters is not
   * "no marker" but "display and copy disagree" — the user reads one link and
   * pastes another.
   */
  describe('Spanish app language', () => {
    it('marks the copied link with lang=es', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      succeedWith({ invite_code: 'ABC123', invite_url: 'https://my.circlecare.app/invite/ABC123' });
      appLanguage = 'es';

      const user = await sendInvite({ clipboard: { writeText } });
      await user.click(screen.getByRole('button', { name: 'Copy link' }));

      expect(writeText).toHaveBeenCalledWith('https://my.circlecare.app/invite/ABC123?lang=es');
    });

    it('marks the shared message link with lang=es', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      succeedWith({ invite_code: 'ABC123', invite_url: 'https://x/invite/ABC123' });
      appLanguage = 'es-419';

      const user = await sendInvite({ share, clipboard: { writeText: vi.fn() } });
      await user.click(screen.getByRole('button', { name: 'Share invite link' }));

      expect(share.mock.calls[0][0].text).toContain('https://x/invite/ABC123?lang=es');
    });

    it('shows the SAME marked link on screen as it copies', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      succeedWith({ invite_code: 'ABC123', invite_url: 'https://x/invite/ABC123' });
      appLanguage = 'es';

      const user = await sendInvite({ clipboard: { writeText } });
      await user.click(screen.getByRole('button', { name: 'Copy link' }));

      const displayed = screen.getByText('https://x/invite/ABC123?lang=es');
      expect(displayed).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledWith(displayed.textContent);
      // The unmarked link must not be on screen anywhere — an exact-text
      // query would still match the marked node's parent otherwise, so this
      // asserts on the exact string.
      expect(screen.queryByText('https://x/invite/ABC123')).toBeNull();
    });

    it('marks the code-built fallback link too, when the backend sends no invite_url', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      succeedWith({ invite_code: 'XYZ789' });
      appLanguage = 'es-MX';

      const user = await sendInvite({ clipboard: { writeText } });
      await user.click(screen.getByRole('button', { name: 'Copy link' }));

      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/invite/XYZ789?lang=es`
      );
    });

    /**
     * The English link is the DEFAULT document, and every invite link already
     * sent is a bare URL. If this ever starts marking English links, all of
     * them acquire a second cache key for an identical page.
     */
    it('leaves the link bare for an English sender', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      succeedWith({ invite_code: 'ABC123', invite_url: 'https://x/invite/ABC123' });
      appLanguage = 'en-US';

      const user = await sendInvite({ clipboard: { writeText } });
      await user.click(screen.getByRole('button', { name: 'Copy link' }));

      expect(writeText).toHaveBeenCalledWith('https://x/invite/ABC123');
      expect(screen.getByText('https://x/invite/ABC123')).toBeInTheDocument();
    });
  });
});

// Regression — double submit. POST /circles/:id/invites sits on
// `inviteRateLimit` (10/hour per IP) and sends a real email;
// `disabled={createInvite.isPending}` on the footer button lands a render late
// and implicit form submission (Enter in the email field) never consults it at
// all.
describe('InviteMemberModal — double-submit guard', () => {
  it('creates exactly ONE invite when the form is submitted twice in the same tick', async () => {
    const user = userEvent.setup();
    // In flight: no callback fires, so the guard is still held on the second
    // submit.
    mutate.mockImplementation(() => {});
    const { container } = render(
      <InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />
    );

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await submitFormTwice(container.querySelector('#invite-member-form') as HTMLFormElement);

    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('is still submittable after a validation failure (the guard releases, it does not latch)', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation(() => {});
    const { container } = render(
      <InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />
    );
    const form = container.querySelector('#invite-member-form') as HTMLFormElement;

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await submitFormTwice(form);
    expect(mutate).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Email address'));
    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(mutate).toHaveBeenCalledTimes(1);
  });

  // The test above cannot see the release: an invalid address returns BEFORE
  // the guard is claimed, so there is nothing to release. These two claim it
  // for real, and hold React Query's callbacks until the "request" returns —
  // firing them inside `mutate()` would release the guard before `mutate`
  // came back, which is not the order production runs in.
  it('is submittable again after a SERVER failure (onSettled releases the guard)', async () => {
    const user = userEvent.setup();
    let pending: Parameters<typeof mutate>[1] | undefined;
    mutate.mockImplementation((_vars, opts) => {
      pending = opts;
    });
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(mutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending?.onError?.({ error: { code: 'SUBSCRIPTION_REQUIRED' } });
      pending?.onSettled?.();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it('is submittable again after a SUCCESS and "Invite someone else"', async () => {
    const user = userEvent.setup();
    let pending: Parameters<typeof mutate>[1] | undefined;
    mutate.mockImplementation((_vars, opts) => {
      pending = opts;
    });
    render(<InviteMemberModal circleId={CIRCLE_ID} isSelfCare={false} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Email address'), 'ana@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(mutate).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending?.onSuccess?.({
        invite: { invite_code: 'ABC123', invite_url: 'https://x/invite/ABC123' },
      });
      pending?.onSettled?.();
    });
    await user.click(screen.getByRole('button', { name: 'Invite someone else' }));

    await user.type(screen.getByLabelText('Email address'), 'ben@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1][0]).toEqual({ email: 'ben@example.com', member_type: 'caregiver' });
  });
});
