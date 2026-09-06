import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import InviteLandingPage from '@/pages/InviteLandingPage';

// @/lib/api is mocked globally in src/test/setup.ts. The real apiClient's
// response interceptor unwraps to the `{ success, data, error }` envelope,
// so the mock resolves with the envelope directly.
const mockedPost = vi.mocked(apiClient.post);

const validEnvelope = {
  success: true,
  data: {
    invite: {
      member_type: 'caregiver',
      circle: {
        name: "Rose's Care Team",
        recipient_name: 'Rose',
      },
      invited_by_name: 'Sarah',
      expires_at: '2026-07-01T00:00:00.000Z',
    },
  },
};

function renderPage(code = 'ABC123') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[`/invite/${code}`]}>
            <Routes>
              <Route path="/invite/:code" element={<InviteLandingPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </HelmetProvider>
  );
}

describe('InviteLandingPage', () => {
  beforeEach(() => {
    mockedPost.mockReset();
  });

  // One test below switches to Spanish; i18n is a module singleton, so it must
  // be handed back in English or every later assertion in this file drifts.
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows a loading skeleton while the preview request is pending', () => {
    mockedPost.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading your invitation');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('calls the public preview endpoint with the NORMALIZED code and an empty body', async () => {
    mockedPost.mockResolvedValue(validEnvelope);
    // Lowercase in the URL — the query must key/fetch on the normalized code
    // so /invite/abc123 and /invite/ABC123 share one cache entry.
    renderPage('abc123');

    await waitFor(() => {
      expect(mockedPost).toHaveBeenCalledWith('/invites/code/ABC123/preview', {});
    });
  });

  it('renders inviter, care recipient, circle name, and role for a valid invite', async () => {
    mockedPost.mockResolvedValue(validEnvelope);
    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Sarah invited you to help care for Rose',
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Rose's Care Team")).toBeInTheDocument();
    expect(screen.getByText('Caregiver')).toBeInTheDocument();
    // Invite code fallback (normalized uppercase)
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    // Download buttons present
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toBeInTheDocument();
  });

  it('renders the care recipient role badge', async () => {
    mockedPost.mockResolvedValue({
      success: true,
      data: {
        invite: { ...validEnvelope.data.invite, member_type: 'care_recipient' },
      },
    });
    renderPage();

    // Care-recipient identity is coral, never terracotta (terracotta reads as danger).
    const badge = await screen.findByText('Care recipient');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-coral-soft');
    expect(badge.className).not.toContain('terracotta');
  });

  it('shows the warm error state with download buttons for an invalid invite', async () => {
    mockedPost.mockRejectedValue({
      success: false,
      error: { code: 'INVALID_CODE', message: 'Invalid invite code' },
    });
    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This invite has expired or is invalid',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/send you a new invite/i)).toBeInTheDocument();
    // Download buttons still shown on the error state
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toBeInTheDocument();
  });

  // An already-used code is the most common failure here — the person tapped
  // the link twice, or joined in the app first. "Expired or invalid" would be
  // plainly wrong and reads as "your invite never arrived".
  it('distinguishes an already-used invite from an expired/invalid one', async () => {
    mockedPost.mockRejectedValue({
      success: false,
      error: { code: 'INVITE_ALREADY_USED', message: 'This invite has already been used' },
    });
    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This invite has already been used',
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/find the care circle on your circles list/i)).toBeInTheDocument();
    // Still a dead end without a route forward — keep the download CTAs.
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
  });

  it('shows the error state for an expired invite', async () => {
    mockedPost.mockRejectedValue({
      success: false,
      error: { code: 'INVITE_EXPIRED', message: 'This invite has expired' },
    });
    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'This invite has expired or is invalid',
      })
    ).toBeInTheDocument();
  });

  it('copies the invite code to the clipboard and announces success', async () => {
    // fireEvent (not userEvent) — userEvent.setup() installs its own
    // clipboard stub that would shadow this mock.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    mockedPost.mockResolvedValue(validEnvelope);
    renderPage('abc123');

    const copyButton = await screen.findByRole('button', { name: 'Copy invite code' });
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABC123'));
    // Button reflects the copied state and the aria-live region announces it
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.getByText('Invite code copied to clipboard')).toBeInTheDocument();
  });

  it('shows an inline fallback message when the clipboard write fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    mockedPost.mockResolvedValue(validEnvelope);
    renderPage('abc123');

    const copyButton = await screen.findByRole('button', { name: 'Copy invite code' });
    fireEvent.click(copyButton);

    expect(await screen.findByText("Couldn't copy — the code is shown above.")).toBeInTheDocument();
    // The button never claims success
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });

  it('shows the valid-state download prompt for a valid invite', async () => {
    mockedPost.mockResolvedValue(validEnvelope);
    renderPage();
    expect(
      await screen.findByText('Get the CircleCare app for the full experience')
    ).toBeInTheDocument();
  });

  it('shows the error-state download prompt on an invalid invite', async () => {
    mockedPost.mockRejectedValue({
      success: false,
      error: { code: 'INVALID_CODE', message: 'Invalid invite code' },
    });
    renderPage();
    expect(
      await screen.findByText("Meanwhile, get the app so you're ready when a new invite arrives")
    ).toBeInTheDocument();
  });

  // =========================================================================
  // NULL INVITER NAME — the backend sends `invited_by_name: null` when the
  // inviter has no first_name, and the FALLBACK IS OURS TO RENDER.
  //
  // This endpoint is unauthenticated and carries no Accept-Language, so the
  // backend can emit neither an English word ("Someone" — untranslatable copy
  // shipped as data) nor the inviter's email local-part (personal data; this
  // page pipes the name straight into a public, crawler-cached og:title, and
  // `users.first_name` is NULL for every Apple/Google OAuth signup, so that
  // fallback fired routinely). It sends null instead.
  //
  // Without a client-side fallback, i18next silently coerces null to '' and
  // the page reads "  invited you to help care for Rose".
  // =========================================================================
  const namelessEnvelope = {
    success: true,
    data: {
      invite: { ...validEnvelope.data.invite, invited_by_name: null },
    },
  };

  it('renders a localized fallback in the heading when invited_by_name is null', async () => {
    mockedPost.mockResolvedValue(namelessEnvelope);
    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Someone invited you to help care for Rose',
      })
    ).toBeInTheDocument();
  });

  it('never renders an empty or "null" inviter for a nameless inviter', async () => {
    mockedPost.mockResolvedValue(namelessEnvelope);
    renderPage();

    const heading = await screen.findByRole('heading', { level: 1 });
    // The two ways this breaks without a fallback: i18next coerces null to ''
    // (leading blank), or a naive String(null) prints the word "null".
    expect(heading.textContent).not.toMatch(/^\s/);
    expect(heading.textContent).not.toContain('null');
    expect(heading.textContent).not.toContain('undefined');
  });

  it('renders the Spanish fallback when the app language is es', async () => {
    await i18n.changeLanguage('es');
    mockedPost.mockResolvedValue(namelessEnvelope);
    renderPage();

    // The whole reason the backend cannot supply this word: it has no
    // Accept-Language on this route.
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Alguien te invitó a ayudar a cuidar a Rose',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Someone/)).not.toBeInTheDocument();
  });

  it('puts the localized fallback in the OpenGraph title, not a blank or PII', async () => {
    mockedPost.mockResolvedValue(namelessEnvelope);
    renderPage();

    // Wait for the invite to land before reading the head tags.
    await screen.findByRole('heading', { level: 1 });

    // Wait on the META TAG, which is what this test is about.
    //
    // Waiting on `document.title` made this flaky: earlier tests in this file
    // already set it to the same string, so the very first synchronous check
    // passed and the assertion below then raced react-helmet-async's rAF
    // commit. Observed failing once in a full run and green in isolation.
    await waitFor(() => {
      expect(
        document.querySelector('meta[property="og:title"]')?.getAttribute('content')
      ).toBe('Someone invited you to CircleCare');
    });
    expect(document.title).toBe('Someone invited you to CircleCare');
  });

  it('a real first_name still wins over the fallback', async () => {
    mockedPost.mockResolvedValue(validEnvelope);
    renderPage();

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Sarah invited you to help care for Rose',
      })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Someone/)).not.toBeInTheDocument();
  });
  // ── CIRCLE_ARCHIVED / CARE_RECIPIENT_EXISTS (mobile parity) ───────────────
  //
  // The backend now returns 400 CIRCLE_ARCHIVED on every invite path once the
  // owner deletes the circle (live still returns 200 and lets someone join a
  // deleted circle). Unmapped, both codes landed on "This invite has expired or
  // is invalid" — which reads as "check your code" for a code that is fine.
  describe('preview error codes', () => {
    it('says the circle was deleted for CIRCLE_ARCHIVED', async () => {
      mockedPost.mockRejectedValue({
        success: false,
        error: { code: 'CIRCLE_ARCHIVED', message: 'This circle has been archived' },
      });
      renderPage();

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'This care circle is no longer active',
        })
      ).toBeInTheDocument();
      expect(screen.getByText(/nothing wrong with your code/i)).toBeInTheDocument();
      // NOT the "expired or invalid" dead end.
      expect(screen.queryByText('This invite has expired or is invalid')).not.toBeInTheDocument();
      // Still a dead end with no route forward — keep the download CTAs.
      expect(screen.getByRole('link', { name: 'Download on the App Store' })).toBeInTheDocument();
    });

    it('says the seat is taken for CARE_RECIPIENT_EXISTS', async () => {
      mockedPost.mockRejectedValue({
        success: false,
        error: { code: 'CARE_RECIPIENT_EXISTS', message: 'Circle already has a care recipient' },
      });
      renderPage();

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'This circle already has a care recipient',
        })
      ).toBeInTheDocument();
      expect(screen.getByText(/send a caregiver invite instead/i)).toBeInTheDocument();
      expect(screen.queryByText('This invite has expired or is invalid')).not.toBeInTheDocument();
    });

    // Key parity proves the ES key EXISTS; only reading it proves the sentence.
    it('renders the archived copy in Spanish', async () => {
      await i18n.changeLanguage('es');
      mockedPost.mockRejectedValue({
        success: false,
        error: { code: 'CIRCLE_ARCHIVED', message: 'This circle has been archived' },
      });
      renderPage();

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'Este círculo de cuidado ya no está activo',
        })
      ).toBeInTheDocument();
      expect(screen.getByText(/Tu código no tiene ningún error/)).toBeInTheDocument();
    });

    // The fallback the two new cases were carved out of must be untouched.
    it('leaves an unmapped code on the generic expired-or-invalid state', async () => {
      mockedPost.mockRejectedValue({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'boom' },
      });
      renderPage();

      expect(
        await screen.findByRole('heading', {
          level: 1,
          name: 'This invite has expired or is invalid',
        })
      ).toBeInTheDocument();
    });
  });

  // ── Expiry deadline (mobile parity) ──────────────────────────────────────
  //
  // `expires_at` was already in the preview response and shown on mobile's
  // invite preview; web rendered nothing, so an invitee could not tell how long
  // the invitation had left.
  describe('expiry deadline', () => {
    it('shows the invite deadline from expires_at', async () => {
      mockedPost.mockResolvedValue(validEnvelope);
      renderPage();

      await screen.findByRole('heading', { level: 1 });
      expect(screen.getByText('Expires')).toBeInTheDocument();
      // 2026-07-01T00:00:00Z, formatted in the test env locale (en-US).
      expect(screen.getByText(/Ju(ne|ly) \d+/)).toBeInTheDocument();
    });

    it('labels the deadline in Spanish', async () => {
      await i18n.changeLanguage('es');
      mockedPost.mockResolvedValue(validEnvelope);
      renderPage();

      await screen.findByRole('heading', { level: 1 });
      expect(screen.getByText('Vence')).toBeInTheDocument();
    });

    // A formatting problem must never make a usable invite look broken.
    it('omits the deadline entirely when expires_at is unparseable', async () => {
      mockedPost.mockResolvedValue({
        success: true,
        data: { invite: { ...validEnvelope.data.invite, expires_at: 'not-a-date' } },
      });
      renderPage();

      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByText('Expires')).not.toBeInTheDocument();
      expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
    });
  });
});
