import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import '@/i18n';
import { AIChatModal } from '../AIChatModal';

// The modal's premium gate routes through usePremiumGate (which calls
// useNavigate); stub it so the modal renders without a Router in these tests.
vi.mock('@/hooks/usePremiumGate', () => ({
  usePremiumGate: () => ({ promptUpgrade: vi.fn() }),
}));

// Drive the modal through a controllable useAiChat mock: mutate(text, opts)
// invokes the right callback based on the queued outcome, and isPending is
// flipped so we can assert the thinking state.
const mutate = vi.fn();
let isPending = false;
// Mirror the real hook's code → kind mapping so inline error copy resolves to
// the same i18n keys the component renders in production.
const CODE_TO_KIND: Record<string, string> = {
  SUBSCRIPTION_REQUIRED: 'subscriptionRequired',
  PAYMENT_REQUIRED: 'subscriptionRequired',
  RATE_LIMIT_EXCEEDED: 'rateLimited',
  SERVICE_UNAVAILABLE: 'unavailable',
};
const errorKey = (err: unknown) => {
  const code = (err as { error?: { code?: string } })?.error?.code;
  return `errors.${(code && CODE_TO_KIND[code]) ?? 'sendFailed'}`;
};
const resetConversation = vi.fn();

vi.mock('@/hooks/useAiChat', () => ({
  useAiChat: () => ({
    mutation: { mutate, isPending },
    errorKey,
    resetConversation,
  }),
}));

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

    // Button is disabled with empty input; force-clicking still sends nothing.
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('renders the rate-limit error inline on 429', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_text: string, opts: { onError: (e: unknown) => void }) => {
      opts.onError({ error: { code: 'RATE_LIMIT_EXCEEDED' } });
    });

    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Your message'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByText(/reached today's question limit/i)).toBeInTheDocument()
    );
  });

  it('renders the subscription-required error inline on 402', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_text: string, opts: { onError: (e: unknown) => void }) => {
      opts.onError({ error: { code: 'SUBSCRIPTION_REQUIRED' } });
    });

    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Your message'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByText(/premium feature\. Upgrade to Premium to use it/i)).toBeInTheDocument()
    );
  });

  it('renders the unavailable error inline on 503', async () => {
    const user = userEvent.setup();
    mutate.mockImplementation((_text: string, opts: { onError: (e: unknown) => void }) => {
      opts.onError({ error: { code: 'SERVICE_UNAVAILABLE' } });
    });

    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Your message'), 'hi');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(screen.getByText(/Care Assistant is unavailable right now/i)).toBeInTheDocument()
    );
  });

  it('shows the thinking state while a request is pending', () => {
    isPending = true;
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);
    expect(screen.getAllByText('Thinking...').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled();
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

  // Layout contract (verified in a real browser at 1512x771 and at a Pixel 5
  // 393x851 viewport): two columns from `sm` up so six chips occupy three rows,
  // one column on phone widths where half-width chips would be too narrow.
  // Equal-height rows come from grid stretch — `li.flex` + `button.h-full` — so
  // a chip whose Spanish text wraps to 2-3 lines sets the row height and its
  // neighbour matches. Text is never truncated or clamped.
  it('lays the chips out as a responsive two-column grid with equal-height cells', () => {
    suggestionsState = { data: SERVER_SUGGESTIONS, isLoading: false, isError: false };
    render(<AIChatModal circleId={CIRCLE_ID} isOpen onClose={vi.fn()} />);

    const list = screen.getByRole('list', { name: 'Suggested questions' });
    expect(list.className).toContain('grid');
    expect(list.className).toContain('grid-cols-1');
    expect(list.className).toContain('sm:grid-cols-2');

    for (const suggestion of SERVER_SUGGESTIONS) {
      const button = screen.getByRole('button', { name: suggestion });
      expect(button.parentElement?.className).toContain('flex');
      expect(button.className).toContain('h-full');
      expect(button.className).toContain('w-full');
      // 44px minimum touch target survives the tighter padding.
      expect(button.className).toContain('min-h-11');
      // No truncation/clamping — the whole question must stay readable.
      expect(button.className).not.toContain('truncate');
      expect(button.className).not.toContain('line-clamp');
      expect(button.className).not.toContain('overflow-hidden');
    }
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
