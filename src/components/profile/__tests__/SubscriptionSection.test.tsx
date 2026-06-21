// SubscriptionSection — shows Premium / Free from the cached plan_tier returned
// by GET /subscription-status (a BARE object, no { success, data } envelope).
// Mocks apiClient.get like NeedsCircleSelectionBanner.test.tsx.

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { SubscriptionSection } from '@/components/profile/SubscriptionSection';

const mockedGet = apiClient.get as unknown as Mock;

function renderSection(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SubscriptionSection />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockedGet.mockReset();
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

  it('shows the Free plan + in-app upgrade pointer for free users', async () => {
    mockedGet.mockResolvedValue({ tier: 'free', needsCircleSelection: false });
    renderSection();

    expect(await screen.findByText('Free plan')).toBeInTheDocument();
    expect(
      screen.getByText('Upgrade to Premium in the CircleCare app.')
    ).toBeInTheDocument();
    // Store badges are the upgrade path on web (no purchase flow)
    expect(screen.getByRole('link', { name: /app store/i })).toBeInTheDocument();
  });

  it('renders a loading skeleton before the status resolves', () => {
    // Never resolve — keep the query pending to assert the loading state.
    mockedGet.mockReturnValue(new Promise(() => {}));
    renderSection();

    expect(screen.queryByText('CircleCare Premium')).not.toBeInTheDocument();
    expect(screen.queryByText('Free plan')).not.toBeInTheDocument();
  });
});
