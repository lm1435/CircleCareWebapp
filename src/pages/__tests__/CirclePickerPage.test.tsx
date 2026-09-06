import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigationType,
  useParams,
  type NavigationType,
} from 'react-router-dom';
import type { ReactElement } from 'react';
import '@/i18n';
import CirclePickerPage from '@/pages/CirclePickerPage';
import { getCircles, type Circle } from '@/api/circles';
import { useAuthStore } from '@/store/authStore';

vi.mock('@/api/circles', () => ({
  getCircles: vi.fn(),
}));

// The hero cards fetch a per-circle today's-meds summary. Stub it to an
// empty-day summary so cards settle deterministically on "No medications today".
vi.mock('@/api/medicationConfirmations', () => ({
  getMedicationTodaySummary: vi.fn().mockResolvedValue({
    total_today: 0,
    taken: 0,
    overdue: 0,
    not_marked_today: 0,
    not_marked_yesterday: 0,
    not_marked_total: 0,
    next_due: null,
    next_due_medication: null,
    timezone: 'America/New_York',
  }),
}));

const mockGetCircles = vi.mocked(getCircles);

// R4-5 onboarding funnel — this page reports the resolved circle count so the
// module can fire onboarding_started (0) / onboarding_flow_completed 'existing'
// (>0). Guards live inside the mocked module; here we assert the wire-up.
const trackCirclesLoaded = vi.fn();
vi.mock('@/lib/onboardingAnalytics', () => ({
  trackCirclesLoaded: (count: number) => trackCirclesLoaded(count),
}));

function makeCircle(overrides: Partial<Circle> = {}): Circle {
  return {
    id: 'c1',
    name: "Mom's Care",
    recipient_name: 'Rose',
    recipient_photo_url: null,
    role: 'owner',
    is_care_recipient: false,
    member_count: 4,
    created_at: '2026-01-01T00:00:00Z',
    access_level: 'full',
    is_premium_circle: true,
    can_edit: true,
    view_only: false,
    read_only: false,
    ...overrides,
  };
}

