import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { submitFormTwice } from '@/test/doubleSubmit';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import '@/i18n';
import { AIChatModal } from '../AIChatModal';
import { sendAiMessage } from '@/api/ai';
import { queryKeys } from '@/lib/queryKeys';

// The modal's premium gate routes through usePremiumGate (which calls
// useNavigate); stub it so the modal renders without a Router in these tests.
// One shared spy (not a fresh `vi.fn()` per render) so the 402 path can assert
// the upgrade prompt actually fires.
const promptUpgrade = vi.fn();
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade }),
}));

// THE NETWORK LAYER, AND NOTHING ABOVE IT. The error-path tests below run the
// REAL `useAiChat` (its real `classifyAiError` / `errorKey`) against a mocked
// `sendAiMessage`, so what decides "paywall or not" is the production mapping.
vi.mock('@/api/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/ai')>();
  return { ...actual, sendAiMessage: vi.fn() };
});

// Drive the modal through a controllable useAiChat mock: mutate(text, opts)
// invokes the right callback based on the queued outcome, and isPending is
// flipped so we can assert the thinking state.
//
// NO ERROR MAPPING LIVES IN THIS FILE. It used to carry its own copy of the
// hook's code → kind table (402 / 429 / 503 only), and against that copy
// `errorKey(error) !== 'errors.rateLimited'` — a paywall on every 503, network
// error and 403 — passed all 4309 tests. Error paths now switch to the REAL
// hook (`useRealChatHook`); the controllable mock's `errorKey` throws so a
// future test cannot quietly lean on a hand-written mapping again.
const mutate = vi.fn();
let isPending = false;
let useRealChatHook = false;
const resetConversation = vi.fn();

vi.mock('@/hooks/useAiChat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useAiChat')>();
  return {
    ...actual,
    // Constant for a test's lifetime, so the hook call order never changes
    // between renders.
    useAiChat: (circleId: string) =>
      useRealChatHook
        ? actual.useAiChat(circleId)
        : {
            mutation: { mutate, isPending },
            errorKey: () => {
              throw new Error(
                'error paths must run against the real useAiChat — set useRealChatHook'
              );
            },
            resetConversation,
          },
  };
});

// Suggestions come from a React Query hook; stub it so these tests need no
// QueryClientProvider. `suggestionsState` is the controllable query result.
let suggestionsState: { data?: string[]; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};
const useAiSuggestions = vi.fn((_circleId: string, _enabled: boolean) => suggestionsState);
vi.mock('@/hooks/useAiSuggestions', () => ({
  useAiSuggestions: (circleId: string, enabled: boolean) => useAiSuggestions(circleId, enabled),
}));

const CIRCLE_ID = 'circle-1';

beforeEach(() => {
  vi.clearAllMocks();
  isPending = false;
  useRealChatHook = false;
  suggestionsState = { data: undefined, isLoading: false, isError: false };
});

