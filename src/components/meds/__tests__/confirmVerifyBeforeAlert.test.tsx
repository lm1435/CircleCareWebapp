// Test-gap audit 2026-09-29, item #3 — web has NO verify-before-alert after an
// ambiguous dose-confirm failure.
//
// THE SCENARIO (production, mobile, 2026-09-11; memory
// project_confirm_timeout_ios_suspension): the POST reaches the server and the
// dose IS recorded, but the RESPONSE is lost — a timeout, a dropped connection,
// or a 5xx from the edge after the handler wrote. All three prod alerts of that
// shape were FALSE: every dose had been recorded.
//
// MOBILE (useMedicationUndo.ts `isAmbiguousConfirmFailure` →
// `verifyConfirmLanded` → `confirmVerdict`): an ambiguous rejection re-reads
// the dose's day (GET /events for that date) and
//   - 'recorded'     → the SUCCESS path (no alert),
//   - 'not_recorded' → "<med> wasn't recorded. Please mark it again.",
//   - 'unverified'   → "Couldn't check" copy (never a claimed failure).
//
// WEB (this file drives the REAL hooks — TodaysMeds → useMedicationUndo →
// useConfirmMedication, and ConfirmMedDialog → useConfirmMedication — with only
// the HTTP client mocked by a tiny stateful fake backend).
//
// FIXED 2026-09-29: the defect this file pinned — every non-permission,
// non-409 rejection went straight to "Couldn't save. Please try again.", with
// the day refetched only AFTERWARDS, so the screen said both "Couldn't save"
// AND "Taken" for one dose — is gone. `useConfirmMedication`'s mutationFn now
// verifies an AMBIGUOUS rejection against the day before anything is reported
// (webapp/src/lib/confirmVerify.ts, a port of mobile's). The former
// "CURRENT BEHAVIOUR" tests asserted the bug and were replaced by the fixed
// behaviour; the `it.fails` pins now pass as plain `it`. A CONTROL still proves
// the generic error IS right when the write did not land, and a new case pins
// the "couldn't check" copy when the re-read itself fails.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { TodaysMeds } from '@/components/meds/TodaysMeds';
import { ConfirmMedDialog } from '@/components/meds/ConfirmMedDialog';
import { MEDICATION_UNDO_DELAY_MS } from '@/components/meds/useMedicationUndo';
import type { Circle } from '@/api/circles';
import type { TodaysMedication } from '@/api/medicationConfirmations';

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const mockedGet = apiClient.get as unknown as Mock;
const mockedPost = apiClient.post as unknown as Mock;

const CIRCLE_ID = 'circle-1';
const TZ = 'America/New_York';
// 12:00 PM ET on 2026-06-12. The dose below (10:00) is past due and answerable.
const NOW = new Date('2026-06-12T16:00:00Z');
const TODAY = '2026-06-12';
const PRESENCE_URL = `/circles/${CIRCLE_ID}/events/presence`;
const CONFIRM_URL = `/circles/${CIRCLE_ID}/medications/confirm`;

const GENERIC_ERROR = "Couldn't save. Please try again.";
const SUCCESS_TAKEN = 'Marked as taken';

/** Error shapes the web api client rejects with (lib/api.ts: `error.response?.data || error`). */
const SERVER_ERROR_ENVELOPE = {
  success: false,
  error: { code: 'SERVER_ERROR', message: 'Internal server error' },
};
function axiosTimeout(): Error {
  return Object.assign(new Error('timeout of 15000ms exceeded'), {
    code: 'ECONNABORTED',
    isAxiosError: true,
  });
}

const circle: Circle = {
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

const BASE_DOSE: TodaysMedication = {
  id: 'med-atorva',
  event_type: 'medication',
  title: 'Atorvastatin',
  medication_name: 'Atorvastatin',
  medication_dosage: null,
  scheduled_date: TODAY,
  scheduled_time: '10:00:00',
  confirmation: null,
} as TodaysMedication;

/**
 * The fake backend. `recorded` is the server's truth for the one dose.
 * `writeLands` decides whether the POST writes before it fails; `failWith` is
 * what the client sees instead of the 201.
 */
interface FakeServer {
  recorded: TodaysMedication['confirmation'];
  todayReads: number;
}

function installBackend(opts: { writeLands: boolean; failWith: unknown }): FakeServer {
  const server: FakeServer = { recorded: null, todayReads: 0 };
  mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
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
      const start = config?.params?.start_date;
      if (start === TODAY) {
        server.todayReads += 1;
        return Promise.resolve({
          success: true,
          data: { events: [{ ...BASE_DOSE, confirmation: server.recorded }] },
        });
      }
      return Promise.resolve({ success: true, data: { events: [] } });
    }
    // Any other read (confirmations, summaries, adherence) — empty and harmless.
    return Promise.resolve({ success: true, data: {} });
  });
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

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function doseRow(): HTMLElement {
  const row = screen.getByText('Atorvastatin').closest('li');
  if (!row) throw new Error('Atorvastatin row not found');
  return row;
}

