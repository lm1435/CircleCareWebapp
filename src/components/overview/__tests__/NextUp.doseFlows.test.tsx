// Re-homed from the dead TodaysMeds-hosted suites (changeAnswer, doseAlreadyRecorded, confirmVerifyBeforeAlert)
// onto the LIVE Today list: the real NextUp over useNextUp, real useMedicationUndo / useConfirmMedication /
// ChangeAnswerDialog, only the HTTP client faked (see helpers/doseFlowHarness.tsx).
// Same fixtures as the originals. The dead list showed an answered dose as a "Taken" row; the live list drops an
// answered dose from Next up (doseNeedsAnswer), so "the row shows the real answer" reads "the row is gone".

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Mock } from 'vitest';
import i18n from '@/i18n';
import { Analytics } from '@/lib/analytics';
import type { TodaysMedication } from '@/api/medicationConfirmations';
import {
  GENERIC_ERROR,
  NOW,
  SERVER_ERROR_ENVELOPE,
  SUCCESS_TAKEN,
  TZ,
  axiosTimeout,
  installBackend,
  mockedGet,
  mockedPost,
  takeViaNextUp,
  CIRCLE_ID,
  type FakeServer,
} from './helpers/doseFlowHarness';

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
 * THE STALE PAGE: it loaded before Ana answered, so the dose still offers Take/Skip. By the time this
 * caregiver's POST arrives, Ana's answer is what the server holds: the POST is refused and every later read
 * shows hers.
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

/** First POST: refused (Ana answered first). A later POST carrying `overwrite` is decided by `onOverwrite`. */
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

