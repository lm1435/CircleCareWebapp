// needsCircleSelection banner: shown only when GET /subscription-status returns
// needsCircleSelection: true. The web now implements the selection flow — the
// banner's "Choose circle" button opens the CircleSelectionModal. The status
// route returns a BARE object (no { success, data } envelope).

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { NeedsCircleSelectionBanner } from '@/components/NeedsCircleSelectionBanner';

const mockedGet = apiClient.get as unknown as Mock;

const BANNER_TEXT = 'Your subscription ended. Choose which circle to keep with free access.';

function renderBanner(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <NeedsCircleSelectionBanner />
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockedGet.mockReset();
});

describe('NeedsCircleSelectionBanner', () => {
  it('renders the banner + Choose action when needsCircleSelection is true', async () => {
    mockedGet.mockResolvedValue({ tier: 'free', needsCircleSelection: true });
    renderBanner();

    expect(await screen.findByText(BANNER_TEXT)).toBeInTheDocument();
    expect(mockedGet).toHaveBeenCalledWith('/subscription-status');
    expect(screen.getByRole('button', { name: 'Choose circle' })).toBeInTheDocument();
  });

  it('renders nothing when needsCircleSelection is false', async () => {
    mockedGet.mockResolvedValue({ tier: 'premium', needsCircleSelection: false });
    renderBanner();

    await waitFor(() => expect(mockedGet).toHaveBeenCalledWith('/subscription-status'));
    expect(screen.queryByText(BANNER_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Choose circle' })).not.toBeInTheDocument();
  });

  it('opens the selection modal listing the owned circles', async () => {
    mockedGet.mockImplementation((url: string) => {
      if (url === '/subscription-status') {
        return Promise.resolve({ tier: 'free', needsCircleSelection: true });
      }
      if (url === '/circles') {
        return Promise.resolve({
          success: true,
          data: {
            circles: [
              { id: 'c1', name: "Mom's Care", recipient_name: 'Rose', role: 'owner', member_count: 3 },
              { id: 'c2', name: "Dad's Care", recipient_name: 'Joe', role: 'owner', member_count: 2 },
              { id: 'c3', name: 'Aunt circle', recipient_name: 'Ana', role: 'member', member_count: 4 },
            ],
          },
        });
      }
      return Promise.resolve({});
    });
    renderBanner();

    fireEvent.click(await screen.findByRole('button', { name: 'Choose circle' }));

    expect(
      await screen.findByRole('heading', { name: 'Pick one circle to keep' })
    ).toBeInTheDocument();
    // Owned circles are listed (async load); the member-only circle is not here.
    expect(await screen.findByText("Mom's Care")).toBeInTheDocument();
    expect(screen.getByText("Dad's Care")).toBeInTheDocument();
    expect(screen.queryByText('Aunt circle')).not.toBeInTheDocument();
  });
});
