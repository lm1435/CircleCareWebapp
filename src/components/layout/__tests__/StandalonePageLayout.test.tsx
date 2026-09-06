import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { StandalonePageLayout } from '@/components/layout/StandalonePageLayout';
import { useAuthStore } from '@/store/authStore';

// Read the sign-out label from the locale file rather than hardcoding it, so a
// copy change can't leave this assertion passing against wording the UI no
// longer shows.
const LOGOUT = (
  JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'i18n', 'en', 'common.json'), 'utf8')
  ) as { header: { logout: string } }
).header.logout;

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

  // 2.4.1 (SERIOUS, live-repro'd): `<main>` used to have no way to receive
  // focus at all, so activating `href="#main"` moved the URL hash but left
  // focus on <body> — the very next Tab re-entered the header instead of
  // reaching page content.
  it('the skip link moves focus to the main landmark', async () => {
    const user = userEvent.setup();
    renderLayout();

    const skipLink = document.body.querySelector('a') as HTMLAnchorElement;
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(main).not.toHaveFocus();

    await user.click(skipLink);

    expect(main).toHaveFocus();
  });

  it('renders a back control with an accessible label', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('hides the back control on /circles (home — nowhere in-app to go back to)', () => {
    renderLayout(['/circles']);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('renders a home link to /circles with the brand wordmark', () => {
    renderLayout();
    const homeLink = screen.getByRole('link', { name: 'CircleCare' });
    expect(homeLink).toHaveAttribute('href', '/circles');
  });

  it('shares the 60px cream header shell with AppLayout (spec §5.1)', () => {
    renderLayout();
    const header = document.body.querySelector('header');
    expect(header).toHaveClass('h-[60px]', 'border-b', 'border-line', 'bg-cream');
  });

  it('renders back as the shared 44x44 CircleButton without elevation', () => {
    renderLayout();
    const back = screen.getByRole('button', { name: 'Back' });
    // §4.5 CircleButton: 44x44 round, and `shadow={false}` takes the weaker hair.
    expect(back).toHaveClass('h-11', 'w-11', 'rounded-full');
    expect(back).toHaveClass('border-line-2');
    expect(back).not.toHaveClass('shadow-btn');
  });

  it('renders the shared account menu', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('menuitem', { name: LOGOUT })).toBeInTheDocument();
  });

  it('draws no SVG by hand — every glyph comes from <Icon> (spec §4.3)', () => {
    const src = readFileSync(join(__dirname, '..', 'StandalonePageLayout.tsx'), 'utf8');
    expect(src).not.toMatch(/<svg/);
    expect(src).not.toMatch(/<path\b/);
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

    // 2.4.1: <main> itself carries no key (only the ErrorBoundary wrapping
    // <Outlet /> does), so this navigation must never recreate its DOM node —
    // anything focused on the landmark (e.g. the skip link's target) would
    // otherwise be yanked back to <body> by the very transition it's meant to
    // survive.
    const main = screen.getByRole('main');
    expect(screen.getByText('Profile page stub')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Circles page stub')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBe(main);
  });
});
