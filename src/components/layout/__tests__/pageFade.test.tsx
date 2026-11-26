import { render, screen } from '@testing-library/react';
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { StandalonePageLayout } from '@/components/layout/StandalonePageLayout';
import { HelpRouteLayout } from '@/components/layout/HelpRouteLayout';
import { useAuthStore } from '@/store/authStore';

const auth = vi.hoisted(() => ({ value: { isAuthenticated: false, isBootstrapping: false } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth.value }));
vi.mock('@/hooks/useInbox', () => ({
  useInboxUnreadSummary: () => ({ data: { unread_count: 0, by_circle: {} } }),
}));

const initialAuthState = useAuthStore.getState();

function Nav() {
  return (
    <>
      <Link to="/a">go a</Link>
      <Link to="/b">go b</Link>
      <Link to="/a?x=1">go a query</Link>
    </>
  );
}

function renderTree(layout: 'standalone' | 'help'): void {
  const element = layout === 'standalone' ? <StandalonePageLayout /> : <HelpRouteLayout />;
  render(
    <MemoryRouter initialEntries={['/a']}>
      <Routes>
        <Route element={element}>
          <Route path="/a" element={<div>page a<Nav /></div>} />
          <Route path="/b" element={<div>page b<Nav /></div>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe.each(['standalone', 'help'] as const)('page fade: %s layout', (layout) => {
  beforeEach(() => {
    auth.value = { isAuthenticated: layout === 'standalone', isBootstrapping: false };
    useAuthStore.setState({
      user: { id: 'u1', email: 'p@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: layout === 'standalone',
    });
  });
  afterEach(() => useAuthStore.setState(initialAuthState, true));

  function mount(): void {
    // Signed-in help renders the standalone layout itself.
    renderTree(layout === 'help' ? 'help' : 'standalone');
  }

  it('POSITIVE: the outlet sits inside the fade wrapper with the reduced-motion opt-out', () => {
    mount();
    const wrapper = screen.getByTestId('page-fade');
    expect(wrapper).toHaveTextContent('page a');
    expect(wrapper.className).toContain('animate-fade-in');
    expect(wrapper.className).toContain('motion-reduce:animate-none');
    expect(screen.getByRole('main')).toContainElement(wrapper);
  });

  it('POSITIVE: navigating to another route re-keys the wrapper; <main id="main"> is the same node', async () => {
    mount();
    const main = screen.getByRole('main');
    const before = screen.getByTestId('page-fade');
    await userEvent.click(screen.getByRole('link', { name: 'go b' }));
    const after = screen.getByTestId('page-fade');
    expect(after).toHaveTextContent('page b');
    expect(after).not.toBe(before);
    expect(screen.getByRole('main')).toBe(main);
    expect(main).toHaveAttribute('id', 'main');
  });

  it('NEGATIVE: a query-string change on the same path does not re-fade the page', async () => {
    mount();
    const before = screen.getByTestId('page-fade');
    await userEvent.click(screen.getByRole('link', { name: 'go a query' }));
    expect(screen.getByTestId('page-fade')).toBe(before);
  });
});

describe('page fade: negatives', () => {
  it('NEGATIVE: signed-out public eager pages (no layout) carry no fade wrapper', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByTestId('page-fade')).toBeNull();
  });
});
