import { act, fireEvent, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { CreateCircleModal } from '../CreateCircleModal';
import { __resetOfflineWriteForTests, setOfflineWriteExplainer } from '@/lib/offlineWrite';

// OFFLINE = READ-ONLY (owner decision 2026-10-14) — CreateCircleModal's "Join
// with an invite code" escape hatch hands off to the join flow, a write, so it
// carries offlineKind="change": offline it is aria-disabled, a press explains
// "You're offline. Connect to make changes." and onJoinInstead is not called.
// Mobile twin: CreateCircleScreen.openJoinModal (CreateCircleOffline.test.tsx).

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('@/hooks/useCircleAdmin', () => ({
  useCreateCircle: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { first_name: 'Luis', last_name: 'Meza' } }),
}));
vi.mock('@/hooks/useCircles', () => ({ useCircles: () => ({ data: [{ id: 'existing' }] }) }));
vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: { tier: 'free' } }),
}));
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast: vi.fn() }) };
});
vi.mock('@/lib/onboardingAnalytics', () => ({ trackOnboardingCompleted: vi.fn() }));

const explained = vi.fn();

function renderModal() {
  const onJoinInstead = vi.fn();
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <CreateCircleModal onClose={onClose} onJoinInstead={onJoinInstead} />
    </MemoryRouter>
  );
  return { onJoinInstead, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetOfflineWriteForTests();
  setOfflineWriteExplainer(explained);
});
afterEach(() => {
  setOfflineWriteExplainer(null);
  act(() => onlineManager.setOnline(true));
});

describe('CreateCircleModal join-with-code link offline', () => {
  it('offline: aria-disabled, explains with the change sentence, onJoinInstead not called', () => {
    const { onJoinInstead, onClose } = renderModal();
    act(() => onlineManager.setOnline(false));

    const join = screen.getByRole('button', { name: 'Join with an invite code' });
    expect(join).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(join);

    expect(explained).toHaveBeenCalledTimes(1);
    expect(explained).toHaveBeenCalledWith("You're offline. Connect to make changes.");
    expect(onJoinInstead).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('control, online: the link hands off to the join flow', () => {
    const { onJoinInstead } = renderModal();
    const join = screen.getByRole('button', { name: 'Join with an invite code' });
    expect(join).not.toHaveAttribute('aria-disabled');
    fireEvent.click(join);
    expect(onJoinInstead).toHaveBeenCalledTimes(1);
    expect(explained).not.toHaveBeenCalled();
  });
});