describe('AIChatModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <AIChatModal circleId={CIRCLE_ID} isOpen={false} onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the title, intro and PHI-conservative disclaimer when open', () => {
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Care Assistant' })).toBeInTheDocument();
    expect(screen.getByText(/Ask me questions about caregiving/i)).toBeInTheDocument();
    // The old string claimed "no personal health details are sent to the AI",
    // which was false — the typed message goes to OpenAI verbatim. The accurate
    // claim is that STORED records never go.
    expect(
      screen.getByText(/stored health records are never shared with the AI provider/i)
    ).toBeInTheDocument();
  });

  it('renders the user message then the assistant reply on success', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_text: string, opts: { onSuccess: (d: unknown) => void }) => {
      opts.onSuccess({ message: 'Adherence is 92%.', conversation_id: 'c1', remaining_requests: 48 });
    });

    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Your message'), 'How is adherence?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(mutate).toHaveBeenCalledWith(
      { message: 'How is adherence?', usedSuggestion: false },
      expect.any(Object)
    );
    await waitFor(() => {
      expect(screen.getByText('How is adherence?')).toBeInTheDocument();
      expect(screen.getByText('Adherence is 92%.')).toBeInTheDocument();
    });
  });

  it('does not send a blank message', async () => {
    const user = userEvent.setup();
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    // NOT via the Send button: it is disabled on blank input, and userEvent
    // refuses to click a disabled button, so a click never reaches the handler
    // and would pass with no blank-text guard at all. Enter-to-send and a direct
    // form submit both bypass the button and land in `handleSend`, which is
    // where the guard has to hold.
    const input = screen.getByLabelText('Your message');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(mutate).not.toHaveBeenCalled();

    // Whitespace only: non-empty raw input that trims to nothing.
    await user.type(input, '   ');
    await user.keyboard('{Enter}');
    expect(mutate).not.toHaveBeenCalled();

    const form = input.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('composer form not found');
    await act(async () => {
      form.requestSubmit();
    });
    expect(mutate).not.toHaveBeenCalled();
    // Nothing was rendered as a sent turn either.
    expect(screen.getByText('How can I help?')).toBeInTheDocument();
  });

  it('disables the send button on empty/whitespace input and enables it once there is text', async () => {
    const user = userEvent.setup();
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    const sendButton = screen.getByRole('button', { name: 'Send' });
    const input = screen.getByLabelText('Your message');
    expect(sendButton).toBeDisabled();

    await user.type(input, '   ');
    expect(sendButton).toBeDisabled();

    await user.type(input, 'How is adherence?');
    expect(sendButton).toBeEnabled();

    await user.clear(input);
    expect(sendButton).toBeDisabled();
  });

  it('shows the thinking state while a request is pending', () => {
    isPending = true;
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    expect(screen.getAllByText('Thinking...').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// WHO GETS THE PAYWALL. Exactly one failure: 402 SUBSCRIPTION_REQUIRED (and its
// PAYMENT_REQUIRED alias). Everything else renders its own inline bubble and
// NEVER calls `promptUpgrade()` — a rate limit resets tomorrow, a 503 is the
// server's problem, a network error is nobody's purchase, and a 403 view-only
// seat or frozen circle is precisely the person a subscription cannot help (see
// the comment over the comparison in AIChatModal.tsx).
//
// Driven through the REAL `useAiChat` with only `sendAiMessage` mocked, so the
// production classifier decides every row. Against the old hand-written mapping
// `errorKey(error) !== 'errors.rateLimited'` passed the whole suite.
//
// The flag refresh is asserted in the same table: the modal is where a stale
// `resolveAiEntry` decision is discovered, and a 402 or ANY 403 must refresh
// both circle caches — narrowing `useAiChat`'s refresh to the 402 alone leaves a
// view-only member holding an open assistant.
// ────────────────────────────────────────────────────────────────────────────
describe('AIChatModal — failed sends: inline copy, paywall and flag refresh (real useAiChat)', () => {
  const envelope = (code: string) => ({ success: false, error: { code, message: code } });
  /** What `src/lib/api.ts` rejects with when there is no response at all:
   *  `error.response?.data || error` — the raw axios error, no envelope. */
  const networkError = Object.assign(new Error('Network Error'), {
    isAxiosError: true,
    code: 'ERR_NETWORK',
    response: undefined,
  });

  const SEND_FAILED = /Sorry, I encountered an error\. Please try again\./;
  const cases: {
    label: string;
    rejection: unknown;
    copy: RegExp;
    paywall: boolean;
    refreshesAccessFlags: boolean;
  }[] = [
    {
      label: '402 SUBSCRIPTION_REQUIRED',
      rejection: envelope('SUBSCRIPTION_REQUIRED'),
      copy: /premium feature\. Upgrade to Premium to use it/,
      paywall: true,
      refreshesAccessFlags: true,
    },
    {
      label: '402 PAYMENT_REQUIRED',
      rejection: envelope('PAYMENT_REQUIRED'),
      copy: /premium feature\. Upgrade to Premium to use it/,
      paywall: true,
      refreshesAccessFlags: true,
    },
    {
      label: '429 RATE_LIMIT_EXCEEDED',
      rejection: envelope('RATE_LIMIT_EXCEEDED'),
      copy: /reached today's question limit/,
      paywall: false,
      refreshesAccessFlags: false,
    },
    {
      label: '503 SERVICE_UNAVAILABLE',
      rejection: envelope('SERVICE_UNAVAILABLE'),
      copy: /Care Assistant is unavailable right now/,
      paywall: false,
      refreshesAccessFlags: false,
    },
    {
      label: 'network error with no response',
      rejection: networkError,
      copy: SEND_FAILED,
      paywall: false,
      refreshesAccessFlags: false,
    },
    {
      label: '403 VIEW_ONLY (viewOnly)',
      rejection: envelope('VIEW_ONLY'),
      copy: /view-only access to this circle/,
      paywall: false,
      refreshesAccessFlags: true,
    },
    {
      label: '403 FORBIDDEN (viewOnly)',
      rejection: envelope('FORBIDDEN'),
      copy: /view-only access to this circle/,
      paywall: false,
      refreshesAccessFlags: true,
    },
    {
      label: '403 READ_ONLY_MEMBER (circleReadOnly)',
      rejection: envelope('READ_ONLY_MEMBER'),
      copy: /This circle is read-only right now/,
      paywall: false,
      refreshesAccessFlags: true,
    },
    {
      label: 'generic 500 INTERNAL_ERROR',
      rejection: envelope('INTERNAL_ERROR'),
      copy: SEND_FAILED,
      paywall: false,
      refreshesAccessFlags: false,
    },
  ];

  function renderWithRealHook() {
    useRealChatHook = true;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />, { wrapper });
    const invalidated = (key: readonly unknown[]) =>
      invalidateSpy.mock.calls.some(
        (call) => JSON.stringify(call[0]?.queryKey) === JSON.stringify(key)
      );
    return { invalidated };
  }

  it.each(cases)('$label', async ({ rejection, copy, paywall, refreshesAccessFlags }) => {
    const user = userEvent.setup();
    vi.mocked(sendAiMessage).mockRejectedValue(rejection);
    const { invalidated } = renderWithRealHook();

    await user.type(screen.getByLabelText('Your message'), 'How is adherence?');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    // The request really went out and really failed — the rows below are about
    // the production onError path, not a short-circuit before it.
    expect(sendAiMessage).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(copy)).toBeInTheDocument();

    if (paywall) {
      expect(promptUpgrade).toHaveBeenCalledTimes(1);
    } else {
      expect(promptUpgrade).not.toHaveBeenCalled();
    }

    const detail = invalidated(queryKeys.circleDetail(CIRCLE_ID));
    const list = invalidated(queryKeys.circles);
    expect({ detail, list }).toEqual({
      detail: refreshesAccessFlags,
      list: refreshesAccessFlags,
    });
  });

  // Anti-vacuity for the table: every inline copy is DISTINCT per kind, so a
  // regex above cannot be satisfied by a neighbouring kind's bubble.
  it('the rows cover every AiChatErrorKind the modal can paywall on or not', () => {
    const kinds = new Set(cases.map((c) => c.copy.source));
    // subscriptionRequired, rateLimited, unavailable, sendFailed, viewOnly,
    // circleReadOnly — six distinct bubbles.
    expect(kinds.size).toBe(6);
    expect(cases.filter((c) => c.paywall).map((c) => c.label)).toEqual([
      '402 SUBSCRIPTION_REQUIRED',
      '402 PAYMENT_REQUIRED',
    ]);
  });
});

// Server-authored strings. These are deliberately NOT asserted against a
// hardcoded product list: the backend's BASE_SUGGESTIONS is the single source of
// truth (it also seeds the classifier's few-shot examples), so the web must only
// ever echo what the endpoint returned.
const SERVER_SUGGESTIONS = ['What medications are due today?', 'How is adherence this week?'];

describe('AIChatModal — suggested questions', () => {
  it('fetches suggestions only while the modal is open', () => {
    const { rerender } = render(
      <AIChatModal circleId={CIRCLE_ID} isOpen={false} onClose={vi.fn()} />
    );
    expect(useAiSuggestions).toHaveBeenLastCalledWith(CIRCLE_ID, false);

    rerender(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    expect(useAiSuggestions).toHaveBeenLastCalledWith(CIRCLE_ID, true);
  });

  // The header used to be a hand-rolled `uppercase tracking-wide` label; it
  // now renders through the shared `Text variant="label"` treatment (sentence
  // case, no forced uppercase) so it matches every other sub-section header
  // in the app.
  it('renders the suggestions header with the shared Text label variant, not raw uppercase tracking', () => {
    suggestionsState = { data: SERVER_SUGGESTIONS, isLoading: false, isError: false };
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    const header = screen.getByText('Suggested questions');
    expect(header.className).toContain('text-sm');
    expect(header.className).toContain('font-semibold');
    expect(header.className).not.toContain('uppercase');
  });

  it('renders each suggestion as a real button under a labelled list', () => {
    suggestionsState = { data: SERVER_SUGGESTIONS, isLoading: false, isError: false };
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Suggested questions' });
    expect(list).toBeInTheDocument();
    for (const suggestion of SERVER_SUGGESTIONS) {
      const button = screen.getByRole('button', { name: suggestion });
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('type', 'button');
    }
  });

  // Layout contract (spec §6.7): single column, each chip a `Card` with a
  // 40ms-staggered fade-in (index * 40ms) so six chips cascade in rather than
  // popping in all at once. Full text always readable — no truncation/clamping.
  it('lays the chips out as a single column with a 40ms-staggered fade-in', () => {
    suggestionsState = { data: SERVER_SUGGESTIONS, isLoading: false, isError: false };
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Suggested questions' });
    expect(list.className).toContain('flex');
    expect(list.className).toContain('flex-col');
    expect(list.className).not.toContain('grid');

    SERVER_SUGGESTIONS.forEach((suggestion, index) => {
      const button = screen.getByRole('button', { name: suggestion });
      // 44px minimum touch target survives the tighter padding.
      expect(button.className).toContain('min-h-[44px]');
      expect(button.className).toContain('w-full');
      // No truncation/clamping — the whole question must stay readable.
      expect(button.className).not.toContain('truncate');
      expect(button.className).not.toContain('line-clamp');
      expect(button.className).not.toContain('overflow-hidden');
      // Each successive chip's fade-in is delayed by another 40ms.
      expect(button.style.animationDelay).toBe(`${index * 40}ms`);
    });
  });

  it('sends the suggestion through the normal send path, flagged for analytics', async () => {
    const user = userEvent.setup();
    suggestionsState = { data: SERVER_SUGGESTIONS, isLoading: false, isError: false };
    mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (d: unknown) => void }) => {
      opts.onSuccess({ message: 'Two doses left.', conversation_id: 'c1', remaining_requests: 47 });
    });

    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: SERVER_SUGGESTIONS[0] }));

    expect(mutate).toHaveBeenCalledWith(
      { message: SERVER_SUGGESTIONS[0], usedSuggestion: true },
      expect.any(Object)
    );
    // Same path as a typed message: the turn renders and the reply lands.
    await waitFor(() => expect(screen.getByText('Two doses left.')).toBeInTheDocument());
  });

  it('is keyboard reachable and sends on Enter', async () => {
    const user = userEvent.setup();
    suggestionsState = { data: SERVER_SUGGESTIONS, isLoading: false, isError: false };
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    screen.getByRole('button', { name: SERVER_SUGGESTIONS[1] }).focus();
    expect(screen.getByRole('button', { name: SERVER_SUGGESTIONS[1] })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(mutate).toHaveBeenCalledWith(
      { message: SERVER_SUGGESTIONS[1], usedSuggestion: true },
      expect.any(Object)
    );
  });

  it('drops the suggestions once the conversation has started', async () => {
    const user = userEvent.setup();
    suggestionsState = { data: SERVER_SUGGESTIONS, isLoading: false, isError: false };
    mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (d: unknown) => void }) => {
      opts.onSuccess({ message: 'ok', conversation_id: 'c1', remaining_requests: 47 });
    });

    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: SERVER_SUGGESTIONS[0] }));

    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'Suggested questions' })).not.toBeInTheDocument()
    );
  });

  // The intro duplicates the subtitle above the log and describes capabilities
  // the chips already demonstrate; dropping it when chips exist is what keeps
  // the modal inside Modal's max-h-[90vh] without an inner scrollbar (measured
  // in-browser: 681px of content, fits any viewport >= 757px tall).
  it('drops the intro paragraph when chips are present, keeps it when they are not', () => {
    suggestionsState = { data: SERVER_SUGGESTIONS, isLoading: false, isError: false };
    const withChips = render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    expect(screen.getByText('How can I help?')).toBeInTheDocument();
    expect(screen.queryByText(/Ask me questions about caregiving/i)).not.toBeInTheDocument();
    withChips.unmount();

    suggestionsState = { data: [], isLoading: false, isError: false };
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    expect(screen.getByText(/Ask me questions about caregiving/i)).toBeInTheDocument();
  });

  it('renders no suggestion block and no error text when the fetch 402s', () => {
    // Premium-gated circle: the query rejects, so `data` is undefined.
    suggestionsState = { data: undefined, isLoading: false, isError: true };
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    expect(screen.queryByRole('list', { name: 'Suggested questions' })).not.toBeInTheDocument();
    expect(screen.queryByText('Suggested questions')).not.toBeInTheDocument();
    // The empty state still reads fine on its own.
    expect(screen.getByText('How can I help?')).toBeInTheDocument();
    expect(screen.getByText(/Ask me questions about caregiving/i)).toBeInTheDocument();
  });

  it('renders nothing while the suggestions are loading (no placeholder flash)', () => {
    suggestionsState = { data: undefined, isLoading: true, isError: false };
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    expect(screen.queryByText('Suggested questions')).not.toBeInTheDocument();
  });

  it('renders nothing when the endpoint returns an empty list', () => {
    suggestionsState = { data: [], isLoading: false, isError: false };
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    expect(screen.queryByText('Suggested questions')).not.toBeInTheDocument();
  });

  it('resolves the label in both languages — no raw i18n key leaks', async () => {
    suggestionsState = { data: SERVER_SUGGESTIONS, isLoading: false, isError: false };

    const en = render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Suggested questions')).toBeInTheDocument();
    en.unmount();

    await i18n.changeLanguage('es');
    try {
      render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
      expect(screen.getByText('Preguntas sugeridas')).toBeInTheDocument();
      expect(screen.queryByText('suggestedQuestions')).not.toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Preguntas sugeridas' })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('en');
    }
  });
});

