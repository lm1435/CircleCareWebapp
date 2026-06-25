import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const CIRCLE_ID = 'circle-1';

beforeEach(() => {
  vi.clearAllMocks();
  isPending = false;
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
    expect(
      screen.getByText(/no personal health details are sent to the AI/i)
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

    expect(mutate).toHaveBeenCalledWith('How is adherence?', expect.any(Object));
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
      expect(screen.getByText(/reached your daily limit of 50 questions/i)).toBeInTheDocument()
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
