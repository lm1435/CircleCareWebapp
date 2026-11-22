import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { Analytics } from '@/lib/analytics';
import { clearFirstRun, peekFirstRunDraft, setFirstRunDraft, type FirstRunDraft } from '@/lib/firstRunDraft';
import { createFirstCircleOnce } from '@/lib/firstRunCreate';
import { resetFirstRunFunnelForTests } from '@/lib/firstRunFunnel';
import { peekOnboardingPaywallPending } from '@/lib/onboardingPaywall';
import { useAuthStore } from '@/store/authStore';
import { FirstRunCircleMoment } from '../FirstRunCircleMoment';

// M2, the circle forms: the automatic POST /circles once the session exists. Positive + negative.

vi.mock('@/lib/firstRunCreate', () => ({ createFirstCircleOnce: vi.fn() }));
const subscription = vi.hoisted(() => ({ tier: 'free' as string | undefined }));
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: subscription.tier ? { tier: subscription.tier } : undefined }),
}));
const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigate };
});

const mockCreate = vi.mocked(createFirstCircleOnce);
const CIRCLE = { id: 'c1', recipient_name: 'Rosa', role: 'owner' } as never;
let autoCreated: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  clearFirstRun();
  resetFirstRunFunnelForTests();
  subscription.tier = 'free';
  useAuthStore.setState({ user: { id: 'u1', first_name: 'Maria', last_name: 'Lopez' } as never });
  autoCreated = vi.spyOn(Analytics, 'circleAutoCreated').mockImplementation(() => {});
  vi.spyOn(Analytics, 'circleCreated').mockImplementation(() => {});
  vi.spyOn(Analytics, 'firstRunCircleMoment').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function renderMoment(draft: FirstRunDraft) {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FirstRunCircleMoment draft={draft} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const KEY = 'fr-key-0123456789abcdef';
const ROSA: FirstRunDraft = { recipientName: 'Rosa', isSelfCare: false, savedAt: Date.now(), createKey: KEY };

describe('FirstRunCircleMoment', () => {
  it('POSITIVE: a name creates a circle with that name, the title is announced, then Today opens with first-run state', async () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    mockCreate.mockResolvedValue({ circle: CIRCLE, existed: false });
    renderMoment(ROSA);
    expect(mockCreate).toHaveBeenCalledWith({ recipient_name: 'Rosa', is_self_care: false }, KEY);
    expect(await screen.findByText("Rosa's circle is ready.")).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent("Rosa's circle is ready.");
    expect(autoCreated).toHaveBeenCalledWith(expect.objectContaining({ success: true, retried: false }));
    // Read once and deleted.
    expect(peekFirstRunDraft()).toBeNull();
    // The paywall is OWED (first circle, free), not shown.
    expect(peekOnboardingPaywallPending()).toBe('c1');
    await waitFor(
      () =>
        expect(navigate).toHaveBeenCalledWith('/circles/c1', {
          replace: true,
          state: { firstRun: true, firstRunRecipientName: 'Rosa' },
        }),
      { timeout: 3000 }
    );
  });

  it('POSITIVE: "It\'s for me" creates a self-care circle in the owner\'s own name', async () => {
    mockCreate.mockResolvedValue({ circle: { ...(CIRCLE as object), recipient_name: 'Maria Lopez' } as never, existed: false });
    renderMoment({ recipientName: null, isSelfCare: true, savedAt: Date.now(), createKey: KEY });
    expect(mockCreate).toHaveBeenCalledWith({ recipient_name: 'Maria Lopez', is_self_care: true }, KEY);
    expect(await screen.findByText('Your circle is ready.')).toBeInTheDocument();
  });

  it('NEGATIVE: the ring never reads ready before the create answers', async () => {
    mockCreate.mockReturnValue(new Promise(() => {}));
    renderMoment(ROSA);
    expect(screen.getByTestId('first-run-circle-moment')).toHaveAttribute('data-state', 'forming');
    expect(screen.queryByText("Rosa's circle is ready.")).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('NEGATIVE: a failed create shows the existing copy with Retry, keeps the name, navigates nowhere; Retry succeeds as retried', async () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    mockCreate.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ circle: CIRCLE, existed: false });
    renderMoment(ROSA);
    expect(
      await screen.findByText("We couldn't create your circle just now. Nothing was lost — please try again.")
    ).toBeInTheDocument();
    expect(peekFirstRunDraft()).toMatchObject({ recipientName: 'Rosa' });
    expect(autoCreated).toHaveBeenCalledWith(expect.objectContaining({ success: false, retried: false }));
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(await screen.findByText("Rosa's circle is ready.")).toBeInTheDocument();
    expect(autoCreated).toHaveBeenLastCalledWith(expect.objectContaining({ success: true, retried: true }));
    // NEGATIVE: Retry re-sends the SAME Idempotency-Key, so the server can only ever make one circle.
    expect(mockCreate.mock.calls.map((c) => c[1])).toEqual([KEY, KEY]);
  });

  it('POSITIVE (owner 2026-11-22): a refused create is a failed circle_created with its reason; Retry that lands completes it', async () => {
    const stepFailed = vi.spyOn(Analytics, 'firstRunStepFailed').mockImplementation(() => {});
    const stepCompleted = vi.spyOn(Analytics, 'firstRunStepCompleted').mockImplementation(() => {});
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    mockCreate
      .mockRejectedValueOnce({ success: false, error: { code: 'SERVER_ERROR', message: 'Rosa failed' } })
      .mockResolvedValueOnce({ circle: CIRCLE, existed: false });
    renderMoment(ROSA);
    await screen.findByTestId('first-run-circle-error');
    expect(stepFailed).toHaveBeenCalledTimes(1);
    expect(stepFailed).toHaveBeenCalledWith('circle_created', 'server', 'email');
    expect(stepCompleted).not.toHaveBeenCalled();
    // The recipient's name never rides on the event.
    expect(JSON.stringify(stepFailed.mock.calls)).not.toContain('Rosa');
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    });
    await screen.findByText("Rosa's circle is ready.");
    expect(stepCompleted).toHaveBeenCalledWith('circle_created', expect.any(String), 'email', 'c1');
    expect(stepFailed).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: a circle that already existed (an earlier request landed) is not counted as a second create', async () => {
    const created = vi.spyOn(Analytics, 'circleCreated');
    mockCreate.mockResolvedValue({ circle: CIRCLE, existed: true });
    renderMoment(ROSA);
    await screen.findByText("Rosa's circle is ready.");
    expect(created).not.toHaveBeenCalled();
    expect(autoCreated).toHaveBeenCalledWith(expect.objectContaining({ success: true, retried: true }));
  });
});