describe('AIChatModal — header badge and New chat', () => {
  it('shows no remaining-count badge and no New chat button before any message is sent', () => {
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    expect(screen.queryByText(/left today/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();
  });

  it('shows the remaining-count badge once the reply reports 10 or fewer left, and reveals New chat', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (d: unknown) => void }) => {
      opts.onSuccess({ message: 'ok', conversation_id: 'c1', remaining_requests: 3 });
    });

    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Your message'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('3 left today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
  });

  it('does not show the badge when the reply reports more than 10 left', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (d: unknown) => void }) => {
      opts.onSuccess({ message: 'ok', conversation_id: 'c1', remaining_requests: 40 });
    });

    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Your message'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByText('ok');
    expect(screen.queryByText(/left today/)).not.toBeInTheDocument();
  });

  it('New chat clears the conversation and calls resetConversation', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_vars: unknown, opts: { onSuccess: (d: unknown) => void }) => {
      opts.onSuccess({ message: 'Two doses left.', conversation_id: 'c1', remaining_requests: 5 });
    });

    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Your message'), 'How is adherence?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Two doses left.');
    resetConversation.mockClear();

    await user.click(screen.getByRole('button', { name: 'New chat' }));

    expect(resetConversation).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Two doses left.')).not.toBeInTheDocument();
    expect(screen.queryByText('How is adherence?')).not.toBeInTheDocument();
    // Back to the empty state with no badge and no New chat button.
    expect(screen.getByText('How can I help?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New chat' })).not.toBeInTheDocument();
  });
  // ──────────────────────────────────────────────────────────────────────────
  // DOUBLE SEND — the failure mode here is not a duplicate row, it is a FORKED
  // THREAD. `conversationIdRef` is only assigned in the mutation's `onSuccess`,
  // so two sends dispatched in the same tick both read
  // `conversation_id: undefined` and the server opens TWO conversations for
  // one question; every later turn continues whichever one answered last.
  //
  // `if (!text || mutation.isPending) return` cannot stop it — `isPending` is
  // React Query state, committed a render after the send. Enter-to-send makes
  // this easy to hit: the composer is a textarea and a key repeat fires the
  // handler twice before React commits anything.
  // ──────────────────────────────────────────────────────────────────────────
  describe('double send', () => {
    function composerForm(): HTMLFormElement {
      const form = screen.getByLabelText('Your message').closest('form');
      if (!(form instanceof HTMLFormElement)) throw new Error('composer form not found');
      return form;
    }

    it('sends ONE message when the composer is submitted twice in one tick', async () => {
      const user = userEvent.setup();
      render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

      await user.type(screen.getByLabelText('Your message'), 'How is adherence?');
      await submitFormTwice(composerForm());

      expect(mutate).toHaveBeenCalledTimes(1);
    });

    it('still sends the NEXT turn once the first one has come back', async () => {
      const user = userEvent.setup();
      // Callbacks held, not fired inline: React Query runs them when the
      // request returns. Firing them inside `mutate` would release the guard
      // before it returned, and this test would pass against no guard at all.
      let pending: Parameters<typeof mutate>[1] | undefined;
      mutate.mockImplementation((_vars: unknown, opts: unknown) => {
        pending = opts as Parameters<typeof mutate>[1];
      });
      render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

      await user.type(screen.getByLabelText('Your message'), 'How is adherence?');
      await submitFormTwice(composerForm());
      expect(mutate).toHaveBeenCalledTimes(1);

      await act(async () => {
        (pending as { onSuccess?: (d: unknown) => void })?.onSuccess?.({
          message: 'Adherence is 92%.',
          remaining_requests: 49,
        });
        (pending as { onSettled?: () => void })?.onSettled?.();
      });

      await user.type(screen.getByLabelText('Your message'), 'And last week?');
      await submitFormTwice(composerForm());
      await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    });
  });
});
