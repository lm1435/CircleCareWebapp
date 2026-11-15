// Shared harness for the dose-flow suites that run on the LIVE Today list: the real `NextUp` fed by the real
// `useNextUp` (-> useTodaysMeds / useMedsForDate / useCalendarEvents / useTasks), the real `useMedicationUndo`
// and `useConfirmMedication`, with only the HTTP client (`apiClient`, mocked globally in src/test/setup.ts)
// faked by a tiny stateful backend. Re-homed from the dead TodaysMeds-hosted suites (simplification audit
// 2026-11-15, section 2.2). Everything is pinned to fixed instants, so nothing depends on the runner's zone.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { NextUp } from '@/components/overview/NextUp';
import { useNextUp } from '@/hooks/useNextUp';
import { MEDICATION_UNDO_DELAY_MS } from '@/components/meds/useMedicationUndo';
import type { Circle } from '@/api/circles';
import type { TodaysMedication } from '@/api/medicationConfirmations';

export const mockedGet = apiClient.get as unknown as Mock;
export const mockedPost = apiClient.post as unknown as Mock;

export const CIRCLE_ID = 'circle-1';
export const TZ = 'America/New_York';
// 12:00 PM ET on 2026-06-12. The dose below (10:00) is past due and answerable.
export const NOW = new Date('2026-06-12T16:00:00Z');
export const TODAY = '2026-06-12';
export const PRESENCE_URL = `/circles/${CIRCLE_ID}/events/presence`;
export const CONFIRM_URL = `/circles/${CIRCLE_ID}/medications/confirm`;

export const GENERIC_ERROR = "Couldn't save. Please try again.";
export const SUCCESS_TAKEN = 'Marked as taken';

export const circle: Circle = {
  id: CIRCLE_ID,
  name: 'Mom',
  recipient_name: 'Mom',
  recipient_photo_url: null,
  role: 'member',
  is_care_recipient: false,
  member_count: 3,
  created_at: '2026-01-01T00:00:00Z',
  access_level: 'edit',
  is_premium_circle: true,
  can_edit: true,
  view_only: false,
  read_only: false,
};

export const BASE_DOSE: TodaysMedication = {
  id: 'med-atorva',
  event_type: 'medication',
  title: 'Atorvastatin',
  medication_name: 'Atorvastatin',
  medication_dosage: null,
  scheduled_date: TODAY,
  scheduled_time: '10:00:00',
  confirmation: null,
} as TodaysMedication;

/** Error shapes the web api client rejects with (lib/api.ts: `error.response?.data || error`). */
export const SERVER_ERROR_ENVELOPE = {
  success: false,
  error: { code: 'SERVER_ERROR', message: 'Internal server error' },
};
export function axiosTimeout(): Error {
  return Object.assign(new Error('timeout of 15000ms exceeded'), {
    code: 'ECONNABORTED',
    isAxiosError: true,
  });
}

/**
 * The fake backend. `recorded` is the server's truth for the one dose. `writeLands` decides whether the
 * POST writes before it fails; `failWith` is what the client sees instead of the 201. `todayReads` counts
 * reads of the dose's single day (start_date = end_date = today, event_type medication).
 */
export interface FakeServer {
  recorded: TodaysMedication['confirmation'];
  todayReads: number;
}

export function installBackend(opts: { writeLands: boolean; failWith: unknown }): FakeServer {
  const server: FakeServer = { recorded: null, todayReads: 0 };
  mockedGet.mockImplementation(
    (url: string, config?: { params?: { start_date?: string; end_date?: string } }) => {
      if (url === '/circles') return Promise.resolve({ success: true, data: { circles: [circle] } });
      if (url === `/circles/${CIRCLE_ID}`) {
        return Promise.resolve({
          success: true,
          data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
        });
      }
      if (url === PRESENCE_URL) {
        return Promise.resolve({
          success: true,
          data: { medication: true, appointment: false, task: false },
        });
      }
      if (url === `/circles/${CIRCLE_ID}/events`) {
        const p = config?.params;
        if (p?.start_date === TODAY && p?.end_date === TODAY) {
          server.todayReads += 1;
          return Promise.resolve({
            success: true,
            data: { events: [{ ...BASE_DOSE, confirmation: server.recorded }] },
          });
        }
        return Promise.resolve({ success: true, data: { events: [] } });
      }
      // Any other read (tasks, summaries, adherence): empty and harmless.
      return Promise.resolve({ success: true, data: { tasks: [], total: 0 } });
    }
  );
  mockedPost.mockImplementation((url: string, body: { status: 'taken' | 'skipped' }) => {
    if (url !== CONFIRM_URL) return Promise.reject(new Error(`unexpected POST ${url}`));
    if (opts.writeLands) {
      server.recorded = {
        status: body.status,
        confirmed_at: NOW.toISOString(),
        confirmed_by: 'u1',
      } as TodaysMedication['confirmation'];
    }
    return Promise.reject(opts.failWith);
  });
  return server;
}

export function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** The live Today card: `NextUp` over `useNextUp`, exactly how OverviewPage wires them. */
function TodayHost(): React.ReactElement {
  const next = useNextUp(CIRCLE_ID, TZ);
  return (
    <NextUp
      circleId={CIRCLE_ID}
      timezone={TZ}
      recipientName="Mom"
      isSelfCare={false}
      canEdit
      items={next.items}
      loading={!next.settled}
      error={next.isError}
      onRetry={next.refetch}
      stacked={false}
    />
  );
}

/** The Taken button of the one dose row. */
export function takeButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Taken, Atorvastatin|^Tomado, Atorvastatin/ });
}

/** Answer the dose on the live Today card and run the 5-second undo window out. */
export async function takeViaNextUp(): Promise<void> {
  render(
    <MemoryRouter>
      <QueryClientProvider client={newQueryClient()}>
        <ToastProvider>
          <TodayHost />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  await screen.findByText('Atorvastatin');
  const take = takeButton();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
  fireEvent.click(take);
  await act(async () => {
    vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
  });
  // Let the POST, the re-reads and react-query's own scheduled notifications run on the fake clock before
  // it is swapped back (a notification queued on a discarded fake timer would never reach the screen).
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
}

export { within };
