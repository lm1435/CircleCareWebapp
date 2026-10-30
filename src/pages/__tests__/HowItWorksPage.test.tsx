import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import HowItWorksPage from '@/pages/HowItWorksPage';
import SignUpPage from '@/pages/SignUpPage';
import LoginPage from '@/pages/LoginPage';
import { apiClient } from '@/lib/api';
import { Analytics } from '@/lib/analytics';
import { useAuthStore } from '@/store/authStore';

// /how-it-works — the web twin of mobile's pre-auth Preview walkthrough.
// `@/lib/api` is mocked by the global setup; the page must never call it.

function renderAt(entry: string | { pathname: string; state?: unknown }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('HowItWorksPage', () => {
  let opened: ReturnType<typeof vi.spyOn>;
  let getStarted: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    useAuthStore.setState({ user: null, isAuthenticated: false, isBootstrapping: false });
    opened = vi.spyOn(Analytics, 'previewOpened');
    getStarted = vi.spyOn(Analytics, 'previewGetStartedTapped');
    vi.mocked(apiClient.get).mockClear();
    vi.mocked(apiClient.post).mockClear();
  });
  afterEach(() => {
    opened.mockRestore();
    getStarted.mockRestore();
  });

  it('step 1 renders the sample day of doses with the mobile copy and no API call', () => {
    renderAt('/how-it-works');
    expect(screen.getByRole('heading', { level: 1, name: 'Medication schedule' })).toBeInTheDocument();
    expect(screen.getByText("Margaret's schedule for today")).toBeInTheDocument();
    expect(screen.getByText("Today's doses, in one shared list")).toBeInTheDocument();
    expect(screen.getByText('See who confirmed each dose')).toBeInTheDocument();
    expect(within(screen.getByTestId('demo-dose-taken')).getByText('Taken')).toBeInTheDocument();
    expect(within(screen.getByTestId('demo-dose-due')).getByText('Not marked')).toBeInTheDocument();
    expect(within(screen.getByTestId('demo-dose-upcoming')).getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('Screen 1 of 2')).toBeInTheDocument();
    // The trial note only shows on the last step.
    expect(screen.queryByText('Start free with one circle. Upgrade anytime.')).toBeNull();
    // Nothing on the sample rows pretends to write.
    expect(screen.queryByRole('button', { name: /Confirm|Skip/ })).toBeNull();
    expect(apiClient.get).not.toHaveBeenCalled();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('fires preview_opened once, with the source from router state', () => {
    renderAt({ pathname: '/how-it-works', state: { previewSource: 'login' } });
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith('login');
  });

  it("reports an unknown or missing source as 'direct'", () => {
    renderAt({ pathname: '/how-it-works', state: { previewSource: 'evil' } });
    expect(opened).toHaveBeenCalledWith('direct');
  });

  it('Next moves to the activity step and focuses its heading; Back returns and refocuses', async () => {
    const user = userEvent.setup();
    renderAt('/how-it-works');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    const heading = screen.getByRole('heading', { level: 1, name: 'Activity' });
    expect(heading).toHaveFocus();
    expect(screen.getByText('Everything the family did, in one feed')).toBeInTheDocument();
    expect(screen.getByText('Siblings, spouses, and helpers stay in sync')).toBeInTheDocument();
    // Real ActivityItem rows, localized through the feed's own renderer.
    expect(screen.getByText(/Metformin 500mg/)).toBeInTheDocument();
    expect(screen.getByText('You joined the circle as Caregiver')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Yesterday' })).toBeInTheDocument();
    expect(screen.getByText('Screen 2 of 2')).toBeInTheDocument();
    expect(screen.getByText('Start free with one circle. Upgrade anytime.')).toBeInTheDocument();
    expect(getStarted).not.toHaveBeenCalled();

    // The one Back control steps back through the walkthrough before it leaves it.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Medication schedule' })).toHaveFocus();
    expect(screen.getByText('Screen 1 of 2')).toBeInTheDocument();
  });

  it('Get started fires preview_get_started_tapped { step: 2 } and opens Sign up', async () => {
    const user = userEvent.setup();
    renderAt('/how-it-works');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Get started' }));
    expect(getStarted).toHaveBeenCalledWith(2);
    expect(await screen.findByRole('heading', { level: 1, name: 'Create account' })).toBeInTheDocument();
  });

  it('is keyboard operable: Enter on Next, then Enter on Get started', async () => {
    const user = userEvent.setup();
    renderAt('/how-it-works');
    screen.getByRole('button', { name: 'Next' }).focus();
    await user.keyboard('{Enter}');
    screen.getByRole('button', { name: 'Get started' }).focus();
    await user.keyboard('{Enter}');
    expect(getStarted).toHaveBeenCalledWith(2);
  });

  it('renders the Spanish copy from the same keys as mobile', async () => {
    await i18n.changeLanguage('es');
    renderAt('/how-it-works');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Horario de medicamentos' })
    ).toBeInTheDocument();
    expect(screen.getByText('Pantalla 1 de 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
  });

  it('Sign up links to the walkthrough with source signup', async () => {
    const user = userEvent.setup();
    renderAt('/signup');
    const link = screen.getByRole('link', { name: 'See how it works' });
    expect(link).toHaveAttribute('href', '/how-it-works');
    await user.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Medication schedule' })).toBeInTheDocument();
    expect(opened).toHaveBeenCalledWith('signup');
  });

  it('Log in links to the walkthrough with source login', async () => {
    const user = userEvent.setup();
    renderAt('/login');
    await user.click(screen.getByRole('link', { name: 'See how it works' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Medication schedule' })).toBeInTheDocument();
    expect(opened).toHaveBeenCalledWith('login');
  });
});
