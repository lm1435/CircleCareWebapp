import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import { Header } from '@/components/layout/Header';
import { useCircles } from '@/hooks/useCircles';
import { useAuthStore } from '@/store/authStore';

vi.mock('@/hooks/useCircles', () => ({ useCircles: vi.fn() }));
const mockUseCircles = vi.mocked(useCircles);

const circles = [
  { id: 'c1', name: "Mom's Care", recipient_name: 'Rosa' },
  { id: 'c2', name: "Dad's Care", recipient_name: 'Hector' },
];

function circlesResult(overrides: Record<string, unknown> = {}): ReturnType<typeof useCircles> {
  return {
    data: circles,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  } as never;
}

function LocationSpy(): ReactElement {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderHeader(initialPath = '/circles/c1/calendar'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <LocationSpy />
      <Routes>
        <Route path="/circles/:circleId/:section" element={<Header />} />
        <Route path="/circles/:circleId" element={<Header />} />
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>
  );
}

const initialAuthState = useAuthStore.getState();

describe('Header', () => {
  beforeEach(() => {
    mockUseCircles.mockReturnValue(circlesResult());
    useAuthStore.setState({
      user: { id: 'u1', email: 'pat@example.com', first_name: 'Pat', last_name: 'Lee' },
      isAuthenticated: true,
    });
  });

  afterEach(() => {
    useAuthStore.setState(initialAuthState, true);
    vi.clearAllMocks();
  });

  it('renders the wordmark linking to the current circle overview', () => {
    renderHeader();
    expect(screen.getByRole('link', { name: 'CircleCare' })).toHaveAttribute('href', '/circles/c1');
  });

  describe('circle switcher', () => {
    it('shows the current circle name on the trigger', () => {
      renderHeader('/circles/c1/calendar');
      expect(screen.getByRole('button', { name: /Mom's Care/ })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
    });

    it('lists fetched circles and navigates preserving the current section', async () => {
      const user = userEvent.setup();
      renderHeader('/circles/c1/activity');

      await user.click(screen.getByRole('button', { name: /Mom's Care/ }));
      const menu = screen.getByRole('menu', { name: 'Switch circle' });
      expect(menu).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /Dad's Care/ })).toBeInTheDocument();

      await user.click(screen.getByRole('menuitem', { name: /Dad's Care/ }));
      expect(screen.getByTestId('location')).toHaveTextContent('/circles/c2/activity');
    });

    it('keeps the user on the overview when switching from the overview (no section)', async () => {
      const user = userEvent.setup();
      renderHeader('/circles/c1');

      await user.click(screen.getByRole('button', { name: /Mom's Care/ }));
      await user.click(screen.getByRole('menuitem', { name: /Dad's Care/ }));
      expect(screen.getByTestId('location')).toHaveTextContent('/circles/c2');
      expect(screen.getByTestId('location')).not.toHaveTextContent('/circles/c2/calendar');
    });

    it('preserves sections outside the legacy list (tasks) instead of forcing calendar', async () => {
      const user = userEvent.setup();
      renderHeader('/circles/c1/tasks');

      await user.click(screen.getByRole('button', { name: /Mom's Care/ }));
      await user.click(screen.getByRole('menuitem', { name: /Dad's Care/ }));
      expect(screen.getByTestId('location')).toHaveTextContent('/circles/c2/tasks');
    });

    it('supports arrow-key navigation and Escape returns focus to the trigger', async () => {
      const user = userEvent.setup();
      renderHeader();

      const trigger = screen.getByRole('button', { name: /Mom's Care/ });
      trigger.focus();
      await user.keyboard('{ArrowDown}');

      const items = screen.getAllByRole('menuitem');
      expect(items[0]).toHaveFocus();

      await user.keyboard('{ArrowDown}');
      expect(items[1]).toHaveFocus();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });

    it('closes on outside click', async () => {
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByRole('button', { name: /Mom's Care/ }));
      expect(screen.getByRole('menu', { name: 'Switch circle' })).toBeInTheDocument();

      fireEvent.mouseDown(document.body);
      await waitFor(() =>
        expect(screen.queryByRole('menu', { name: 'Switch circle' })).not.toBeInTheDocument()
      );
    });

    it('shows a skeleton while circles load', () => {
      mockUseCircles.mockReturnValue(circlesResult({ data: undefined, isLoading: true }));
      renderHeader();

      expect(document.body.querySelector('.cc-shimmer')).not.toBeNull();
      expect(screen.queryByRole('button', { name: /Mom's Care/ })).not.toBeInTheDocument();
    });

    it('shows an inline error with a retry action', async () => {
      const refetch = vi.fn();
      mockUseCircles.mockReturnValue(circlesResult({ data: undefined, isError: true, refetch }));
      const user = userEvent.setup();
      renderHeader();

      expect(screen.getByText("Couldn't load your circles")).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('user menu', () => {
    it('shows the user name and initials', async () => {
      const user = userEvent.setup();
      renderHeader();

      const trigger = screen.getByRole('button', { name: 'Account' });
      expect(trigger).toHaveTextContent('PL');
      expect(trigger).toHaveTextContent('Pat Lee');

      await user.click(trigger);
      expect(screen.getByText('pat@example.com')).toBeInTheDocument();
    });

    it('logout calls authStore signOut and navigates to /login', async () => {
      const signOut = vi.fn().mockResolvedValue(undefined);
      useAuthStore.setState({ signOut } as never);
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByRole('button', { name: 'Account' }));
      await user.click(screen.getByRole('menuitem', { name: 'Log out' }));

      expect(signOut).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    });

    it('logout still navigates to /login if the store has no signOut (stub-era interface)', async () => {
      // Defensive path: layout was built against the authStore stub, which had
      // no signOut. Simulate that interface to keep the fallback covered.
      useAuthStore.setState({ signOut: undefined } as never);
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByRole('button', { name: 'Account' }));
      await user.click(screen.getByRole('menuitem', { name: 'Log out' }));

      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    });
  });
});