describe('NextUp: Take on a dose Ana skipped (was changeAnswer / TodaysMeds)', () => {
  it('the notice carries "Change answer"; the dialog names Ana, her answer and the Activity consequence; confirming sends overwrite + expected_status', async () => {
    const { bodies } = installChangeFlow({ onOverwrite: () => OK });
    const user = userEvent.setup();
    await takeViaNextUp();

    expect(await screen.findByText('Already skipped by Ana at 8:02 AM.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Change answer' }));

    expect(await screen.findByText("Change Ana's answer?")).toBeInTheDocument();
    expect(
      screen.getByText(
        'Ana marked this dose skipped at 8:02 AM. Change it to taken? Everyone in the circle will see the change in Activity.'
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Keep Ana's answer" })).toBeInTheDocument();
    // NEGATIVE: nothing is overwritten until the dialog is confirmed.
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

  it('NEGATIVE "Keep Ana\'s answer" sends nothing', async () => {
    const { bodies } = installChangeFlow({ onOverwrite: () => OK });
    const user = userEvent.setup();
    await takeViaNextUp();
    await user.click(await screen.findByRole('button', { name: 'Change answer' }));
    await user.click(await screen.findByRole('button', { name: "Keep Ana's answer" }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bodies).toHaveLength(1);
  });

  it('NEGATIVE Ana changed it AGAIN meanwhile (fresh 409): re-asks with the new facts, never overwrites blind', async () => {
    const { bodies } = installChangeFlow({
      onOverwrite: () =>
        conflict({ status: 'skipped', recorded_by_name: 'Bo', recorded_at: '2026-06-12T12:30:00.000Z' }),
    });
    const user = userEvent.setup();
    await takeViaNextUp();
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
    await takeViaNextUp();
    await user.click(await screen.findByRole('button', { name: 'Cambiar respuesta' }));
    expect(await screen.findByText('¿Cambiar la respuesta de Ana?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mantener la respuesta de Ana' })).toBeInTheDocument();
  });

  it('no name: the "Another caregiver" / "Keep answer" variants', async () => {
    installChangeFlow({ first: { recorded_by_name: null }, onOverwrite: () => OK });
    const user = userEvent.setup();
    await takeViaNextUp();
    await user.click(await screen.findByRole('button', { name: 'Change answer' }));
    expect(await screen.findByText('Change this answer?')).toBeInTheDocument();
    expect(
      screen.getByText(/^Another caregiver marked this dose skipped at 8:02 AM\. Change it to taken\?/)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep answer' })).toBeInTheDocument();
  });

  it('NEGATIVE answers that already match: the notice has no Change answer action', async () => {
    installChangeFlow({ first: { status: 'taken' }, onOverwrite: () => OK });
    await takeViaNextUp();
    expect(await screen.findByText('Already marked taken by Ana at 8:02 AM.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change answer' })).toBeNull();
  });
});

describe('NextUp: a stale Take on a dose another caregiver already answered (was doseAlreadyRecorded)', () => {
  it('EN: the calm who-and-when toast, never "Couldn\'t save"; the day re-read and the row gone; the undo badge gone', async () => {
    const server = installConflict();
    await takeViaNextUp();
    expect(server.recorded?.confirmed_by).toBe('ana');

    const toast = await screen.findByText('Already marked taken by Ana at 8:02 AM.');
    expect(toast.closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(GENERIC_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(/fail|couldn/i)).not.toBeInTheDocument();
    // The day was re-read after the refusal, and the answered dose left Next up (Ana's answer stands) ...
    await waitFor(() => expect(server.todayReads).toBeGreaterThan(server.readsAtPost));
    await waitFor(() => expect(screen.queryByText('Atorvastatin')).not.toBeInTheDocument());
    // ... and the undo badge is gone.
    expect(screen.queryByRole('button', { name: /undo/i })).toBeNull();
    // NEGATIVE: exactly one POST, nothing retried.
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('ES, 12h: "Ya marcado como omitido a las 8:02 a. m. por Ana."', async () => {
    await i18n.changeLanguage('es');
    installConflict({ status: 'skipped' });
    await takeViaNextUp();
    expect(
      await screen.findByText('Ya marcado como omitido a las 8:02 a. m. por Ana.')
    ).toBeInTheDocument();
  });

  it('far zone (Pacific/Kiritimati, UTC+14) on a 24h clock, no name: "...by another caregiver at 02:02."', async () => {
    mockUseHourCycle.mockReturnValue('24h');
    installConflict({ recorded_by_name: null, timezone: 'Pacific/Kiritimati' });
    await takeViaNextUp();
    // 12:02Z = 02:02 next day in Kiritimati.
    expect(
      await screen.findByText('Already marked taken by another caregiver at 02:02.')
    ).toBeInTheDocument();
  });
});

describe('NextUp (undo flow): ambiguous confirm failure after the write landed (was confirmVerifyBeforeAlert)', () => {
  it.each([
    ['a 500 after the write', () => SERVER_ERROR_ENVELOPE],
    ['a timeout after the write', axiosTimeout],
  ])(
    '%s: re-reads the day BEFORE any verdict and reports SUCCESS, never "Couldn\'t save"',
    async (_label, failWith) => {
      const recovered = vi.spyOn(Analytics, 'medicationConfirmRecovered');
      const server = installBackend({ writeLands: true, failWith: failWith() });
      await takeViaNextUp();

      expect(await screen.findByText(SUCCESS_TAKEN)).toBeInTheDocument();
      // medication_confirm_recovered: fired once on the recovered success path, with the closed-set code.
      await waitFor(() => expect(recovered).toHaveBeenCalledTimes(1));
      expect(recovered.mock.calls[0][1]).toBe('taken');
      expect(screen.queryByText(GENERIC_ERROR)).not.toBeInTheDocument();
      expect(server.todayReads).toBeGreaterThan(0);
      await waitFor(() => expect(screen.queryByText('Atorvastatin')).not.toBeInTheDocument());
      expect(screen.queryByText(GENERIC_ERROR)).not.toBeInTheDocument();
    }
  );

  it('NEGATIVE CONTROL: a failure where the write did NOT land still shows the error', async () => {
    const server = installBackend({ writeLands: false, failWith: SERVER_ERROR_ENVELOPE });
    await takeViaNextUp();

    expect(server.recorded).toBeNull();
    expect(await screen.findByText(GENERIC_ERROR)).toBeInTheDocument();
    expect(screen.queryByText(SUCCESS_TAKEN)).not.toBeInTheDocument();
  });

  it('NEGATIVE the re-read ITSELF fails: "couldn\'t check", never "Couldn\'t save" and never success', async () => {
    installBackend({ writeLands: true, failWith: axiosTimeout() });
    // After the (lost) POST, every read of the day fails too.
    const baseGet = (mockedGet as Mock).getMockImplementation()!;
    let postSeen = false;
    mockedPost.mockImplementationOnce(() => {
      postSeen = true;
      return Promise.reject(axiosTimeout());
    });
    mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
      if (postSeen && url === `/circles/${CIRCLE_ID}/events`) return Promise.reject(axiosTimeout());
      return baseGet(url, config);
    });
    await takeViaNextUp();

    expect(
      await screen.findByText(
        "We couldn't check whether Atorvastatin was recorded. Check the calendar once you're back online."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(GENERIC_ERROR)).not.toBeInTheDocument();
    expect(screen.queryByText(SUCCESS_TAKEN)).not.toBeInTheDocument();
  });
});
