import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { AppLayout } from '@/components/layout/AppLayout';
// AppLayout now raises the premium gate itself for a frozen circle's owner
// (the AI entry), and `usePremiumGate` -> `useToast` requires the provider that
// App.tsx already wraps the whole authenticated tree in.
import { ToastProvider } from '@/components/ui/Toast';
import { useAuthStore } from '@/store/authStore';

vi.mock('@/hooks/useCircles', () => ({
  useCircles: vi.fn(() => ({
    data: [{ id: 'c1', name: "Mom's Care", recipient_name: 'Rosa' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  })),
}));

vi.mock('@/components/meds/TodaysMeds', () => ({
  TodaysMeds: () => <div data-testid="todays-meds" />,
}));

// useCircle is React Query-backed; this layout test has no QueryClientProvider,
// so stub it with the gating fields the create + assistant surfaces read.
//
// `isPremiumCircle` is NOT optional here. The AI gate reads it (see
// `lib/aiAccess.ts`), and omitting it makes this a free-tier circle whose
// viewer is not the owner — i.e. no assistant entry at all, which is a
// different circle than this suite means. The AI RULE is covered by
// AppLayout.aiGate.test.tsx; this suite only needs a circle where the entry
// exists so it can test the shell around it.
vi.mock('@/hooks/useCircle', () => ({
  useCircle: vi.fn(() => ({
    circle: { id: 'c1', owner_id: 'u1', is_self_care: false },
    canEdit: true,
    isPremiumCircle: true,
    viewOnly: false,
  })),
}));

vi.mock('@/components/NeedsCircleSelectionBanner', () => ({
  NeedsCircleSelectionBanner: () => null,
}));

// The assistant modal is React Query-backed; this stub only reports whether the
// layout opened it, which is all the shell owns.
vi.mock('@/components/ai/AIChatModal', () => ({
  AIChatModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="ai-chat-modal" /> : null,
}));

vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({ initialType }: { initialType: string }) => (
    <div data-testid="add-event-modal" data-initial-type={initialType} />
  ),
}));

// R4-5 onboarding funnel — the layout reports the resolved circle count (the
// mocked useCircles above resolves one circle) so deep links into a circle
// still feed the funnel. Guards live inside the mocked module.
const trackCirclesLoaded = vi.fn();
vi.mock('@/lib/onboardingAnalytics', () => ({
  trackCirclesLoaded: (count: number) => trackCirclesLoaded(count),
}));

const initialAuthState = useAuthStore.getState();

function renderLayout(path = '/circles/c1/calendar'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <Routes>
          <Route path="/circles/:circleId" element={<AppLayout />}>
            <Route index element={<div>Overview page stub</div>} />
            <Route path="calendar" element={<div>Calendar page stub</div>} />
            <Route path="meds" element={<div>Meds page stub</div>} />
            <Route path="emergency" element={<div>Emergency page stub</div>} />
            <Route path="tasks" element={<div>Tasks page stub</div>} />
            <Route path="notes" element={<div data-testid="notes-page-stub">Notes page stub</div>} />
          </Route>
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}

/** The bottom pill. Labelled `nav.label` like the sidebar's nav, hence the id. */
function pill(): HTMLElement {
  return screen.getByTestId('floating-nav');
}