function renderPicker(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/circles']}>
        <Routes>
          <Route path="/circles" element={<CirclePickerPage />} />
          <Route path="/circles/:circleId" element={<div data-testid="overview-page" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Reports which circle it landed on and whether the router got there via a
 *  REPLACE (auto-skip) or a PUSH (an ordinary link click). */
function OverviewNavigationProbe(): ReactElement {
  const { circleId } = useParams<{ circleId: string }>();
  const navType: NavigationType = useNavigationType();
  return <div data-testid="overview-page">{`${circleId}:${navType}`}</div>;
}

function renderPickerAt(entry: { pathname: string; state?: unknown }): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/circles" element={<CirclePickerPage />} />
          <Route path="/circles/:circleId" element={<OverviewNavigationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CirclePickerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // A couple of tests set a first-name user to exercise the greeting eyebrow;
    // restore the store's default so it never leaks into an unrelated test.
    useAuthStore.setState({ user: null, isAuthenticated: false });
  });

  // The greeting used to be an uppercase-tracked eyebrow with a leading dot
  // (spec §6.2 removes both) — it is now a plain small label paragraph, and
  // the name renders in the shared `editorialTitle` type variant.
  it('renders the greeting as a plain label, not an eyebrow, above the editorial name', async () => {
    useAuthStore.setState({
      user: { id: 'user-1', email: 'u@example.com', first_name: 'Rose' } as never,
      isAuthenticated: true,
    });
    mockGetCircles.mockResolvedValue([
      makeCircle(),
      makeCircle({ id: 'c2', name: "Dad's Circle", recipient_name: 'Hector', role: 'member' }),
    ]);
    renderPicker();

    await screen.findByRole('link', { name: /Open Mom's Care/ });

    const greeting = screen.getByText(/^(Good morning|Good afternoon|Good evening)$/);
    expect(greeting.className).not.toContain('eyebrow');
    expect(greeting.className).not.toContain('uppercase');
    expect(greeting.className).toContain('text-ink-3');

    const name = screen.getByRole('heading', { name: 'Rose' });
    expect(name.className).toContain('text-[42px]');
  });

  // Two circles never auto-skip — the grid is the landing state.
  it('renders circle cards with name, care-together subtitle, and role', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle(),
      makeCircle({
        id: 'c2',
        name: "Dad's Circle",
        recipient_name: 'Hector',
        role: 'member',
        member_count: 1,
      }),
    ]);
    renderPicker();

    const momCard = await screen.findByRole('link', { name: /Open Mom's Care/ });
    expect(within(momCard).getByText("Mom's Care")).toBeInTheDocument();
    expect(within(momCard).getByText('Caring together with 4 people')).toBeInTheDocument();
    expect(within(momCard).getByText('Owner')).toBeInTheDocument();
    expect(momCard).toHaveAttribute('href', '/circles/c1');

    const dadCard = screen.getByRole('link', { name: /Open Dad's Circle/ });
    expect(within(dadCard).getByText('Caregiver')).toBeInTheDocument();
    expect(within(dadCard).getByText('Caring together with 1 person')).toBeInTheDocument();
  });

  it('R4-5: reports the resolved circle count (>= 1) to the onboarding funnel', async () => {
    mockGetCircles.mockResolvedValue([makeCircle(), makeCircle({ id: 'c2' })]);
    renderPicker();

    await waitFor(() => expect(trackCirclesLoaded).toHaveBeenCalledWith(2));
  });

  it('R4-5: reports zero circles to the onboarding funnel (started signal)', async () => {
    mockGetCircles.mockResolvedValue([]);
    renderPicker();

    await waitFor(() => expect(trackCirclesLoaded).toHaveBeenCalledWith(0));
  });

  // These fixtures always include a SECOND circle: a single circle now
  // auto-skips straight to its overview (see the auto-skip suite below), so a
  // one-circle fixture would navigate away before these card-content
  // assertions ever ran.
  it('shows the Care recipient role for is_care_recipient memberships', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle({ role: 'member', is_care_recipient: true }),
      makeCircle({ id: 'c2', name: 'Other Circle' }),
    ]);
    renderPicker();

    const card = await screen.findByRole('link', { name: /Open Mom's Care/ });
    expect(within(card).getByText('Care recipient')).toBeInTheDocument();
  });

  it('shows the Read-only badge with owner subtitle on read_only circles owned by the user', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle({ read_only: true, can_edit: false }),
      makeCircle({ id: 'c2', name: 'Other Circle' }),
    ]);
    renderPicker();

    const card = await screen.findByRole('link', { name: /Open Mom's Care/ });
    expect(within(card).getByText('Read-only')).toBeInTheDocument();
    expect(
      within(card).getByText('Your subscription ended — view-only for now.')
    ).toBeInTheDocument();
  });

  it('shows the member subtitle on read_only circles where the user is a member', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle({ role: 'member', read_only: true, can_edit: false }),
      makeCircle({ id: 'c2', name: 'Other Circle' }),
    ]);
    renderPicker();

    const card = await screen.findByRole('link', { name: /Open Mom's Care/ });
    expect(within(card).getByText('Read-only')).toBeInTheDocument();
    expect(within(card).getByText('You can view but not edit this circle')).toBeInTheDocument();
  });

  it('shows the View-only badge and subtitle on view_only circles', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle({ role: 'member', view_only: true, can_edit: false }),
      makeCircle({ id: 'c2', name: 'Other Circle' }),
    ]);
    renderPicker();

    const card = await screen.findByRole('link', { name: /Open Mom's Care/ });
    expect(within(card).getByText('View-only')).toBeInTheDocument();
    expect(
      within(card).getByText('View-only — ask the circle owner if you need to make changes.')
    ).toBeInTheDocument();
  });

  it('subdues restricted cards but keeps them clickable links', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle({ id: 'c1', name: 'Restricted', read_only: true, can_edit: false }),
      makeCircle({ id: 'c2', name: 'Normal' }),
    ]);
    renderPicker();

    const restricted = await screen.findByRole('link', { name: /Open Restricted/ });
    expect(restricted).toHaveAttribute('data-restricted', 'true');
    expect(restricted).toHaveAttribute('href', '/circles/c1');

    const normal = screen.getByRole('link', { name: /Open Normal/ });
    expect(normal).not.toHaveAttribute('data-restricted');
  });

  it('navigates to the circle overview on click', async () => {
    const user = userEvent.setup();
    mockGetCircles.mockResolvedValue([makeCircle(), makeCircle({ id: 'c2', name: 'Other Circle' })]);
    renderPicker();

    await user.click(await screen.findByRole('link', { name: /Open Mom's Care/ }));
    expect(screen.getByTestId('overview-page')).toBeInTheDocument();
  });

  it('renders the empty state with download CTA when the user has no circles', async () => {
    mockGetCircles.mockResolvedValue([]);
    renderPicker();

    expect(await screen.findByText("Let's set up your care circle")).toBeInTheDocument();
    expect(
      screen.getByText(
        'A circle is a private space where family and caregivers come together to care for someone you love — medications, appointments, and tasks, all in one place.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('Prefer your phone? Get the companion app.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download on the App Store' })).toHaveAttribute(
      'href',
      'https://apps.apple.com/app/id6757629684'
    );
    expect(screen.getByRole('link', { name: 'Get it on Google Play' })).toHaveAttribute(
      'href',
      'https://play.google.com/store/apps/details?id=com.circlecare.circlecare'
    );
  });

  it('shows skeleton cards while loading', () => {
    mockGetCircles.mockReturnValue(new Promise<Circle[]>(() => {}));
    renderPicker();

    expect(screen.getByRole('list', { name: 'Loading...' })).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an error state and retries on demand', async () => {
    const user = userEvent.setup();
    mockGetCircles.mockRejectedValueOnce(new Error('network'));
    mockGetCircles.mockResolvedValueOnce([
      makeCircle(),
      makeCircle({ id: 'c2', name: 'Other Circle' }),
    ]);
    renderPicker();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load circles');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: /Open Mom's Care/ })).toBeInTheDocument();
  });
});

