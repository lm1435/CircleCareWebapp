// PK29 (approved 2026-09-30): "Change Ana's answer?". The already-recorded
// notice gains a "Change answer" action -> confirm dialog -> a second POST with
// `overwrite: true, expected_status: <the answer the caregiver saw>`. Drives the
// REAL TodaysMeds / ConfirmMedDialog -> ChangeAnswerDialog -> useConfirmMedication
// with only the HTTP client faked (harness copied from doseAlreadyRecorded.test.tsx).

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

afterEach(async () => {
  await i18n.changeLanguage('en');
});


/** First POST: refused (Ana answered first). A later POST carrying `overwrite` is
 *  decided by `onOverwrite`. Every POST body is recorded. */
function installChangeFlow(opts: {
  first?: Record<string, unknown>;
  onOverwrite: (body: Record<string, unknown>) => unknown;
}) {
  const server = installBackend({ writeLands: false, failWith: conflict(opts.first) });
  const bodies: Array<Record<string, unknown>> = [];
  mockedPost.mockImplementation((_url: string, body: Record<string, unknown>) => {
    bodies.push(body);
    if (body.overwrite) {
      const out = opts.onOverwrite(body);
      return out instanceof Error || (out as { error?: unknown })?.error
        ? Promise.reject(out)
        : Promise.resolve(out);
    }
    server.recorded = {
      status: (opts.first?.status as 'taken' | 'skipped') ?? 'skipped',
      confirmed_at: '2026-06-12T12:02:00.000Z',
      confirmed_by: 'ana',
    } as TodaysMedication['confirmation'];
    return Promise.reject(conflict({ status: 'skipped', ...opts.first }));
  });
  return { server, bodies };
}

const OK = { success: true, data: { confirmation: { id: 'c1', status: 'taken' } } };

describe('TodaysMeds: Take on a dose Ana skipped', () => {
  it('the notice carries "Change answer"; the dialog names Ana, her answer and the Activity consequence; confirming sends overwrite + expected_status', async () => {
    const { bodies } = installChangeFlow({ onOverwrite: () => OK });
    const user = userEvent.setup();
    await takeViaTodaysMeds();

    expect(await screen.findByText('Already skipped by Ana at 8:02 AM.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change answer' }));

    expect(await screen.findByText("Change Ana's answer?")).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ana marked this dose skipped at 8:02 AM. Change it to taken? Everyone in the circle will see the change in Activity.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Keep Ana's answer" })).toBeInTheDocument();
    // Nothing is overwritten until the dialog is confirmed.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('overwrite');

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Change answer' }));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({
      event_id: 'med-atorva',
      status: 'taken',
      scheduled_time: '10:00:00',
      overwrite: true,
      expected_status: 'skipped',
    });
    expect(await screen.findByText('Marked as taken')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"Keep Ana\'s answer" sends nothing', async () => {
    const { bodies } = installChangeFlow({ onOverwrite: () => OK });
    const user = userEvent.setup();
    await takeViaTodaysMeds();
    await user.click(await screen.findByRole('button', { name: 'Change answer' }));
    await user.click(await screen.findByRole('button', { name: "Keep Ana's answer" }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodies).toHaveLength(1);
  });

  it('Ana changed it AGAIN meanwhile (fresh 409): re-asks with the new facts, never overwrites blind', async () => {
    const { bodies } = installChangeFlow({
      onOverwrite: () =>
        conflict({ status: 'skipped', recorded_by_name: 'Bo', recorded_at: '2026-06-12T12:30:00.000Z' }),
    });
    const user = userEvent.setup();
    await takeViaTodaysMeds();
    await user.click(await screen.findByRole('button', { name: 'Change answer' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Change answer' }));

    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(await screen.findByText("Change Bo's answer?")).toBeInTheDocument();
    expect(screen.getByText(/Bo marked this dose skipped at 8:30 AM/)).toBeInTheDocument();
    expect(bodies).toHaveLength(2);
  });

  it('ES: the same flow in Spanish', async () => {
    await i18n.changeLanguage('es');
    installChangeFlow({ onOverwrite: () => OK });
    const user = userEvent.setup();
    await takeViaTodaysMeds();
    await user.click(await screen.findByRole('button', { name: 'Cambiar respuesta' }));
    expect(await screen.findByText('¿Cambiar la respuesta de Ana?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mantener la respuesta de Ana' })).toBeInTheDocument();
  });

  it('no name: the "Another caregiver" / "Keep answer" variants', async () => {
    installChangeFlow({ first: { recorded_by_name: null }, onOverwrite: () => OK });
    const user = userEvent.setup();
    await takeViaTodaysMeds();
    await user.click(await screen.findByRole('button', { name: 'Change answer' }));
    expect(await screen.findByText('Change this answer?')).toBeInTheDocument();
    expect(
      screen.getByText(/^Another caregiver marked this dose skipped at 8:02 AM\. Change it to taken\?/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep answer' })).toBeInTheDocument();
  });

  it('answers that already match: the notice has no Change answer action', async () => {
    installChangeFlow({ first: { status: 'taken' }, onOverwrite: () => OK });
    await takeViaTodaysMeds();
    expect(await screen.findByText('Already marked taken by Ana at 8:02 AM.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change answer' })).toBeNull();
  });
});

describe('ConfirmMedDialog (Calendar): Skip on a dose Ana took', () => {
  it('stays open with the notice; Change answer -> confirm -> overwrite POST -> closes', async () => {
    const { bodies } = installChangeFlow({
      first: { status: 'taken' },
      onOverwrite: () => ({ success: true, data: { confirmation: { id: 'c1', status: 'skipped' } } }),
    });
    const user = userEvent.setup();
    const onClose = vi.fn();
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

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Already marked taken by Ana at 8:02 AM.');
    await user.click(screen.getByRole('button', { name: 'Change answer' }));

    expect(await screen.findByText("Change Ana's answer?")).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ana marked this dose taken at 8:02 AM. Change it to skipped? Everyone in the circle will see the change in Activity.'
      )
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(1);

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change answer' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({
      status: 'skipped',
      overwrite: true,
      expected_status: 'taken',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText('Marked as skipped')).toBeInTheDocument();
  });

  it('Close on the notice sends nothing further', async () => {
    const { bodies } = installChangeFlow({ first: { status: 'taken' }, onOverwrite: () => OK });
    const user = userEvent.setup();
    const onClose = vi.fn();
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
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');
    // The footer's Close (the header × carries the same name).
    const closes = screen.getAllByRole('button', { name: 'Close' });
    await user.click(closes[closes.length - 1]);
    expect(onClose).toHaveBeenCalled();
    expect(bodies).toHaveLength(1);
  });
});
