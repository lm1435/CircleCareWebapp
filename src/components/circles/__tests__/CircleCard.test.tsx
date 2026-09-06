import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import { CircleCard } from '@/components/circles/CircleCard';
import type { Circle } from '@/api/circles';
import { getMedicationTodaySummary } from '@/api/medicationConfirmations';
import { Analytics } from '@/lib/analytics';

vi.mock('@/api/medicationConfirmations', () => ({
  getMedicationTodaySummary: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  Analytics: { circleViewed: vi.fn() },
}));

const mockGetSummary = vi.mocked(getMedicationTodaySummary);

const EMPTY_SUMMARY = {
  total_today: 0,
  taken: 0,
  overdue: 0,
  not_marked_today: 0,
  not_marked_yesterday: 0,
  not_marked_total: 0,
  next_due: null,
  next_due_medication: null,
  timezone: 'America/New_York',
};

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

function renderCard(circle: Circle) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/circles']}>
        <Routes>
          <Route
            path="/circles"
            element={
              <ul>
                <CircleCard circle={circle} />
              </ul>
            }
          />
          <Route path="/circles/:circleId" element={<div data-testid="overview-page" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CircleCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSummary.mockResolvedValue(EMPTY_SUMMARY);
  });

  it('renders the name, subtitle, owner badge, and chevron for a normal circle', async () => {
    renderCard(makeCircle());

    // aria-label REPLACES the link's accessible name wholesale — a screen
    // reader tabbing to the card never hears the visible med-row text
    // otherwise, so it has to be folded into the label by hand.
    const link = await screen.findByRole('link', {
      name: "Open Mom's Care (Owner), No medications today",
    });
    expect(link).toHaveAttribute('href', '/circles/c1');
    expect(link).not.toHaveAttribute('data-restricted');
    expect(screen.getByText("Mom's Care")).toBeInTheDocument();
    expect(screen.getByText('Caring together with 4 people')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('shows the Caregiver badge for a member role', async () => {
    renderCard(makeCircle({ role: 'member', member_count: 1 }));

    await screen.findByRole('link');
    expect(screen.getByText('Caregiver')).toBeInTheDocument();
    expect(screen.getByText('Caring together with 1 person')).toBeInTheDocument();
  });

  it('shows the Care recipient badge for an is_care_recipient membership', async () => {
    renderCard(makeCircle({ role: 'member', is_care_recipient: true }));

    await screen.findByRole('link');
    expect(screen.getByText('Care recipient')).toBeInTheDocument();
  });

  it('shows the Read-only badge, subdues the card, skips the meds fetch, and folds it into the label', async () => {
    renderCard(makeCircle({ read_only: true, can_edit: false }));

    const link = await screen.findByRole('link', {
      name: "Open Mom's Care (Owner), Read-only",
    });
    expect(link).toHaveAttribute('data-restricted', 'true');
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText('Your subscription ended — view-only for now.')).toBeInTheDocument();
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  it('shows the View-only badge and subtitle, and folds it into the label', async () => {
    renderCard(makeCircle({ role: 'member', view_only: true, can_edit: false }));

    const link = await screen.findByRole('link', {
      name: "Open Mom's Care (Caregiver), View-only",
    });
    expect(link).toHaveAttribute('data-restricted', 'true');
    expect(screen.getByText('View-only')).toBeInTheDocument();
    expect(
      screen.getByText('View-only — ask the circle owner if you need to make changes.')
    ).toBeInTheDocument();
  });

  it('shows the chevron affordance', async () => {
    renderCard(makeCircle());
    await screen.findByRole('link');
    // The chevron icon renders decoratively (aria-hidden) inside the link.
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('navigates to the circle overview and reports the view on click', async () => {
    const user = userEvent.setup();
    renderCard(makeCircle());

    await user.click(await screen.findByRole('link', { name: /Open Mom's Care/ }));

    expect(screen.getByTestId('overview-page')).toBeInTheDocument();
    expect(Analytics.circleViewed).toHaveBeenCalledWith('c1');
  });

  it('shows the overdue alert badge and folds the count into the link label', async () => {
    mockGetSummary.mockResolvedValue({ ...EMPTY_SUMMARY, total_today: 3, taken: 1, overdue: 2 });
    renderCard(makeCircle());

    const link = await screen.findByRole(
      'link',
      { name: /Open Mom's Care \(Owner\) — 1\/3 taken · 2 overdue/ }
    );
    expect(link).toBeInTheDocument();
  });

  it('does NOT fetch meds, show an alert badge, or mention meds in the label for a restricted circle', async () => {
    mockGetSummary.mockResolvedValue({ ...EMPTY_SUMMARY, total_today: 3, taken: 1, overdue: 2 });
    renderCard(makeCircle({ read_only: true, can_edit: false }));

    await screen.findByRole('link', { name: "Open Mom's Care (Owner), Read-only" });
    expect(mockGetSummary).not.toHaveBeenCalled();
  });

  // Mobile's MedicationSnapshotRow, restored below the divider — the picker
  // spec's card description had omitted it. Three states, mirroring mobile's
  // precedence: no meds today → all taken → some still left (overdue folds
  // into the same "taken today" phrasing here; the avatar's small red badge
  // already carries the distinct overdue signal).
  describe('medication status row', () => {
    // `label` resolves to the status `<span>` itself (its icon child carries
    // no text, so RTL's getByText lands on the element whose own text content
    // is the full match — there is no deeper node to prefer).
    it('shows "No medications today" in ink-3, with the medkit icon', async () => {
      mockGetSummary.mockResolvedValue(EMPTY_SUMMARY);
      renderCard(makeCircle());

      await screen.findByRole('link');
      const label = await screen.findByText('No medications today');
      expect(label).toHaveClass('text-ink-2');
      const icon = label.querySelector('span');
      expect(icon).not.toBeNull();
      expect(icon?.className).toContain('text-ink-3');
      expect(icon?.querySelector('svg')).not.toBeNull();
    });

    it('shows "All medications taken" in moss, with the checkmark-circle icon, and folds it into the label', async () => {
      mockGetSummary.mockResolvedValue({ ...EMPTY_SUMMARY, total_today: 3, taken: 3 });
      renderCard(makeCircle());

      await screen.findByRole('link', {
        name: "Open Mom's Care (Owner), All medications taken",
      });
      const label = await screen.findByText('All medications taken');
      const icon = label.querySelector('span');
      expect(icon).not.toBeNull();
      expect(icon?.className).toContain('text-moss');
    });

    it('shows the taken/total count when some meds are still due, and folds it into the label', async () => {
      mockGetSummary.mockResolvedValue({ ...EMPTY_SUMMARY, total_today: 4, taken: 2 });
      renderCard(makeCircle());

      await screen.findByRole('link', { name: "Open Mom's Care (Owner), 2/4 taken today" });
      const label = await screen.findByText('2/4 taken today');
      const icon = label.querySelector('span');
      expect(icon).not.toBeNull();
      expect(icon?.className).toContain('text-ink-3');
    });

    it('puts the role badge on the right of the status row', async () => {
      mockGetSummary.mockResolvedValue(EMPTY_SUMMARY);
      renderCard(makeCircle());

      await screen.findByRole('link');
      const label = await screen.findByText('No medications today');
      const row = label.parentElement;
      expect(row).not.toBeNull();
      expect(row?.className).toContain('border-t');
      expect(within(row as HTMLElement).getByText('Owner')).toBeInTheDocument();
    });

    it('never renders a status row for a restricted circle', async () => {
      mockGetSummary.mockResolvedValue({ ...EMPTY_SUMMARY, total_today: 3, taken: 1 });
      renderCard(makeCircle({ view_only: true, can_edit: false }));

      await screen.findByRole('link');
      expect(screen.queryByText(/taken today|No medications today|All medications taken/)).not.toBeInTheDocument();
    });
  });
});