/** Answer the dose in TodaysMeds and run the 5-second undo window out. */
async function takeViaTodaysMeds(): Promise<void> {
  render(
    <MemoryRouter>
      <QueryClientProvider client={newQueryClient()}>
        <ToastProvider>
          <TodaysMeds circleId={CIRCLE_ID} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  await screen.findByText('Atorvastatin');
  const take = within(doseRow()).getAllByRole('button', { name: 'Confirm Atorvastatin' })[0];
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
  fireEvent.click(take);
  await act(async () => {
    vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
  });
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  mockUseHourCycle.mockReturnValue('12h');
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: TZ,
  } as Intl.ResolvedDateTimeFormatOptions);
  mockedGet.mockReset();
  mockedPost.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TodaysMeds (undo flow) — ambiguous confirm failure after the write landed', () => {
  it.each([
    ['a 500 after the write', () => SERVER_ERROR_ENVELOPE],
    ['a timeout after the write', axiosTimeout],
  ])(
    '%s: re-reads the day BEFORE any verdict and reports SUCCESS, never "Couldn\'t save" (mobile parity)',
    async (_label, failWith) => {
      const server = installBackend({ writeLands: true, failWith: failWith() });
      const readsBefore = () => server.todayReads;
      await takeViaTodaysMeds();

      expect(await screen.findByText(SUCCESS_TAKEN)).toBeInTheDocument();
      expect(screen.queryByText(GENERIC_ERROR)).not.toBeInTheDocument();
      expect(readsBefore()).toBeGreaterThan(0);
      await waitFor(() => expect(within(doseRow()).getByText('Taken')).toBeInTheDocument());
      expect(screen.queryByText(GENERIC_ERROR)).not.toBeInTheDocument();
    }
  );

  it('CONTROL: a failure where the write did NOT land still shows the error (right on both platforms)', async () => {
    const server = installBackend({ writeLands: false, failWith: SERVER_ERROR_ENVELOPE });
    await takeViaTodaysMeds();

    expect(server.recorded).toBeNull();
    expect(await screen.findByText(GENERIC_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(SUCCESS_TAKEN)).not.toBeInTheDocument();
  });

  it('the re-read ITSELF fails: "couldn\'t check" (mobile\'s copy), never "Couldn\'t save" and never success', async () => {
    installBackend({ writeLands: true, failWith: axiosTimeout() });
    // After the (lost) POST, every read of the day fails too.
    const baseGet = mockedGet.getMockImplementation()!;
    let postSeen = false;
    mockedPost.mockImplementationOnce(() => {
      postSeen = true;
      return Promise.reject(axiosTimeout());
    });
    mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
      if (postSeen && url === `/circles/${CIRCLE_ID}/events`) return Promise.reject(axiosTimeout());
      return baseGet(url, config);
    });
    await takeViaTodaysMeds();

    expect(
      await screen.findByText(
        "We couldn't check whether Atorvastatin was recorded. Check the calendar once you're back online."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(GENERIC_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(SUCCESS_TAKEN)).not.toBeInTheDocument();
  });
});

describe('ConfirmMedDialog (calendar "Mark taken") — ambiguous failure after the write landed', () => {
  function renderDialog(onClose = vi.fn()) {
    render(
      <QueryClientProvider client={newQueryClient()}>
        <ToastProvider>
          <ConfirmMedDialog
            source="calendar"
            circleId={CIRCLE_ID}
            med={BASE_DOSE}
            careRecipientTimezone={TZ}
            onClose={onClose}
          />
        </ToastProvider>
      </QueryClientProvider>
    );
    return onClose;
  }

  it('CONTROL: a 500 where the write did NOT land keeps the dialog open with "Couldn\'t save" (after a re-read)', async () => {
    const server = installBackend({ writeLands: false, failWith: SERVER_ERROR_ENVELOPE });
    const user = userEvent.setup();
    const onClose = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_ERROR);
    expect(server.recorded).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(server.todayReads).toBe(1);
  });

  // FIXED 2026-09-29 (was PINNED DEFECT, audit #3).
  it(
    'a 500 after the write re-reads, closes with the success toast, and shows no error (mobile parity)',
    async () => {
      installBackend({ writeLands: true, failWith: SERVER_ERROR_ENVELOPE });
      const user = userEvent.setup();
      const onClose = renderDialog();

      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText(SUCCESS_TAKEN)).toBeInTheDocument();
      expect(onClose).toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }
  );
});
