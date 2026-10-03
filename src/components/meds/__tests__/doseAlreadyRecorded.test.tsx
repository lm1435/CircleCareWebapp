// PK1 (decided 2026-09-29): another caregiver already answered this dose, and
// the backend refuses to overwrite them — 409 DOSE_ALREADY_RECORDED with
// { status, recorded_by_name, recorded_at, timezone }. On web the caregiver
// must see a calm "Already marked taken by Ana at 8:02 AM." (EN) /
// "Ya marcado como tomado a las 8:02 a. m. por Ana." (ES) — the time in the
// CARE RECIPIENT's zone on the viewer's clock — never "Couldn't save"; the day
// must be refetched so the row shows the real answer; and the undo badge must
// be gone. Drives the REAL TodaysMeds → useMedicationUndo → useConfirmMedication
// and ConfirmMedDialog with only the HTTP client faked (harness copied from
// confirmVerifyBeforeAlert.test.tsx).

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import i18n from '@/i18n';
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
  const take = within(doseRow()).getAllByRole('button', { name: /^(Confirm|Confirmar) Atorvastatin$/ })[0];
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


/** The 409 body the fake backend answers with. Ana took it at 8:02 AM ET. */
function conflict(details: Record<string, unknown> = {}) {
  return {
    success: false,
    error: {
      code: 'DOSE_ALREADY_RECORDED',
      message: 'Already marked taken by Ana at 8:02 AM.',
      details: {
        status: 'taken',
        recorded_by_name: 'Ana',
        // 12:02Z = 8:02 AM EDT.
        recorded_at: '2026-06-12T12:02:00.000Z',
        timezone: TZ,
        ...details,
      },
    },
  };
}

/**
 * THE STALE PAGE: it loaded before Ana answered, so the dose still offers
 * Take/Skip. By the time this caregiver's POST arrives, Ana's answer is what
 * the server holds — the POST is refused and every later read shows hers.
 */
function installConflict(details: Record<string, unknown> = {}) {
  const server = installBackend({ writeLands: false, failWith: conflict(details) }) as FakeServer & {
    readsAtPost: number;
  };
  server.readsAtPost = -1;
  mockedPost.mockImplementation(() => {
    server.readsAtPost = server.todayReads;
    server.recorded = {
      status: (details.status as 'taken' | 'skipped') ?? 'taken',
      confirmed_at: '2026-06-12T12:02:00.000Z',
      confirmed_by: 'ana',
    } as TodaysMedication['confirmation'];
    return Promise.reject(conflict(details));
  });
  return server;
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('TodaysMeds — a stale Take on a dose another caregiver already answered', () => {
  it('EN: the calm who-and-when toast, never "Couldn\'t save"; the row refetched to Taken; the undo badge gone', async () => {
    const server = installConflict();
    await takeViaTodaysMeds();
    expect(server.recorded?.confirmed_by).toBe('ana');

    const toast = await screen.findByText('Already marked taken by Ana at 8:02 AM.');
    expect(toast.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(GENERIC_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(/fail|couldn/i)).not.toBeInTheDocument();
    // The day was re-read after the refusal, and the row shows Ana's answer …
    await waitFor(() => expect(server.todayReads).toBeGreaterThan(server.readsAtPost));
    await waitFor(() => expect(within(doseRow()).getByText('Taken')).toBeInTheDocument());
    // … and the undo badge (its Undo button) is gone.
    expect(within(doseRow()).queryByRole('button', { name: /undo/i })).toBeNull();
    // Exactly one POST: nothing retried.
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('ES, 12h: "Ya marcado como omitido a las 8:02 a. m. por Ana."', async () => {
    await i18n.changeLanguage('es');
    installConflict({ status: 'skipped' });
    await takeViaTodaysMeds();
    expect(
      await screen.findByText('Ya marcado como omitido a las 8:02 a. m. por Ana.')
    ).toBeInTheDocument();
  });

  it('far zone (Pacific/Kiritimati, UTC+14) on a 24h clock, no name: "…by another caregiver at 02:02."', async () => {
    mockUseHourCycle.mockReturnValue('24h');
    installConflict({ recorded_by_name: null, timezone: 'Pacific/Kiritimati' });
    await takeViaTodaysMeds();
    // 12:02Z = 02:02 next day in Kiritimati.
    expect(
      await screen.findByText('Already marked taken by another caregiver at 02:02.')
    ).toBeInTheDocument();
  });
});

describe('ConfirmMedDialog — a Save on a dose another caregiver already answered', () => {
  function renderDialog(onClose = vi.fn()) {
    render(
      <QueryClientProvider client={newQueryClient()}>
        <ToastProvider>
          <ConfirmMedDialog
            source="calendar"
            circleId={CIRCLE_ID}
            med={BASE_DOSE}
            careRecipientTimezone={TZ}
            initialStatus="skipped"
            onClose={onClose}
          />
        </ToastProvider>
      </QueryClientProvider>
    );
    return onClose;
  }

  it('PK29: when the answers differ it stays open with the calm sentence and "Change answer"; no re-read before the verdict (a 409 is not ambiguous)', async () => {
    const server = installConflict();
    const user = userEvent.setup();
    const onClose = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Already marked taken by Ana at 8:02 AM.');
    expect(screen.getByRole('button', { name: 'Change answer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockedPost).toHaveBeenCalledTimes(1);
    // The dialog never lists the day itself; any read here would be a
    // verify-before-alert re-read, which a definitive 409 must not trigger.
    expect(server.todayReads).toBe(0);
  });

  it('the same answer on both sides (nothing to change): the calm toast and close, as before PK29', async () => {
    installConflict({ status: 'skipped' });
    const user = userEvent.setup();
    const onClose = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Already skipped by Ana at 8:02 AM.')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change answer' })).toBeNull();
  });
});
