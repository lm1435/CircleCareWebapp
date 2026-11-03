// SubscriptionSection while in a FREE TRIAL (pricing report 2026-11, B): the
// card says when the trial ends and what the first charge is, from RevenueCat's
// CustomerInfo (any store). Not in a trial: nothing new on the card.

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';

const mockCustomerInfo = vi.hoisted(() => vi.fn());
const mockOffering = vi.hoisted(() => vi.fn());
vi.mock('@/lib/purchases', () => ({
  getManagementUrl: vi.fn(),
  getWebCustomerInfo: () => mockCustomerInfo(),
  getWebOffering: () => mockOffering(),
  toWebPlan: (pkg: { id: string; price: string }) => ({
    rcPackage: { webBillingProduct: { identifier: pkg.id } },
    identifier: pkg.id,
    formattedPrice: pkg.price,
  }),
}));
vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: vi.fn(() => true) }));
const analytics = vi.hoisted(() => ({ trialChargeNoticeShown: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ Analytics: analytics }));

import { SubscriptionSection } from '@/components/profile/SubscriptionSection';
import { formatTrialDate } from '@/lib/trialCharge';

const mockedGet = apiClient.get as unknown as Mock;

const info = (over: Record<string, unknown> = {}) => ({
  entitlements: {
    active: {
      'CircleCare Premium': {
        periodType: 'trial',
        expirationDate: new Date('2026-11-10T18:00:00Z'),
        willRenew: true,
        store: 'rc_billing',
        productIdentifier: 'annual_web',
        ...over,
      },
    },
  },
});

function renderSection(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ToastProvider>
          <SubscriptionSection />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGet.mockReset();
  mockedGet.mockResolvedValue({ tier: 'premium', needsCircleSelection: false });
  useAuthStore.setState({ user: { id: 'user-1', email: 'u@example.com' } as never, isAuthenticated: true });
  mockOffering.mockResolvedValue({ annual: { id: 'annual_web', price: '$59.99' }, monthly: null });
});

const date = () => formatTrialDate('2026-11-10T18:00:00.000Z', 'en');

it('a web trial: the end date, the plain charge date and the Stripe price', async () => {
  mockCustomerInfo.mockResolvedValue(info());
  renderSection();
  const box = await screen.findByTestId('subscription-trial-charge');
  expect(box).toHaveTextContent(`Free trial ends ${date()}`);
  expect(
    await screen.findByText(`You'll be charged $59.99 on ${date()} unless you cancel before then.`)
  ).toBeInTheDocument();
  expect(analytics.trialChargeNoticeShown).toHaveBeenCalledWith('profile', 'web');
});

it('an App Store trial: names Apple and the 24-hour caveat, no price it cannot know', async () => {
  mockCustomerInfo.mockResolvedValue(info({ store: 'app_store' }));
  renderSection();
  const box = await screen.findByTestId('subscription-trial-charge');
  expect(box).toHaveTextContent(
    "Unless you cancel, Apple will charge your plan's price when it ends. Apple can charge up to 24 hours early"
  );
  expect(mockOffering).not.toHaveBeenCalled();
});

it('not in a trial: no trial line', async () => {
  mockCustomerInfo.mockResolvedValue(info({ periodType: 'normal' }));
  renderSection();
  expect(await screen.findByText('CircleCare Premium')).toBeInTheDocument();
  expect(screen.queryByTestId('subscription-trial-charge')).not.toBeInTheDocument();
  expect(analytics.trialChargeNoticeShown).not.toHaveBeenCalled();
});

it('free tier: RevenueCat is not read at all', async () => {
  mockedGet.mockResolvedValue({ tier: 'free', needsCircleSelection: false });
  renderSection();
  expect(await screen.findByText('Free plan')).toBeInTheDocument();
  expect(mockCustomerInfo).not.toHaveBeenCalled();
});
