import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import {
  getProviderVisits,
  type Provider,
  type ProviderVisit,
  type ProviderVisitsPage as VisitsPayload,
} from '@/api/providers';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import ProviderVisitsPage from '@/pages/ProviderVisitsPage';

// Visits & notes for one doctor (docs/plans/notes-by-doctor.md flow 2): header,
// next visit, past visits by year with notes inline, paging, and the empty /
// loading / error / not-found / view-only / removed-doctor states.

vi.mock('@/api/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/providers')>()),
  getProviderVisits: vi.fn(),
}));

vi.mock('@/lib/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analytics')>()),
  Analytics: { providerVisitsOpened: vi.fn(), errorOccurred: vi.fn() },
}));

const circle = { canEdit: true, timezone: 'America/Chicago' };
vi.mock('@/hooks/useCircle', () => ({ useCircle: () => circle }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

// The add-appointment form is its own suite; here it only has to receive the doctor.
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: (props: { initialType?: string; initialProviderId?: string; onClose: () => void }) => (
    <div role="dialog" aria-label="add-event-stub">
      {props.initialType}:{props.initialProviderId}
      <button onClick={props.onClose}>close-stub</button>
    </div>
  ),
}));

const CIRCLE = 'c1';
const mockVisits = vi.mocked(getProviderVisits);

function provider(over: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'Dr. Patel',
    specialty: 'Cardiology',
    phone: '5552013344',
    country_code: '+1',
    phone_extension: null,
    address: '1200 Heart Center Dr',
    is_primary: true,
    sort_order: 0,
    archived_at: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function visit(over: Partial<ProviderVisit> = {}): ProviderVisit {
  return {
    id: 'ev-1',
    series_id: null,
    parent_event_id: null,
    title: 'Follow-up',
    location: null,
    scheduled_date: '2026-10-02',
    scheduled_time: '10:30:00',
    duration_minutes: null,
    recurrence_rule: null,
    completed_at: null,
    is_virtual: false,
    is_upcoming: false,
    note_count: 0,
    notes: [],
    ...over,
  };
}

function note(id: string, body: string, first: string | null, over = {}) {
  return {
    id,
    event_id: 'ev-1',
    body,
    created_at: '2026-10-02T20:00:00.000Z',
    updated_at: '2026-10-02T20:00:00.000Z',
    author_id: 'u1',
    author: { id: 'u1', first_name: first, last_name: null },
    ...over,
  };
}

function page(over: Partial<VisitsPayload> = {}): VisitsPayload {
  return {
    provider: provider(),
    next_visit: null,
    upcoming: [],
    visits: [],
    page: { limit: 20, has_more: false, next_before: null },
    ...over,
  };
}

function renderPage(state?: unknown, providerId = 'p1') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter
          initialEntries={[{ pathname: `/circles/${CIRCLE}/providers/${providerId}`, state }]}
        >
          <Routes>
            <Route path="/circles/:circleId/providers/:providerId" element={<ProviderVisitsPage />} />
            <Route path="/circles/:circleId/emergency" element={<div>medical-info-page</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  circle.canEdit = true;
  circle.timezone = 'America/Chicago';
});