// Spec §6.2 / mobile CircleListScreen: with exactly one circle, the picker is
// a wasted extra tap — skip straight to it. The header's "All circles"
// switcher item is the one deliberate way back in, and it marks its own
// navigation with `state: { fromSwitcher: true }` (Header.tsx) so this effect
// knows not to immediately bounce that visit back out.
describe('CirclePickerPage — auto-skip to a single circle', () => {
  it('navigates straight into the only circle, replacing the history entry', async () => {
    mockGetCircles.mockResolvedValue([makeCircle()]);
    renderPickerAt({ pathname: '/circles' });

    expect(await screen.findByTestId('overview-page')).toHaveTextContent('c1:REPLACE');
  });

  it('does NOT auto-skip when the visit came from the "All circles" switcher item', async () => {
    mockGetCircles.mockResolvedValue([makeCircle()]);
    renderPickerAt({ pathname: '/circles', state: { fromSwitcher: true } });

    await screen.findByRole('link', { name: /Open Mom's Care/ });
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
  });

  it('never auto-skips with two or more circles', async () => {
    mockGetCircles.mockResolvedValue([makeCircle(), makeCircle({ id: 'c2', name: "Dad's Circle" })]);
    renderPickerAt({ pathname: '/circles' });

    await screen.findByRole('link', { name: /Open Mom's Care/ });
    expect(screen.getByRole('link', { name: /Open Dad's Circle/ })).toBeInTheDocument();
    expect(screen.queryByTestId('overview-page')).not.toBeInTheDocument();
  });
});
