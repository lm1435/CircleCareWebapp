import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import { AuthGuard } from '@/components/AuthGuard';
import { useAuthStore } from '@/store/authStore';

// Task 50 — AuthGuard: spinner while bootstrapping, redirect (preserving the
// intended location) when unauthenticated, children when authenticated.
// bootstrap() itself is kicked off in App.tsx, not here.

function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  return <div>login page{from ? ` (from ${from})` : ''}</div>;
}

function renderGuarded() {
  return render(
    <MemoryRouter initialEntries={['/circles']}>
      <Routes>
        <Route path="/login" element={<LoginProbe />} />
        <Route
          path="/circles"
          element={
            <AuthGuard>
              <div>protected content</div>
            </AuthGuard>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const testUser = {
  id: 'user-1',
  email: 'pat@example.com',
  first_name: 'Pat',
  last_name: 'Rivera',
};

describe('AuthGuard', () => {
  it('renders a spinner (and nothing else) while the boot refresh is pending', () => {
    useAuthStore.setState({ isBootstrapping: true, isAuthenticated: false, user: null });
    renderGuarded();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.queryByText(/login page/)).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to /login preserving the intended location', () => {
    useAuthStore.setState({ isBootstrapping: false, isAuthenticated: false, user: null });
    renderGuarded();

    expect(screen.getByText('login page (from /circles)')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    useAuthStore.setState({ isBootstrapping: false, isAuthenticated: true, user: testUser });
    renderGuarded();

    expect(screen.getByText('protected content')).toBeInTheDocument();
    expect(screen.queryByText(/login page/)).not.toBeInTheDocument();
  });
});