describe('header and states', () => {
  it('shows a labelled loading status while the first page is on its way', () => {
    mockVisits.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Loading visits');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Visits & notes');
  });

  it('names the doctor and the specialty', async () => {
    mockVisits.mockResolvedValue(page({ visits: [visit()] }));
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Dr. Patel' })).toBeInTheDocument();
    expect(screen.getByText('Cardiology')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call Dr. Patel' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^tel:/)
    );
  });

  it('a removed doctor reads "(removed)", still lists its visits, and offers no call or add-appointment', async () => {
    mockVisits.mockResolvedValue(
      page({ provider: provider({ archived_at: '2026-10-01T00:00:00Z' }), visits: [], next_visit: null })
    );
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Dr. Patel (removed)' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Call/ })).toBeNull();
    // Empty state for a removed doctor: no way to start a new link to them.
    expect(screen.getByText(/No visits with Dr\. Patel \(removed\) yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an appointment' })).toBeNull();
  });

  it('shows an error with a retry that asks again', async () => {
    mockVisits.mockRejectedValueOnce({ success: false, error: { code: 'SERVER_ERROR' } });
    renderPage();
    expect(await screen.findByText("Couldn't load visits")).toBeInTheDocument();
    mockVisits.mockResolvedValue(page({ visits: [visit()] }));
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/Oct 2 · Follow-up/)).toBeInTheDocument();
    expect(mockVisits).toHaveBeenCalledTimes(2);
  });

  it('a doctor that is not in this circle (404) gets a clear message and a way back', async () => {
    mockVisits.mockRejectedValue({ success: false, error: { code: 'NOT_FOUND' } });
    renderPage();
    expect(await screen.findByText("This doctor isn't available.")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Emergency Info' })).toHaveAttribute(
      'href',
      `/circles/${CIRCLE}/emergency`
    );
  });

  it('refuses an id that is not an id before any request is built from it', async () => {
    renderPage(undefined, '..%2F..%2Fx');
    expect(await screen.findByText("This doctor isn't available.")).toBeInTheDocument();
    expect(mockVisits).not.toHaveBeenCalled();
  });
});

