import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { StandalonePageLayout } from '@/components/layout/StandalonePageLayout';
import { useAuthStore } from '@/store/authStore';

const initialAuthState = useAuthStore.getState();

function renderLayout(initialEntries: string[] = ['/help']): void {
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<StandalonePageLayout />}>
          <Route path="/help" element={<div>Help page stub</div>} />
          <Route path="/profile" element={<div>Profile page stub</div>} />
          <Route path="/circles" element={<div>Circles page stub</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('StandalonePageLayout', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    useAuthStore.setState(initialAuthState, true);
  });

  it('renders the page content inside the main landmark with id="main"', () => {
    renderLayout();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(within(main).getByText('Help page stub')).toBeInTheDocument();
  });

  it('renders a skip link as the first link, targeting the main landmark', () => {
    renderLayout();
    const firstLink = document.body.querySelector('a');
    expect(firstLink).toHaveTextContent('Skip to content');
    expect(firstLink).toHaveAttribute('href', '#main');
  });

  it('renders a back control with an accessible label', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('renders a home link to /circles with the brand wordmark', () => {
    renderLayout();
    const homeLink = screen.getByRole('link', { name: 'CircleCare' });
    expect(homeLink).toHaveAttribute('href', '/circles');
  });

  it('back navigates through history when available', async () => {
    const user = userEvent.setup();
    // Start at /circles, navigate to /profile, then Back should return to /circles.
    render(
      <MemoryRouter initialEntries={['/circles', '/profile']} initialIndex={1}>
        <Routes>
          <Route element={<StandalonePageLayout />}>
            <Route path="/profile" element={<div>Profile page stub</div>} />
            <Route path="/circles" element={<div>Circles page stub</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Profile page stub')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Circles page stub')).toBeInTheDocument();
  });
});