describe('AppLayout', () => {
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

  it('renders a skip link as the first link, targeting the main landmark', () => {
    renderLayout();

    const firstLink = document.body.querySelector('a');
    expect(firstLink).toHaveTextContent('Skip to content');
    expect(firstLink).toHaveAttribute('href', '#main');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
  });

  it('R4-5: reports the resolved circle count to the onboarding funnel on deep links', () => {
    renderLayout();

    expect(trackCirclesLoaded).toHaveBeenCalledWith(1);
  });

  it('renders semantic landmarks: banner, navigation, main, and page content', () => {
    renderLayout();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    // Two navigation landmarks exist in the DOM — the sidebar's (visible from
    // xl) and the pill's (visible below it). CSS hides one at every width; jsdom
    // applies none, so both are present here.
    expect(screen.getAllByRole('navigation', { name: 'Main navigation' })).toHaveLength(2);
    expect(within(screen.getByRole('main')).getByText('Calendar page stub')).toBeInTheDocument();
  });

  it('no longer renders the install banner, the hamburger, or the drawer', () => {
    renderLayout();

    expect(screen.queryByRole('button', { name: 'Navigation menu' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close navigation menu' })).not.toBeInTheDocument();
  });

  it('renders the desktop sidebar column (hidden below xl by CSS, not by unmounting)', () => {
    renderLayout();

    const sidebar = document.querySelector('aside');
    expect(sidebar).not.toBeNull();
    expect(sidebar).toHaveClass('hidden', 'xl:flex', 'w-[272px]');
  });

  it('reserves the pill height under <main> and drops it at xl', () => {
    renderLayout();

    expect(screen.getByRole('main')).toHaveClass('pb-[calc(var(--nav-h,0px)+var(--nav-inset,0px)+24px)]', 'xl:pb-0');
  });

  it('mounts the FloatingNavBar with five cells in order', () => {
    renderLayout();

    expect(Array.from(pill().children).map((cell) => cell.textContent)).toEqual([
      'Home',
      'Care',
      'New',
      'Health',
      'AI',
    ]);
  });

  it('re-keys the page fade wrapper on navigation, but never <main> itself', async () => {
    const user = userEvent.setup();
    renderLayout();

    const main = screen.getByRole('main');
    const before = main.firstElementChild;
    expect(before).toHaveClass('animate-[fade-in_200ms_ease-out]');

    await user.click(within(pill()).getByRole('link', { name: 'Health' }));

    const after = screen.getByRole('main').firstElementChild;
    expect(after).toHaveClass('animate-[fade-in_200ms_ease-out]');
    // A new node, not the same one re-rendered: the key changed with the path.
    expect(after).not.toBe(before);
    expect(within(screen.getByRole('main')).getByText('Emergency page stub')).toBeInTheDocument();
    // 2.4.1: <main> itself carries no key, so a route change never remounts
    // it — anything focused on the landmark (e.g. the skip link's target)
    // survives navigation instead of being yanked back to <body>.
    expect(screen.getByRole('main')).toBe(main);
  });

  // 2.4.1 (SERIOUS, live-repro'd): `<main>` used to have no way to receive
  // focus at all, so activating `href="#main"` moved the URL hash but left
  // focus on <body> — the very next Tab re-entered the nav instead of
  // reaching page content.
  it('the skip link moves focus to the main landmark', async () => {
    const user = userEvent.setup();
    renderLayout();

    const skipLink = document.body.querySelector('a') as HTMLAnchorElement;
    expect(skipLink).toHaveAttribute('href', '#main');
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('tabindex', '-1');
    expect(main).not.toHaveFocus();

    await user.click(skipLink);

    expect(main).toHaveFocus();
  });

  it('opens the AddMenu from the pill NEW cell and mounts AddEventModal for a task', async () => {
    const user = userEvent.setup();
    renderLayout();

    const newCell = within(pill()).getByRole('button', { name: 'New' });
    expect(newCell).toHaveAttribute('aria-expanded', 'false');

    await user.click(newCell);
    expect(newCell).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('menuitem', { name: 'Task' }));

    expect(screen.getByTestId('add-event-modal')).toHaveAttribute('data-initial-type', 'task');
    expect(newCell).toHaveAttribute('aria-expanded', 'false');
  });

  it('navigates to Notes (no modal) when Note is picked from the pill', async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(within(pill()).getByRole('button', { name: 'New' }));
    await user.click(screen.getByRole('menuitem', { name: 'Note' }));

    expect(screen.queryByTestId('add-event-modal')).not.toBeInTheDocument();
    expect(await screen.findByTestId('notes-page-stub')).toBeInTheDocument();
  });

  it('opens the assistant modal from the pill AI cell', async () => {
    const user = userEvent.setup();
    renderLayout();

    expect(screen.queryByTestId('ai-chat-modal')).not.toBeInTheDocument();

    await user.click(within(pill()).getByRole('button', { name: 'AI' }));

    expect(screen.getByTestId('ai-chat-modal')).toBeInTheDocument();
  });

  it('scrolls the window to the top on a forward route change, not on first load', async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
    const user = userEvent.setup();
    renderLayout('/circles/c1/calendar');
    // The initial entry is a POP: the browser owns that scroll position.
    expect(scrollTo).not.toHaveBeenCalled();

    await user.click(within(pill()).getByRole('link', { name: 'Health' }));
    expect(await screen.findByText('Emergency page stub')).toBeInTheDocument();
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 0 }));
  });
});
