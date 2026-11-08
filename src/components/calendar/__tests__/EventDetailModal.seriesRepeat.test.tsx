import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { queryKeys } from '@/lib/queryKeys';
import { EventDetailModal } from '../EventDetailModal';

// REPEAT BUG (design pass 2026-11-08). A MATERIALIZED CHILD — one physical row per day, made by
// the hourly materializer or by confirming a dose — stores `recurrence_rule = NULL`; the rule
// lives on the series ROOT only. The detail read the row's own rule, so a daily medication's dose
// (or a daily task's occurrence) showed no "Repeats" at all, as if it were a one-off. The fix
// resolves the root's rule (calendar cache first, else the existing single-event GET).

const { getSeriesRootMock } = vi.hoisted(() => ({ getSeriesRootMock: vi.fn() }));
vi.mock('@/api/calendarEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/calendarEvents')>();
  return { ...actual, getSeriesRoot: (...args: unknown[]) => getSeriesRootMock(...args) };
});
vi.mock('../EventNotesPanel', () => ({ EventNotesPanel: () => <h3>Notes</h3> }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const TZ = 'America/Chicago';

function child(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'child-1',
    circle_id: 'circle-1',
    event_type: 'medication',
    title: 'Metformin',
    medication_name: 'Metformin',
    medication_dosage: '500mg',
    scheduled_date: '2026-06-12',
    scheduled_time: '08:00:00',
    parent_event_id: 'root-1',
    recurrence_rule: null,
    recurrence_days: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  } as CalendarEvent;
}

function renderWith(client: QueryClient, event: CalendarEvent): void {
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <EventDetailModal event={event} careRecipientTimezone={TZ} onClose={vi.fn()} />
    </QueryClientProvider>
  );
  render(ui);
}

function newClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  getSeriesRootMock.mockReset();
});

describe('EventDetailModal — Repeats on a materialized occurrence', () => {
  it('a daily medication dose (child row, rule NULL) shows the series root rule from the cache', async () => {
    const client = newClient();
    client.setQueryData([...queryKeys.calendarEvents('circle-1'), 'range-a'], [
      child({ id: 'root-1', parent_event_id: null, recurrence_rule: 'daily', scheduled_date: '2026-06-01' }),
    ]);
    renderWith(client, child());

    expect(await screen.findByText('Repeats')).toBeInTheDocument();
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(getSeriesRootMock).not.toHaveBeenCalled();
  });

  it('a daily task occurrence whose root is not cached fetches the root once and shows its rule', async () => {
    getSeriesRootMock.mockResolvedValue({
      id: 'root-1',
      scheduled_date: '2026-06-01',
      recurrence_rule: 'weekly',
      recurrence_days: [1, 3],
    });
    renderWith(
      newClient(),
      child({ event_type: 'task', title: 'Walk', medication_name: null, medication_dosage: null })
    );

    expect(await screen.findByText('Weekly on Mon, Wed')).toBeInTheDocument();
    expect(screen.getByText('Repeats')).toBeInTheDocument();
    expect(getSeriesRootMock).toHaveBeenCalledWith('circle-1', 'root-1');
  });

  it('a virtual weekly instance (rule but no days) gets the root day names', async () => {
    getSeriesRootMock.mockResolvedValue({
      id: 'root-1',
      scheduled_date: '2026-06-01',
      recurrence_rule: 'weekly',
      recurrence_days: [0, 5],
    });
    renderWith(
      newClient(),
      child({ id: 'root-1_2026-06-12', is_virtual: true, recurrence_rule: 'weekly' })
    );
    expect(await screen.findByText('Weekly on Sun, Fri')).toBeInTheDocument();
  });

  it('a one-off event does not fetch anything and shows no Repeats', () => {
    // No QueryClientProvider needed: the resolver is never mounted for a non-occurrence.
    render(
      <EventDetailModal
        event={child({ parent_event_id: null })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText('Repeats')).toBeNull();
    expect(getSeriesRootMock).not.toHaveBeenCalled();
  });
});