describe('empty state', () => {
  it('invites an editor to add an appointment, with this doctor preselected', async () => {
    mockVisits.mockResolvedValue(page({ provider: provider({ name: 'Dr. Kim', id: 'p2' }) }));
    renderPage();
    expect(await screen.findByText('No visits with Dr. Kim yet')).toBeInTheDocument();
    expect(screen.getByText(/Visits show up here once you choose Dr\. Kim as the doctor on an appointment/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add an appointment' }));
    expect(screen.getByRole('dialog', { name: 'add-event-stub' })).toHaveTextContent('appointment:p2');
  });

  it('a view-only member sees the explanation without the add button', async () => {
    circle.canEdit = false;
    mockVisits.mockResolvedValue(page());
    renderPage();
    expect(await screen.findByText('No visits with Dr. Patel yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an appointment' })).toBeNull();
  });
});

describe('next visit and past visits', () => {
  const next = visit({
    id: 'ev-next',
    title: 'Follow-up',
    location: 'Heart Center, Suite 300',
    scheduled_date: '2026-11-12',
    scheduled_time: '10:30:00',
    is_upcoming: true,
  });

  it('the Next visit card carries date, time, title and place, and opens the appointment', async () => {
    mockVisits.mockResolvedValue(page({ next_visit: next, upcoming: [next], visits: [visit()] }));
    renderPage();
    const card = await screen.findByTestId('provider-next-visit');
    expect(card).toHaveTextContent(/Nov 12/);
    expect(card).toHaveTextContent(/10:30/);
    expect(card).toHaveTextContent('Follow-up · Heart Center, Suite 300');
    expect(card).toHaveAttribute('href', `/circles/${CIRCLE}/calendar?date=2026-11-12&eventId=ev-next`);
    expect(screen.getByRole('heading', { level: 2, name: 'Next visit' })).toBeInTheDocument();
  });

  it('a VIRTUAL next visit opens through its series root and its own date', async () => {
    const virtual = visit({
      id: 'root-1_2026-11-19',
      series_id: 'root-1',
      is_virtual: true,
      is_upcoming: true,
      scheduled_date: '2026-11-19',
    });
    mockVisits.mockResolvedValue(page({ next_visit: virtual, upcoming: [virtual] }));
    renderPage();
    expect(await screen.findByTestId('provider-next-visit')).toHaveAttribute(
      'href',
      `/circles/${CIRCLE}/calendar?date=2026-11-19&eventId=root-1`
    );
  });

  it('groups past visits by year, newest first, one heading per year', async () => {
    mockVisits.mockResolvedValue(
      page({
        visits: [
          visit({ id: 'a', scheduled_date: '2026-10-02', title: 'Follow-up' }),
          visit({ id: 'b', scheduled_date: '2026-07-18', title: 'Checkup' }),
          visit({ id: 'c', scheduled_date: '2025-12-03', title: 'First visit' }),
        ],
      })
    );
    renderPage();
    await screen.findByText(/Oct 2 · Follow-up/);
    const years = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(years).toEqual(['2026', '2025']);
    const g2026 = screen.getByRole('group', { name: '2026' });
    expect(within(g2026).getAllByTestId('provider-visit')).toHaveLength(2);
    expect(within(screen.getByRole('group', { name: '2025' })).getByText(/Dec 3 · First visit/)).toBeInTheDocument();
    // No running total in the heading (same as mobile).
    expect(screen.getByRole('heading', { level: 2, name: 'Past visits' })).toBeInTheDocument();
  });

  it('shows notes inline with author and date, and a count', async () => {
    mockVisits.mockResolvedValue(
      page({
        visits: [
          visit({
            note_count: 2,
            notes: [
              note('n1', 'BP looks better. Keep lisinopril at 10 mg.', 'Ana'),
              note('n2', 'Wants fasting labs a week before.', 'Luis'),
            ],
          }),
        ],
      })
    );
    renderPage();
    expect(await screen.findByText('BP looks better. Keep lisinopril at 10 mg.')).toBeInTheDocument();
    expect(screen.getByText('Wants fasting labs a week before.')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Luis')).toBeInTheDocument();
    expect(screen.getByText('2 notes')).toBeInTheDocument();
    // The note's day, in the care recipient's zone (20:00Z is still Oct 2 in Chicago).
    expect(screen.getAllByText('Oct 2, 2026').length).toBeGreaterThan(0);
  });

  it('a nameless author reads "Someone", never an empty label', async () => {
    mockVisits.mockResolvedValue(
      page({ visits: [visit({ note_count: 1, notes: [note('n1', 'text', null, { author: null })] })] })
    );
    renderPage();
    expect(await screen.findByText('Someone')).toBeInTheDocument();
  });

  it('a visit with no notes says so and offers "Add a note" into the existing note flow', async () => {
    mockVisits.mockResolvedValue(
      page({ visits: [visit({ id: 'ev-7', scheduled_date: '2026-07-18', title: 'Checkup' })] })
    );
    renderPage();
    expect(await screen.findByText('No notes yet')).toBeInTheDocument();
    const add = screen.getByRole('link', { name: /Add a note to the visit on July 18, 2026/ });
    expect(add).toHaveTextContent('Add a note');
    expect(add).toHaveAttribute(
      'href',
      `/circles/${CIRCLE}/calendar?date=2026-07-18&eventId=ev-7&panel=notes`
    );
  });

  it('a view-only member reads the notes but gets no "Add a note"', async () => {
    circle.canEdit = false;
    mockVisits.mockResolvedValue(page({ visits: [visit()] }));
    renderPage();
    expect(await screen.findByText('No notes yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add a note/ })).toBeNull();
  });
});

describe('Show earlier visits', () => {
  it('pages with before=next_before, appends under the right year, moves focus to the first new visit and ends', async () => {
    mockVisits
      .mockResolvedValueOnce(
        page({
          visits: [visit({ id: 'a', scheduled_date: '2026-10-02', title: 'Follow-up' })],
          page: { limit: 20, has_more: true, next_before: '2026-10-02' },
        })
      )
      .mockResolvedValueOnce(
        page({
          next_visit: null,
          visits: [
            visit({ id: 'b', scheduled_date: '2026-03-01', title: 'Spring check' }),
            visit({ id: 'c', scheduled_date: '2025-12-03', title: 'First visit' }),
          ],
          page: { limit: 20, has_more: false, next_before: null },
        })
      );
    renderPage();
    const more = await screen.findByRole('button', { name: 'Show earlier visits' });

    await userEvent.click(more);
    expect(await screen.findByText(/Dec 3 · First visit/)).toBeInTheDocument();
    expect(mockVisits).toHaveBeenLastCalledWith(CIRCLE, 'p1', { before: '2026-10-02', limit: 20 });
    // 2026 stays ONE group (Oct + Mar), 2025 is new.
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['2026', '2025']);
    expect(within(screen.getByRole('group', { name: '2026' })).getAllByTestId('provider-visit')).toHaveLength(2);
    // History ended: the button is gone.
    expect(screen.queryByRole('button', { name: 'Show earlier visits' })).toBeNull();
    // Focus lands on the first newly loaded visit, not on <body>.
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Mar 1 · Spring check/ })).toHaveFocus()
    );
    expect(screen.getByRole('status', { name: '' })).toBeDefined();
  });

  it('a failed page keeps the button and says so', async () => {
    mockVisits
      .mockResolvedValueOnce(
        page({
          visits: [visit()],
          page: { limit: 20, has_more: true, next_before: '2026-10-02' },
        })
      )
      .mockRejectedValueOnce({ success: false, error: { code: 'SERVER_ERROR' } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Show earlier visits' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load earlier visits");
    expect(screen.getByRole('button', { name: 'Show earlier visits' })).toBeInTheDocument();
  });
});

describe('analytics: provider_visits_opened', () => {
  it('fires once, with the entry source, a bucket of the first page\'s PAST visits and a boolean', async () => {
    const next = visit({ id: 'n', is_upcoming: true, scheduled_date: '2026-11-12' });
    mockVisits.mockResolvedValue(
      page({
        next_visit: next,
        upcoming: [next],
        visits: [visit({ note_count: 1, notes: [note('n1', 'x', 'Ana')] }), visit({ id: 'b' })],
      })
    );
    renderPage({ source: 'appointment' });
    await screen.findByTestId('provider-next-visit');
    await waitFor(() => expect(Analytics.providerVisitsOpened).toHaveBeenCalledTimes(1));
    // Two PAST visits (the upcoming one is not counted): bucket 1-5. No raw count.
    expect(Analytics.providerVisitsOpened).toHaveBeenCalledWith({
      source: 'appointment',
      visit_count_bucket: '1-5',
      has_notes: true,
    });
  });

  it.each([
    [0, '0'],
    [6, '6-20'],
    [21, '21+'],
  ])('%i past visits on the first page -> bucket %s', async (n, bucket) => {
    mockVisits.mockResolvedValue(
      page({ visits: Array.from({ length: n }, (_, i) => visit({ id: `v${i}` })), next_visit: n === 0 ? visit({ is_upcoming: true }) : null })
    );
    renderPage();
    await waitFor(() => expect(Analytics.providerVisitsOpened).toHaveBeenCalledTimes(1));
    expect(Analytics.providerVisitsOpened).toHaveBeenCalledWith(
      expect.objectContaining({ visit_count_bucket: bucket, has_notes: false })
    );
  });

  it('defaults to medical_info when the page is opened directly', async () => {
    mockVisits.mockResolvedValue(page({ visits: [visit()] }));
    renderPage();
    await screen.findByText(/Oct 2 · Follow-up/);
    expect(Analytics.providerVisitsOpened).toHaveBeenCalledWith({
      source: 'medical_info',
      visit_count_bucket: '1-5',
      has_notes: false,
    });
  });

  it('is not fired for a doctor that failed to load', async () => {
    mockVisits.mockRejectedValue({ success: false, error: { code: 'NOT_FOUND' } });
    renderPage();
    await screen.findByText("This doctor isn't available.");
    expect(Analytics.providerVisitsOpened).not.toHaveBeenCalled();
  });
});
