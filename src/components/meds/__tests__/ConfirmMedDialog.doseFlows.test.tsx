// The ConfirmMedDialog cases that lived inside the TodaysMeds-hosted suites (changeAnswer,
// doseAlreadyRecorded, confirmVerifyBeforeAlert, medsZoneReference). The dialog is live (Calendar "Mark taken",
// Meds page), these cases never needed the dead list; they are moved here unchanged so the old files can go.
// The Today-list halves of those suites are in overview/__tests__/NextUp.doseFlows.test.tsx.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/ui';
import { ConfirmMedDialog } from '@/components/meds/ConfirmMedDialog';
import type { TodaysMedication } from '@/api/medicationConfirmations';
import {
  BASE_DOSE,
  CIRCLE_ID,
  GENERIC_ERROR,
  NOW,
  SERVER_ERROR_ENVELOPE,
  SUCCESS_TAKEN,
  TZ,
  installBackend,
  mockedPost,
  mockedGet,
  newQueryClient,
  type FakeServer,
} from '../../overview/__tests__/helpers/doseFlowHarness';

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

beforeEach(() => {
  mockUseHourCycle.mockReturnValue('12h');
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: TZ,
  } as Intl.ResolvedDateTimeFormatOptions);
  mockedGet.mockReset();
  mockedPost.mockReset();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

function conflict(details: Record<string, unknown> = {}) {
  return {
    success: false,
    error: {
      code: 'DOSE_ALREADY_RECORDED',
      message: 'Already marked taken by Ana at 8:02 AM.',
      details: {
        status: 'taken',
        recorded_by_name: 'Ana',
        recorded_at: '2026-06-12T12:02:00.000Z',
        timezone: TZ,
        ...details,
      },
    },
  };
}

function installConflict(details: Record<string, unknown> = {}) {
  const server = installBackend({ writeLands: false, failWith: conflict(details) }) as FakeServer;
  mockedPost.mockImplementation(() => {
    server.recorded = {
      status: (details.status as 'taken' | 'skipped') ?? 'taken',
      confirmed_at: '2026-06-12T12:02:00.000Z',
      confirmed_by: 'ana',
    } as TodaysMedication['confirmation'];
    return Promise.reject(conflict(details));
  });
  return server;
}

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

function renderDialog(
  props: Partial<React.ComponentProps<typeof ConfirmMedDialog>> = {},
  onClose = vi.fn()
) {
  render(
    <QueryClientProvider client={newQueryClient()}>
      <ToastProvider>
        <ConfirmMedDialog
          source="calendar"
          circleId={CIRCLE_ID}
          med={BASE_DOSE}
          careRecipientTimezone={TZ}
          onClose={onClose}
          {...props}
        />
      </ToastProvider>
    </QueryClientProvider>
  );
  return onClose;
}

const OK = { success: true, data: { confirmation: { id: 'c1', status: 'taken' } } };

describe('ConfirmMedDialog: Skip on a dose Ana took (was changeAnswer)', () => {
  it('stays open with the notice; Change answer -> confirm -> overwrite POST -> closes', async () => {
    const { bodies } = installChangeFlow({
      first: { status: 'taken' },
      onOverwrite: () => ({ success: true, data: { confirmation: { id: 'c1', status: 'skipped' } } }),
    });
    const user = userEvent.setup();
    const onClose = renderDialog({ initialStatus: 'skipped' });

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
    expect(bodies[1]).toMatchObject({ status: 'skipped', overwrite: true, expected_status: 'taken' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(await screen.findByText('Marked as skipped')).toBeInTheDocument();
  });

  it('NEGATIVE Close on the notice sends nothing further', async () => {
    const { bodies } = installChangeFlow({ first: { status: 'taken' }, onOverwrite: () => OK });
    const user = userEvent.setup();
    const onClose = renderDialog({ initialStatus: 'skipped' });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');
    const closes = screen.getAllByRole('button', { name: 'Close' });
    await user.click(closes[closes.length - 1]);
    expect(onClose).toHaveBeenCalled();
    expect(bodies).toHaveLength(1);
  });
});

describe('ConfirmMedDialog: a Save on a dose another caregiver already answered (was doseAlreadyRecorded)', () => {
  it('PK29: when the answers differ it stays open with the calm sentence and "Change answer"; no re-read before the verdict (a 409 is not ambiguous)', async () => {
    const server = installConflict();
    const user = userEvent.setup();
    const onClose = renderDialog({ initialStatus: 'skipped' });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Already marked taken by Ana at 8:02 AM.');
    expect(screen.getByRole('button', { name: 'Change answer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(mockedPost).toHaveBeenCalledTimes(1);
    expect(server.todayReads).toBe(0);
  });

  it('the same answer on both sides (nothing to change): the calm toast and close', async () => {
    installConflict({ status: 'skipped' });
    const user = userEvent.setup();
    const onClose = renderDialog({ initialStatus: 'skipped' });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Already skipped by Ana at 8:02 AM.')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change answer' })).toBeNull();
  });
});

describe('ConfirmMedDialog (calendar "Mark taken"): ambiguous failure after the write landed (was confirmVerifyBeforeAlert)', () => {
  it('NEGATIVE CONTROL: a 500 where the write did NOT land keeps the dialog open with "Couldn\'t save" (after a re-read)', async () => {
    const server = installBackend({ writeLands: false, failWith: SERVER_ERROR_ENVELOPE });
    const user = userEvent.setup();
    const onClose = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_ERROR);
    expect(server.recorded).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(server.todayReads).toBe(1);
  });

  it('a 500 after the write re-reads, closes with the success toast, and shows no error', async () => {
    installBackend({ writeLands: true, failWith: SERVER_ERROR_ENVELOPE });
    const user = userEvent.setup();
    const onClose = renderDialog();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(SUCCESS_TAKEN)).toBeInTheDocument();
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ConfirmMedDialog heading: zone label judged against the day being confirmed (was medsZoneReference)', () => {
  const RECIPIENT_TZ = 'America/Denver';
  const makeMed = (id: string, date: string): TodaysMedication =>
    ({
      id,
      event_type: 'medication',
      title: 'Warfarin',
      medication_name: `Warfarin ${id}`,
      medication_dosage: null,
      scheduled_date: date,
      scheduled_time: '14:00:00',
      confirmation: null,
    }) as TodaysMedication;

  it('judges the label against the day being confirmed (Phoenix viewer, Denver recipient, across spring-forward)', () => {
    vi.setSystemTime(new Date('2026-03-08T19:00:00Z'));
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'America/Phoenix',
    } as Intl.ResolvedDateTimeFormatOptions);
    const dlg = (med: TodaysMedication) =>
      render(
        <QueryClientProvider client={newQueryClient()}>
          <ToastProvider>
            <ConfirmMedDialog
              source="care_profile"
              circleId={CIRCLE_ID}
              med={med}
              careRecipientTimezone={RECIPIENT_TZ}
              onClose={vi.fn()}
            />
          </ToastProvider>
        </QueryClientProvider>
      ).container;

    const today = dlg(makeMed('today', '2026-03-08'));
    const yesterday = dlg(makeMed('yesterday', '2026-03-07'));

    expect(within(today).getByText(/2:00 PM \(Denver\)/)).toBeInTheDocument();
    // NEGATIVE: on the 7th Denver and Phoenix were one clock, so no label.
    expect(within(yesterday).queryByText(/\(Denver\)/)).not.toBeInTheDocument();
  });
});
