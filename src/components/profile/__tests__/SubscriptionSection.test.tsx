// SubscriptionSection — shows Premium / Free from the cached plan_tier returned
// by GET /subscription-status (a BARE object, no { success, data } envelope).
// Mocks apiClient.get like NeedsCircleSelectionBanner.test.tsx, plus the web
// billing config flag (off by default = original in-app upgrade pointer).

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { SubscriptionSection } from '@/components/profile/SubscriptionSection';

vi.mock('@/lib/purchases', () => ({
  isWebBillingConfigured: vi.fn(() => false),
  getManagementUrl: vi.fn(),
}));

import { isWebBillingConfigured } from '@/lib/purchases';

const mockedGet = apiClient.get as unknown as Mock;
const mockedConfigured = isWebBillingConfigured as unknown as Mock;

function renderSection(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  mockedGet.mockReset();
  mockedConfigured.mockReset();
  mockedConfigured.mockReturnValue(false);
});

describe('SubscriptionSection', () => {
  it('shows the Premium badge for premium users', async () => {
    mockedGet.mockResolvedValue({ tier: 'premium', needsCircleSelection: false });
    renderSection();

    expect(await screen.findByText('CircleCare Premium')).toBeInTheDocument();
    expect(
      screen.getByText('You have full access to all CircleCare features.')
    ).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith('/subscription-status');
    // No store badges / upgrade pointer for premium users
    expect(screen.queryByText('Upgrade to Premium in the CircleCare app.')).not.toBeInTheDocument();
  });

  it('shows the Free plan + in-app upgrade pointer when web billing is OFF', async () => {
    mockedGet.mockResolvedValue({ tier: 'free', needsCircleSelection: false });
    renderSection();

    expect(await screen.findByText('Free plan')).toBeInTheDocument();
    expect(
      screen.getByText('Upgrade to Premium in the CircleCare app.')
    ).toBeInTheDocument();
    // Store badges are the upgrade path when there's no web purchase flow
    expect(screen.getByRole('link', { name: /app store/i })).toBeInTheDocument();
    // No web Upgrade CTA when billing is unconfigured
    expect(screen.queryByRole('button', { name: 'Upgrade to Premium' })).not.toBeInTheDocument();
  });

  it('shows a real Upgrade CTA for free users when web billing is ON', async () => {
    mockedConfigured.mockReturnValue(true);
    mockedGet.mockResolvedValue({ tier: 'free', needsCircleSelection: false });
    renderSection();

    expect(await screen.findByText('Free plan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Premium' })).toBeInTheDocument();
    // The in-app pointer copy is replaced by the benefit line
    expect(
      screen.queryByText('Upgrade to Premium in the CircleCare app.')
    ).not.toBeInTheDocument();
  });

  it('shows a Manage subscription action for premium users when web billing is ON', async () => {
    mockedConfigured.mockReturnValue(true);
    mockedGet.mockResolvedValue({ tier: 'premium', needsCircleSelection: false });
    renderSection();

    expect(await screen.findByText('CircleCare Premium')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeInTheDocument();
  });

  it('renders a loading skeleton before the status resolves', () => {
    // Never resolve — keep the query pending to assert the loading state.
    mockedGet.mockReturnValue(new Promise(() => {}));
    renderSection();

    expect(screen.queryByText('CircleCare Premium')).not.toBeInTheDocument();
    expect(screen.queryByText('Free plan')).not.toBeInTheDocument();
  });
});
