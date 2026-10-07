import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';
import { apiClient } from '@/lib/api';
import { getEvents } from '@/api/calendarEvents';
import { useCalendarEvents, useMedicationRoster } from '@/hooks/useCalendarEvents';

// docs/plans/meds-roster-ended-series.md: `includeInactiveRoots=true` asks the
// backend for the series ROOTS of discontinued/ended meds with no row in the
// window. ONLY the Medications roster may send it — any other surface would
// suddenly receive stopped medications it never asked for. `apiClient.get` is
// globally mocked in src/test/setup.ts.

const get = apiClient.get as unknown as Mock;
const CIRCLE = 'circle-1';
const EVENTS_URL = `/circles/${CIRCLE}/events`;

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

const eventsCalls = () => get.mock.calls.filter(([url]) => url === EVENTS_URL);

beforeEach(() => {
  get.mockReset();
  get.mockResolvedValue({ success: true, data: { events: [] } });
});

describe('includeInactiveRoots — roster request only', () => {
  it('the medication roster sends includeDiscontinued AND includeInactiveRoots as the literal "true"', async () => {
    renderHook(() => useMedicationRoster(CIRCLE), { wrapper });
    await waitFor(() => expect(eventsCalls()).toHaveLength(1));

    expect(eventsCalls()[0][1]).toEqual({
      // `includeAsNeeded`: the roster is where as-needed (PRN) medications live.
      params: {
        includeDiscontinued: 'true',
        includeInactiveRoots: 'true',
        includeAsNeeded: 'true',
      },
    });
  });

  it('a windowed calendar fetch does not send it', async () => {
    renderHook(() => useCalendarEvents(CIRCLE, '2026-09-01', '2026-09-07'), { wrapper });
    await waitFor(() => expect(eventsCalls()).toHaveLength(1));

    expect(eventsCalls()[0][1]).toEqual({
      params: { start_date: '2026-09-01', end_date: '2026-09-07' },
    });
  });

  it('getEvents never sends it unless asked — not even alongside includeDiscontinued', async () => {
    await getEvents(CIRCLE, { includeDiscontinued: true });
    await getEvents(CIRCLE, { start_date: '2026-09-01', end_date: '2026-09-30', event_type: 'medication' });
    await getEvents(CIRCLE);

    for (const [, config] of eventsCalls()) {
      expect(config?.params ?? {}).not.toHaveProperty('includeInactiveRoots');
    }
    expect(eventsCalls()).toHaveLength(3);
  });
});
