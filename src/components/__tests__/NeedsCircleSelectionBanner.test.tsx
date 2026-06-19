// Plan Tasks 39b + 48 — needsCircleSelection banner: persistent (no dismiss
// control), shown only when GET /subscription-status returns
// needsCircleSelection: true. The subscription-status route returns a BARE
// object (no { success, data } envelope) — the mock mirrors that.

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { NeedsCircleSelectionBanner } from '@/components/NeedsCircleSelectionBanner';

const mockedGet = apiClient.get as unknown as Mock;

const BANNER_TEXT = 'Open the CircleCare app to choose which circle to keep.';

function renderBanner(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NeedsCircleSelectionBanner />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockedGet.mockReset();
});

describe('NeedsCircleSelectionBanner', () => {
  it('renders the persistent banner when needsCircleSelection is true, with no dismiss control', async () => {
    mockedGet.mockResolvedValue({ tier: 'free', needsCircleSelection: true });
    renderBanner();

    expect(await screen.findByText(BANNER_TEXT)).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith('/subscription-status');

    // Dismissal-free: no buttons inside the banner
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders nothing when needsCircleSelection is false', async () => {
    mockedGet.mockResolvedValue({ tier: 'premium', needsCircleSelection: false });
    renderBanner();

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/subscription-status'));
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
  });
});
