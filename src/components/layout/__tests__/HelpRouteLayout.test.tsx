import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { HelpRouteLayout } from '@/components/layout/HelpRouteLayout';

const auth = vi.hoisted(() => ({ value: { isAuthenticated: false, isBootstrapping: false } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('@/components/layout/StandalonePageLayout', () => ({
  StandalonePageLayout: () => <div>signed-in chrome</div>,
}));

function renderLayout(): void {
  render(
    <MemoryRouter initialEntries={['/help']}>
      <Routes>
        <Route element={<HelpRouteLayout />}>
          <Route path="/help" element={<div>help body</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('HelpRouteLayout', () => {
  it('signed out: public chrome with a main landmark, back control and a brand link to /login', () => {
    auth.value = { isAuthenticated: false, isBootstrapping: false };
    renderLayout();
    expect(screen.getByRole('main')).toHaveTextContent('help body');
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'CircleCare' })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('signed-in chrome')).toBeNull();
  });

  it('signed in: the standalone layout', () => {
    auth.value = { isAuthenticated: true, isBootstrapping: false };
    renderLayout();
    expect(screen.getByText('signed-in chrome')).toBeInTheDocument();
  });

  it('bootstrapping: neither, just a spinner', () => {
    auth.value = { isAuthenticated: false, isBootstrapping: true };
    renderLayout();
    expect(screen.queryByText('help body')).toBeNull();
    expect(screen.queryByText('signed-in chrome')).toBeNull();
  });
});
