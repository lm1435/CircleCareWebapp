import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import InviteLandingPage from '@/pages/InviteLandingPage';

// Role-aware invite copy: when the invite is for the CARE RECIPIENT the circle
// is about them (its name is their own name), so the caregiver framing
// ("X invited you to help care for <you>", "<you>'s circle") is wrong.
// Approved 2026-10-04: title "Your care circle"; body "{inviter} set up
// CircleCare to help with your care".

const mockedPost = vi.mocked(apiClient.post);

const envelope = (memberType: string, inviter: string | null) => ({
  success: true,
  data: {
    invite: {
      member_type: memberType,
      circle: { name: 'Luis', recipient_name: 'Luis' },
      invited_by_name: inviter,
      expires_at: '2026-07-01T00:00:00.000Z',
    },
  },
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/invite/ABC123']}>
            <Routes>
              <Route path="/invite/:code" element={<InviteLandingPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('InviteLandingPage — care recipient copy', () => {
  beforeEach(() => mockedPost.mockReset());
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('EN: recipient sees "Your care circle" + the set-up sentence, no caregiver framing', async () => {
    mockedPost.mockResolvedValue(envelope('care_recipient', 'Luis Meza'));
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Your care circle' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Luis Meza set up CircleCare to help with your care')
    ).toBeInTheDocument();
    expect(screen.queryByText(/help care for/)).not.toBeInTheDocument();
    expect(screen.getByText('Care recipient')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        document.querySelector('meta[property="og:description"]')?.getAttribute('content')
      ).toBe('Join your care circle on CircleCare');
    });
  });

  it('ES: recipient copy is Latin-American Spanish', async () => {
    await i18n.changeLanguage('es');
    mockedPost.mockResolvedValue(envelope('care_recipient', 'Luis Meza'));
    renderPage();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu círculo de cuidado' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Luis Meza configuró CircleCare para ayudarte con tu cuidado')
    ).toBeInTheDocument();
  });

  it('missing inviter name falls back to the localized "Someone" / "Alguien"', async () => {
    mockedPost.mockResolvedValue(envelope('care_recipient', null));
    renderPage();
    expect(
      await screen.findByText('Someone set up CircleCare to help with your care')
    ).toBeInTheDocument();
  });

  it('missing inviter name, ES', async () => {
    await i18n.changeLanguage('es');
    mockedPost.mockResolvedValue(envelope('care_recipient', null));
    renderPage();
    expect(
      await screen.findByText('Alguien configuró CircleCare para ayudarte con tu cuidado')
    ).toBeInTheDocument();
  });

  it('caregiver invites are unchanged', async () => {
    mockedPost.mockResolvedValue(envelope('caregiver', 'Sarah'));
    renderPage();
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Sarah invited you to help care for Luis',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/set up CircleCare/)).not.toBeInTheDocument();
  });
});
