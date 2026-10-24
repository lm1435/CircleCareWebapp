import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { Provider } from '@/api/providers';
import { EventDetailModal } from '../EventDetailModal';

// The appointment view's second entry point (docs/plans/notes-by-doctor.md flow
// 2b): "Dr. Patel · See all visits", and "(removed)" for a removed doctor.

vi.mock('../EventNotesPanel', () => ({ EventNotesPanel: () => <h3>Notes</h3> }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

let providersMock: Provider[] = [];
const useProvidersSpy = vi.fn();
vi.mock('@/hooks/useProviders', () => ({
  useProviders: (...args: unknown[]) => {
    useProvidersSpy(...args);
    return { providers: providersMock };
  },
}));

vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/New_York',
} as Intl.ResolvedDateTimeFormatOptions);

const PATEL_ID = '11111111-1111-4111-8111-111111111111';

function doctor(over: Partial<Provider>): Provider {
  return {
    id: PATEL_ID,
    name: 'Dr. Patel',
    specialty: null,
    phone: null,
    country_code: null,
    phone_extension: null,
    address: null,
    is_primary: false,
    sort_order: 0,
    archived_at: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function appt(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    circle_id: 'circle-1',
    event_type: 'appointment',
    title: 'Checkup',
    scheduled_date: '2026-06-12',
    scheduled_time: '09:00:00',
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function Probe() {
  const { pathname, state } = useLocation();
  return (
    <div data-testid="probe">
      {pathname}|{(state as { source?: string } | null)?.source}
    </div>
  );
}

function renderModal(event: CalendarEvent) {
  return render(
    <MemoryRouter initialEntries={['/circles/circle-1/calendar']}>
      <Routes>
        <Route
          path="/circles/:circleId/calendar"
          element={
            <EventDetailModal event={event} careRecipientTimezone="America/Chicago" onClose={vi.fn()} />
          }
        />
        <Route path="/circles/:circleId/providers/:providerId" element={<Probe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  providersMock = [doctor({})];
});

describe('EventDetailModal: the appointment doctor link', () => {
  it('shows "Dr. Patel · See all visits" under a Doctor label, and opens that doctor\'s visits from the appointment', async () => {
    renderModal(appt({ provider_id: PATEL_ID }));
    const row = screen.getByText('Doctor').closest('div') as HTMLElement;
    const link = within(row).getByRole('link', { name: 'Dr. Patel · See all visits' });
    expect(link).toHaveAttribute('href', `/circles/circle-1/providers/${PATEL_ID}`);
    await userEvent.click(link);
    // The entry point travels with the navigation (analytics `source: appointment`).
    expect(await screen.findByTestId('probe')).toHaveTextContent(
      `/circles/circle-1/providers/${PATEL_ID}|appointment`
    );
  });

  it('resolves the name WITH removed doctors included, and says "(removed)"', () => {
    providersMock = [doctor({ archived_at: '2026-10-01T00:00:00Z' })];
    renderModal(appt({ provider_id: PATEL_ID }));
    expect(screen.getByRole('link', { name: 'Dr. Patel (removed) · See all visits' })).toBeInTheDocument();
    expect(useProvidersSpy).toHaveBeenCalledWith('circle-1', { includeArchived: true });
  });

  it('while the name is unknown, the link stands alone as "See all visits"', () => {
    providersMock = [];
    renderModal(appt({ provider_id: PATEL_ID }));
    expect(screen.getByRole('link', { name: 'See all visits' })).toHaveAttribute(
      'href',
      `/circles/circle-1/providers/${PATEL_ID}`
    );
  });

  it('an appointment with no doctor shows no Doctor row and asks for no doctors', () => {
    renderModal(appt());
    expect(screen.queryByText('Doctor')).toBeNull();
    expect(screen.queryByRole('link', { name: /See all visits/ })).toBeNull();
    expect(useProvidersSpy).not.toHaveBeenCalled();
  });

  it('only appointments carry the row', () => {
    renderModal(appt({ event_type: 'task', provider_id: PATEL_ID }));
    expect(screen.queryByRole('link', { name: /See all visits/ })).toBeNull();
  });
});
