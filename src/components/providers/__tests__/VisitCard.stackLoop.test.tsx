import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { ProviderVisit } from '@/api/providers';
import { VisitCard } from '../VisitCard';

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

// Stack-loop guard: appointment -> doctor's visits -> that visit -> ... goes BACK to the appointment.

const visit: ProviderVisit = {
  id: 'ev-1',
  series_id: null,
  parent_event_id: null,
  title: 'Checkup',
  location: null,
  scheduled_date: '2026-06-12',
  scheduled_time: '09:00:00',
  duration_minutes: null,
  recurrence_rule: null,
  completed_at: null,
  is_virtual: false,
  is_upcoming: false,
  note_count: 0,
  notes: [],
} as unknown as ProviderVisit;

function Where() {
  const loc = useLocation();
  const type = useNavigationType();
  return <div data-testid="where">{loc.pathname}{loc.search}|{type}</div>;
}

function renderAt(state: unknown, v: ProviderVisit = visit) {
  return render(
    <MemoryRouter
      initialEntries={[
        '/circles/c1/calendar',
        { pathname: '/circles/c1/providers/p1', state },
      ]}
      initialIndex={1}
    >
      <Where />
      <Routes>
        <Route
          path="/circles/:circleId/providers/:providerId"
          element={<ul><VisitCard circleId="c1" visit={v} timezone={null} canEdit /></ul>}
        />
        <Route path="/circles/:circleId/calendar" element={<h1>calendar</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('VisitCard: stack loop', () => {
  it('opening the visit the page was reached from goes Back (POP to the existing entry)', async () => {
    renderAt({ source: 'appointment', fromEvent: { id: 'ev-1', date: '2026-06-12' } });
    await userEvent.click(screen.getByRole('link', { name: /Checkup/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('/circles/c1/calendar|POP');
  });

  it('a different visit still pushes the calendar deep link', async () => {
    renderAt({ source: 'appointment', fromEvent: { id: 'other', date: '2026-06-12' } });
    await userEvent.click(screen.getByRole('link', { name: /Checkup/ }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/circles/c1/calendar?date=2026-06-12&eventId=ev-1|PUSH'
    );
  });

  it('a page opened from Medical Info (no fromEvent) pushes as before', async () => {
    renderAt({ source: 'medical_info' });
    await userEvent.click(screen.getByRole('link', { name: /Checkup/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('|PUSH');
  });
});
