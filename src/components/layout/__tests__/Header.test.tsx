import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@/i18n';
import { Header } from '@/components/layout/Header';
import { Avatar } from '@/components/ui';
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
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="location-state">{JSON.stringify(location.state)}</div>
    </>
  );
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

// The account menu item, the dialog title and the confirm button all render
// `header.logout`/`header.logoutConfirmTitle`. Read the copy from the locale
// file rather than hardcoding it, so a wording change can't leave these
// assertions passing against a label the UI no longer shows.
const COMMON_EN = JSON.parse(
  readFileSync(join(__dirname, '..', '..', '..', 'i18n', 'en', 'common.json'), 'utf8')
) as { header: { logout: string; logoutConfirmTitle: string; logoutConfirmBody: string } };
const LOGOUT = COMMON_EN.header.logout;
const LOGOUT_TITLE = COMMON_EN.header.logoutConfirmTitle;
const LOGOUT_BODY = COMMON_EN.header.logoutConfirmBody;

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

  // Spec §5.1: the hamburger is gone — the floating nav pill replaces the
  // drawer. A leftover trigger would open a drawer that no longer exists.
  it('renders no hamburger / navigation-menu trigger', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: 'Navigation menu' })).not.toBeInTheDocument();
    expect(document.body.querySelector('[aria-controls="mobile-nav"]')).toBeNull();
  });

  it('accepts (and ignores) the deprecated nav props so AppLayout still compiles', () => {
    render(
      <MemoryRouter initialEntries={['/circles/c1']}>
        <Routes>
          <Route path="/circles/:circleId" element={<Header navOpen onToggleNav={vi.fn()} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: 'Navigation menu' })).not.toBeInTheDocument();
  });

  it('is 60px tall on the cream ground with a hairline rule (spec §5.1)', () => {
    renderHeader();
    const header = document.body.querySelector('header');
    expect(header).toHaveClass('h-[60px]', 'border-b', 'border-line', 'bg-cream');
  });

  it('draws no SVG by hand — every glyph comes from <Icon> (spec §4.3)', () => {
    const src = readFileSync(join(__dirname, '..', 'Header.tsx'), 'utf8');
    expect(src).not.toMatch(/<svg/);
    expect(src).not.toMatch(/<path\b/);
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

    // WA4 regression: 'notes' was missing from SECTIONS, so switching circles
    // while on the Notes page silently dumped the user onto the new circle's
    // overview (the unknown-segment fallback) instead of staying on Notes.
    it('preserves the notes section across a circle switch', async () => {
      const user = userEvent.setup();
      renderHeader('/circles/c1/notes');

      await user.click(screen.getByRole('button', { name: /Mom's Care/ }));
      await user.click(screen.getByRole('menuitem', { name: /Dad's Care/ }));
      expect(screen.getByTestId('location')).toHaveTextContent('/circles/c2/notes');
    });

    it('marks the current circle with a check and leaves the others unmarked', async () => {
      const user = userEvent.setup();
      renderHeader('/circles/c1/calendar');

      await user.click(screen.getByRole('button', { name: /Mom's Care/ }));
      const currentItem = screen.getByRole('menuitem', { name: /Mom's Care/ });
      const otherItem = screen.getByRole('menuitem', { name: /Dad's Care/ });
      // The check is an <Icon>, which injects a decorative ionicons <svg>.
      expect(currentItem.querySelector('svg')).not.toBeNull();
      expect(otherItem.querySelector('svg')).toBeNull();
    });

    it('"All circles" navigates to the picker flagged as a deliberate arrival', async () => {
      const user = userEvent.setup();
      renderHeader('/circles/c1/calendar');

      await user.click(screen.getByRole('button', { name: /Mom's Care/ }));
      await user.click(screen.getByRole('menuitem', { name: 'All circles' }));

      expect(screen.getByTestId('location')).toHaveTextContent('/circles');
      // Task 13 reads this flag to skip the single-circle auto-redirect, which
      // would otherwise bounce the user straight back into the circle they left.
      expect(screen.getByTestId('location-state')).toHaveTextContent('"fromSwitcher":true');
    });

    it('offers Vitals, Members and Circle Settings for the current circle, hidden at xl (spec §5.3)', async () => {
      const user = userEvent.setup();
      renderHeader('/circles/c1/calendar');
      await user.click(screen.getByRole('button', { name: /Mom's Care/ }));

      for (const [name, href] of [
        ['Vitals', '/circles/c1/vitals'],
        ['Members', '/circles/c1/members'],
        ['Circle Settings', '/circles/c1/settings'],
      ] as const) {
        const item = screen.getByRole('menuitem', { name });
        // Above the sidebar breakpoint the sidebar already lists these, so the
        // switcher must not offer a second door to the same page.
        expect(item).toHaveClass('xl:hidden');
        expect(href).toBeTruthy();
      }
    });

    it.each([
      ['Vitals', '/circles/c1/vitals'],
      ['Members', '/circles/c1/members'],
      ['Circle Settings', '/circles/c1/settings'],
    ])('the %s item navigates to %s', async (name, href) => {
      const user = userEvent.setup();
      renderHeader('/circles/c1/calendar');
      await user.click(screen.getByRole('button', { name: /Mom's Care/ }));
      await user.click(screen.getByRole('menuitem', { name }));
      expect(screen.getByTestId('location')).toHaveTextContent(href);
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

      expect(screen.getByText("Couldn't load your circles.")).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('user menu', () => {
    it('shows the user name and initials', async () => {
      const user = userEvent.setup();
      renderHeader();

      const trigger = screen.getByRole('button', { name: 'Account' });
      expect(trigger).toHaveTextContent('P');
      expect(trigger).toHaveTextContent('Pat Lee');

      await user.click(trigger);
      expect(screen.getByText('pat@example.com')).toBeInTheDocument();
    });

    // W4 — the header used to hand-roll its own initials circle; it now
    // renders the shared Avatar component, so it must produce the exact same
    // deterministic tint as every other Avatar call site (e.g. CircleCard)
    // for the same name.
    it('renders the shared Avatar tint for the account trigger, matching other call sites', () => {
      renderHeader();
      const trigger = screen.getByRole('button', { name: 'Account' });
      const headerAvatar = trigger.querySelector('span[aria-hidden="true"]');
      expect(headerAvatar).not.toBeNull();

      const { container } = render(<Avatar name="Pat Lee" />);
      const standaloneAvatar = container.firstElementChild;

      const tint = (el: Element | null): string[] =>
        Array.from(el?.classList ?? []).filter((c) => c.includes('-soft') || c.includes('-deep'));
      expect(tint(headerAvatar)).toEqual(tint(standaloneAvatar));
    });

    it('shows the email initial for a user with no first/last name', () => {
      useAuthStore.setState({
        user: { id: 'u2', email: 'ana@example.com', first_name: null, last_name: null },
        isAuthenticated: true,
      });
      renderHeader();

      const trigger = screen.getByRole('button', { name: 'Account' });
      const avatarSpan = trigger.querySelector('span[aria-hidden="true"]');
      expect(avatarSpan).toHaveTextContent(/^A$/);
      expect(trigger).toHaveTextContent('ana@example.com');
    });

    it('offers Profile, Help and the sign-out item', async () => {
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByRole('button', { name: 'Account' }));
      const menu = screen.getByRole('menu', { name: 'Account' });
      expect(within(menu).getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: 'Help & FAQ' })).toBeInTheDocument();
      expect(within(menu).getByRole('menuitem', { name: LOGOUT })).toBeInTheDocument();
    });

    // Spec §5.6: logout is one click from every page, so it asks first.
    it('signing out opens a confirmation and does NOT sign out until it is confirmed', async () => {
      const signOut = vi.fn().mockResolvedValue(undefined);
      useAuthStore.setState({ signOut } as never);
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByRole('button', { name: 'Account' }));
      await user.click(screen.getByRole('menuitem', { name: LOGOUT }));

      const dialog = await screen.findByRole('dialog');
      expect(dialog).toHaveAccessibleName(LOGOUT_TITLE);
      expect(within(dialog).getByText(LOGOUT_BODY)).toBeInTheDocument();

      // The mere act of opening the dialog must not log anyone out.
      expect(signOut).not.toHaveBeenCalled();
      expect(screen.getByTestId('location')).not.toHaveTextContent('/login');

      await user.click(within(dialog).getByRole('button', { name: LOGOUT }));

      expect(signOut).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    });

    it('cancelling the confirmation leaves the session alone', async () => {
      const signOut = vi.fn().mockResolvedValue(undefined);
      useAuthStore.setState({ signOut } as never);
      const user = userEvent.setup();
      renderHeader();

      const trigger = screen.getByRole('button', { name: 'Account' });
      await user.click(trigger);
      await user.click(screen.getByRole('menuitem', { name: LOGOUT }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(signOut).not.toHaveBeenCalled();
      expect(screen.getByTestId('location')).not.toHaveTextContent('/login');
      // Backing out must return the keyboard where it started. The menu item
      // that opened the dialog is gone by then, so the account trigger has to
      // hold focus across the whole detour — otherwise focus falls to <body>
      // and a keyboard user restarts from the top of the document.
      expect(trigger).toHaveFocus();
    });

    it('confirmed logout still navigates to /login if the store has no signOut (stub-era interface)', async () => {
      // Defensive path: layout was built against the authStore stub, which had
      // no signOut. Simulate that interface to keep the fallback covered.
      useAuthStore.setState({ signOut: undefined } as never);
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByRole('button', { name: 'Account' }));
      await user.click(screen.getByRole('menuitem', { name: LOGOUT }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: LOGOUT }));

      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
    });
  });
});
