import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import type { ProviderVisit } from '@/api/providers';
import type { CalendarEvent } from '@/api/calendarEvents';
import { VisitCard } from '../VisitCard';
import { EventDetailModal } from '@/components/calendar/EventDetailModal';

/**
 * CALLERS PASS THE EVENT'S DAY, so a viewer a day ahead of the recipient sees
 * which day their half is on (owner report, TestFlight 1.4.0 (8)): phone in
 * Auckland, recipient in Denver, Mon Nov 2 9:00 AM Denver = Tue Nov 3 5:00 AM
 * Auckland. The formatter only marks a day when handed a `YYYY-MM-DD`; a caller
 * still passing a bare instant would compile and silently drop the day.
 *
 * Also pins the visit-card layout: the date/time line, then the title on its
 * own line, so a long dual time never squeezes the title.
 */
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/components/calendar/EventNotesPanel', () => ({ EventNotesPanel: () => null }));

let viewerZone = 'Pacific/Auckland';
const realResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
  this: Intl.DateTimeFormat
) {
  return { ...realResolved.call(this), timeZone: viewerZone };
});
afterEach(() => {
  viewerZone = 'Pacific/Auckland';
});

const visit = (over: Partial<ProviderVisit> = {}): ProviderVisit =>
  ({
    id: 'ev-1',
    series_id: null,
    parent_event_id: null,
    title: 'Follow-up: Doctor visit',
    location: 'Heart Center',
    scheduled_date: '2026-11-02',
    scheduled_time: '09:00:00',
    duration_minutes: null,
    recurrence_rule: null,
    completed_at: null,
    is_virtual: false,
    is_upcoming: true,
    note_count: 0,
    notes: [],
    ...over,
  }) as unknown as ProviderVisit;

const renderCard = (v: ProviderVisit, upcoming = true) =>
  render(
    <MemoryRouter initialEntries={['/circles/c1/providers/p1']}>
      <Routes>
        <Route
          path="/circles/:circleId/providers/:providerId"
          element={
            <ul>
              <VisitCard circleId="c1" visit={v} timezone="America/Denver" canEdit upcoming={upcoming} />
            </ul>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe('Doctor visits card (VisitCard)', () => {
  it("names the viewer's day, and puts the title on its own line", () => {
    renderCard(visit());
    const card = screen.getByTestId('provider-visit');
    expect(within(card).getByTestId('provider-visit-when')).toHaveTextContent(
      /^Mon, Nov 2 · 9:00 AM \(Denver\) \/ Tue 5:00 AM \(Auckland\)$/
    );
    expect(within(card).getByTestId('provider-visit-title')).toHaveTextContent(
      /^Follow-up: Doctor visit$/
    );
    // Order: when, title (both in the heading link), then place, then the note count.
    const text = card.textContent ?? '';
    expect(text.indexOf('Tue 5:00 AM')).toBeLessThan(text.indexOf('Follow-up: Doctor visit'));
    expect(text.indexOf('Follow-up: Doctor visit')).toBeLessThan(text.indexOf('Heart Center'));
    expect(text.indexOf('Heart Center')).toBeLessThan(text.indexOf('No notes yet'));
  });

  it('same calendar day: no marker', () => {
    viewerZone = 'America/New_York';
    renderCard(visit());
    expect(screen.getByTestId('provider-visit-when')).toHaveTextContent(
      /^Mon, Nov 2 · 9:00 AM \(Denver\) \/ 11:00 AM \(New York\)$/
    );
  });

  it('a past visit: date line then title', () => {
    renderCard(visit({ scheduled_date: '2026-10-02', is_upcoming: false, title: 'Checkup' }), false);
    expect(screen.getByTestId('provider-visit-when')).toHaveTextContent(/^Oct 2$/);
    expect(screen.getByTestId('provider-visit-title')).toHaveTextContent(/^Checkup$/);
    expect(screen.getByRole('link', { name: 'Oct 2 Checkup' })).toBeInTheDocument();
  });
});

describe('Event detail (EventDetailModal)', () => {
  it("names the viewer's day from the event's scheduled_date", () => {
    const event = {
      id: 'ev-1',
      circle_id: 'c1',
      event_type: 'appointment',
      title: 'Doctor visit',
      scheduled_date: '2026-11-02',
      scheduled_time: '09:00:00',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    } as CalendarEvent;
    render(<EventDetailModal event={event} careRecipientTimezone="America/Denver" onClose={vi.fn()} />);
    expect(screen.getByText('9:00 AM (Denver) / Tue 5:00 AM (Auckland)')).toBeInTheDocument();
  });
});
