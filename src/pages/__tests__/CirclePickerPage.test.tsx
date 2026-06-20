import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import CirclePickerPage from '@/pages/CirclePickerPage';
import { getCircles, type Circle } from '@/api/circles';

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
          <Route path="/circles/:circleId/calendar" element={<div data-testid="calendar-page" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CirclePickerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

    const momCard = await screen.findByRole('link', { name: "Open Mom's Care" });
    expect(within(momCard).getByText("Mom's Care")).toBeInTheDocument();
    expect(within(momCard).getByText('Caring together with 4 people')).toBeInTheDocument();
    expect(within(momCard).getByText('Owner')).toBeInTheDocument();
    expect(momCard).toHaveAttribute('href', '/circles/c1/calendar');

    const dadCard = screen.getByRole('link', { name: "Open Dad's Circle" });
    expect(within(dadCard).getByText('Caregiver')).toBeInTheDocument();
    expect(within(dadCard).getByText('Caring together with 1 person')).toBeInTheDocument();
  });

  it('shows the Care Recipient role for is_care_recipient memberships', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle({ role: 'member', is_care_recipient: true }),
    ]);
    renderPicker();

    const card = await screen.findByRole('link', { name: "Open Mom's Care" });
    expect(within(card).getByText('Care Recipient')).toBeInTheDocument();
  });

  it('shows the Read-only badge with owner subtitle on read_only circles owned by the user', async () => {
    mockGetCircles.mockResolvedValue([makeCircle({ read_only: true, can_edit: false })]);
    renderPicker();

    const card = await screen.findByRole('link', { name: "Open Mom's Care" });
    expect(within(card).getByText('Read-only')).toBeInTheDocument();
    expect(within(card).getByText('Re-subscribe to manage this circle')).toBeInTheDocument();
  });

  it('shows the member subtitle on read_only circles where the user is a member', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle({ role: 'member', read_only: true, can_edit: false }),
    ]);
    renderPicker();

    const card = await screen.findByRole('link', { name: "Open Mom's Care" });
    expect(within(card).getByText('Read-only')).toBeInTheDocument();
    expect(within(card).getByText('You can view but not edit this circle')).toBeInTheDocument();
  });

  it('shows the View Only badge and subtitle on view_only circles', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle({ role: 'member', view_only: true, can_edit: false }),
    ]);
    renderPicker();

    const card = await screen.findByRole('link', { name: "Open Mom's Care" });
    expect(within(card).getByText('View Only')).toBeInTheDocument();
    expect(
      within(card).getByText('View-only access. Contact owner for details.')
    ).toBeInTheDocument();
  });

  it('subdues restricted cards but keeps them clickable links', async () => {
    mockGetCircles.mockResolvedValue([
      makeCircle({ id: 'c1', name: 'Restricted', read_only: true, can_edit: false }),
      makeCircle({ id: 'c2', name: 'Normal' }),
    ]);
    renderPicker();

    const restricted = await screen.findByRole('link', { name: 'Open Restricted' });
    expect(restricted).toHaveAttribute('data-restricted', 'true');
    expect(restricted).toHaveAttribute('href', '/circles/c1/calendar');

    const normal = screen.getByRole('link', { name: 'Open Normal' });
    expect(normal).not.toHaveAttribute('data-restricted');
  });

  it('navigates to the circle calendar on click', async () => {
    const user = userEvent.setup();
    mockGetCircles.mockResolvedValue([makeCircle()]);
    renderPicker();

    await user.click(await screen.findByRole('link', { name: "Open Mom's Care" }));
    expect(screen.getByTestId('calendar-page')).toBeInTheDocument();
  });

  it('renders the empty state with download CTA when the user has no circles', async () => {
    mockGetCircles.mockResolvedValue([]);
    renderPicker();

    expect(
      await screen.findByText("You're not part of any care circle yet.")
    ).toBeInTheDocument();
    expect(
      screen.getByText('Download the app to create one or ask someone to invite you.')
    ).toBeInTheDocument();
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
    mockGetCircles.mockResolvedValueOnce([makeCircle()]);
    renderPicker();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load circles');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: "Open Mom's Care" })).toBeInTheDocument();
  });
});
