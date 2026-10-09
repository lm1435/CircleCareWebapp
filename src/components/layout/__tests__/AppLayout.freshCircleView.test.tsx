import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useSearchParams } from 'react-router-dom';
import '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
import { ToastProvider } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';

// Owner decision: "every new circle should be fresh". AppLayout keys the page
// <Outlet> by pathname, so opening another circle (switcher OR deep link /
// history navigation) remounts the page and every useState (tab, filters,
// sort, calendar anchor, composer...) returns to its default. Within the same
// circle, state set via the URL is kept. A stub page stands in for the real
// pages: it holds local state plus URL state, exactly the two mechanisms they use.

vi.mock('@/hooks/useCircles', () => ({
  useCircles: vi.fn(() => ({
    data: [
      { id: 'A', name: 'Circle A', recipient_name: 'Rosa' },
      { id: 'B', name: 'Circle B', recipient_name: 'Ana' },
    ],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));
vi.mock('@/hooks/useCircle', () => ({
  useCircle: vi.fn((id: string) => ({
    circle: { id, owner_id: 'u1', is_self_care: false },
    canEdit: true,
  })),
}));
vi.mock('@/components/NeedsCircleSelectionBanner', () => ({
  NeedsCircleSelectionBanner: () => null,
}));
vi.mock('@/components/ai/AIChatModal', () => ({ AIChatModal: () => null }));

function StubPage() {
  const [filter, setFilter] = useState('all');
  const [params, setParams] = useSearchParams();
  return (
    <div>
      <span data-testid="filter">{filter}</span>
      <span data-testid="tab">{params.get('tab') ?? 'medications'}</span>
      <button onClick={() => setFilter('completed')}>set filter</button>
      <button onClick={() => setParams({ tab: 'history' })}>set tab</button>
    </div>
  );
}

const initialAuthState = useAuthStore.getState();

function renderAt(entry: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/circles/:circleId',
        element: <AppLayout />,
        children: [
          { path: 'meds', element: <StubPage /> },
          { path: 'tasks', element: <StubPage /> },
        ],
      },
    ],
    { initialEntries: [entry] }
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  );
  return router;
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
    isAuthenticated: true,
  });
});
afterEach(() => {
  useAuthStore.setState(initialAuthState, true);
  document.documentElement.style.removeProperty('--nav-h');
});

describe('page view state across circles (real AppLayout keyed outlet)', () => {
  it('local state resets when a different circle opens (link, deep link or back)', async () => {
    const user = userEvent.setup();
    const router = renderAt('/circles/A/meds');
    await user.click(screen.getByText('set filter'));
    expect(screen.getByTestId('filter')).toHaveTextContent('completed');

    await act(async () => {
      await router.navigate('/circles/B/meds');
    });
    expect(screen.getByTestId('filter')).toHaveTextContent('all');

    // Back to A is also a fresh page, never B's (or A's old) state.
    await user.click(screen.getByText('set filter'));
    await act(async () => {
      await router.navigate(-1);
    });
    expect(router.state.location.pathname).toBe('/circles/A/meds');
    expect(screen.getByTestId('filter')).toHaveTextContent('all');
  });

  it('?tab=history from circle A does not carry into circle B', async () => {
    const user = userEvent.setup();
    const router = renderAt('/circles/A/meds');
    await user.click(screen.getByText('set tab'));
    expect(screen.getByTestId('tab')).toHaveTextContent('history');

    await act(async () => {
      await router.navigate('/circles/B/meds');
    });
    expect(screen.getByTestId('tab')).toHaveTextContent('medications');
  });

  it('opening a different circle with the same section keeps no stale state even from a different section', async () => {
    const user = userEvent.setup();
    const router = renderAt('/circles/A/tasks');
    await user.click(screen.getByText('set filter'));
    await act(async () => {
      await router.navigate('/circles/B/meds');
    });
    expect(screen.getByTestId('filter')).toHaveTextContent('all');
  });
});
