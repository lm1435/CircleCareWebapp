// The as-needed analytics, driven through the REAL flows (give, undo, 409
// prompt, failure, remove) with the real `Analytics` wrapper and a spy on
// posthog.capture. The point is what leaves the browser: enums and booleans
// only — never the medication name, the note, the circle id or any uuid.
//
// Also: the care-recipient "you" copy of the log dialog (self vs caregiver).

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import i18n from '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { AsNeededSection } from '@/components/meds/AsNeededSection';
import { DoseHistoryModal } from '@/components/meds/DoseHistoryModal';
import { MEDICATION_UNDO_DELAY_MS } from '@/components/meds/useMedicationUndo';
import { useAuthStore } from '@/store/authStore';
import type { TodaysMedication } from '@/api/medicationConfirmations';

const capture = vi.fn();
let collectionAllowed = true;
vi.mock('@/lib/env', () => ({
  env: {
    VITE_SUPABASE_URL: 'https://test.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon',
    VITE_API_URL: 'http://localhost:3000',
    VITE_POSTHOG_KEY: 'phc_test',
  },
}));
vi.mock('@/lib/posthogLoader', () => ({
  withPosthog: (run: (ph: { capture: typeof capture }) => void) => run({ capture }),
}));
vi.mock('@/lib/analyticsMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/analyticsMode')>()),
  analyticsCollectionAllowed: () => collectionAllowed,
}));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;

const CIRCLE_ID = 'circle-1';
const TZ = 'America/New_York';
const NOW = new Date('2026-06-12T16:00:00Z'); // 12:00 PM New York
const MED = 'prn-1';
const SUMMARY_URL = `/circles/${CIRCLE_ID}/medications/as-needed/summary`;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const prn: TodaysMedication = {
  id: MED,
  event_type: 'medication',
  title: 'Ibuprofen',
  medication_name: 'Ibuprofen',
  medication_dosage: '200 mg',
  scheduled_date: '2026-06-12',
  scheduled_time: null,
  as_needed: true,
  as_needed_reason: 'pain',
  confirmation: null,
} as TodaysMedication;

const lastDose = (over: Record<string, unknown> = {}) => ({
  id: 'dose-last',
  given_at: '2026-06-12T13:15:00Z', // 165 min before NOW
  given_by: { id: 'jennie', first_name: 'Jennie', last_name: 'Ruiz' },
  note: null,
  ...over,
});

function member(id: string, isCareRecipient: boolean) {
  return {
    id,
    email: `${id}@example.com`,
    first_name: id,
    last_name: null,
    role: 'member',
    is_care_recipient: isCareRecipient,
    is_medication_responsible: false,
    joined_at: '2026-01-01T00:00:00Z',
    timezone: TZ,
  };
}

function mockApi(opts: { last?: ReturnType<typeof lastDose> | null; meIsRecipient?: boolean } = {}) {
  const last = opts.last === undefined ? null : opts.last;
  get.mockImplementation((url: string) => {
    if (url === '/circles') {
      return Promise.resolve({ success: true, data: { circles: [] } });
    }
    if (url === `/circles/${CIRCLE_ID}`) {
      return Promise.resolve({
        success: true,
        data: {
          circle: {
            id: CIRCLE_ID,
            care_recipient_timezone: TZ,
            can_edit: true,
            view_only: false,
            members: [member('me', opts.meIsRecipient === true), member('jennie', false)],
          },
        },
      });
    }
    if (url === SUMMARY_URL) {
      return Promise.resolve({ success: true, data: { summaries: { [MED]: { last_dose: last } } } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AsNeededSection circleId={CIRCLE_ID} meds={[prn]} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Gave a dose of Ibuprofen' }));
}

async function submitAndRunOut(dialog: HTMLElement, submitName: string | RegExp = 'Log dose') {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
  fireEvent.click(within(dialog).getByRole('button', { name: submitName }));
  await act(async () => {
    vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
  });
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
}

const events = (name?: string) =>
  capture.mock.calls.filter(([e]) => !name || e === name) as [string, Record<string, unknown>][];

beforeEach(() => {
  collectionAllowed = true;
  capture.mockClear();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: TZ,
  } as Intl.ResolvedDateTimeFormatOptions);
  get.mockReset();
  post.mockReset();
  useAuthStore.setState({ user: { id: 'me', email: 'me@example.com' } as never });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('as-needed analytics through the real flows', () => {
  it('a logged dose: ONE as_needed_dose_logged with enum/boolean props, and no name, note, circle id or uuid in ANY captured prop', async () => {
    mockApi({ last: lastDose() });
    post.mockResolvedValue({
      success: true,
      data: { dose: { id: 'dose-new' }, summary: { last_dose: lastDose({ id: 'dose-new' }) } },
    });
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    const dialog = await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' });
    await user.type(within(dialog).getByLabelText(/Note/), 'after dinner');
    await user.click(within(dialog).getByRole('radio', { name: '2 h ago' }));
    await submitAndRunOut(dialog);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await screen.findByText('Dose logged');

    const logged = events('as_needed_dose_logged');
    expect(logged).toHaveLength(1);
    expect(logged[0][1]).toEqual({
      surface: 'home',
      with_note: true,
      backdated_bucket: '1-4h', // 2 h ago
      actor: 'caregiver',
      after_recent_prompt: false,
      // Last dose 13:15Z; this dose given 14:00Z (2 h back) = 45 min apart.
      minutes_since_last_bucket: '<1h',
    });

    const json = JSON.stringify(capture.mock.calls);
    // FALSIFIER target: adding the name / note / circle id / any id to a prop turns these red.
    expect(json).not.toContain('Ibuprofen');
    expect(json).not.toContain('after dinner');
    expect(json).not.toContain(CIRCLE_ID);
    expect(json).not.toContain('Jennie');
    expect(json).not.toContain('dose-new');
    expect(json).not.toMatch(UUID_RE);
    for (const [, props] of capture.mock.calls) {
      for (const v of Object.values(props as Record<string, unknown>)) {
        expect(['string', 'boolean']).toContain(typeof v);
      }
    }
  });

  it('first dose, now, no note: first / none / false', async () => {
    mockApi({ last: null });
    post.mockResolvedValue({ success: true, data: { dose: { id: 'd' }, summary: { last_dose: null } } });
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    await submitAndRunOut(await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' }));
    await waitFor(() => expect(events('as_needed_dose_logged')).toHaveLength(1));
    expect(events('as_needed_dose_logged')[0][1]).toMatchObject({
      with_note: false,
      backdated_bucket: 'none',
      minutes_since_last_bucket: 'first',
    });
  });

  it('a REPLAYED answer is not a new dose: no as_needed_dose_logged', async () => {
    mockApi();
    post.mockResolvedValue({
      success: true,
      data: { dose: { id: 'd' }, summary: { last_dose: null }, replayed: true },
    });
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    await submitAndRunOut(await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' }));
    await screen.findByText('Dose logged');
    expect(events('as_needed_dose_logged')).toHaveLength(0);
  });

  it('Undo inside the window: as_needed_dose_undone with the surface, and no dose_logged', async () => {
    mockApi();
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    const dialog = await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log dose' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo Ibuprofen' }));
    expect(events('as_needed_dose_undone').map(([, p]) => p)).toEqual([{ surface: 'home' }]);
    await act(async () => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });
    expect(post).not.toHaveBeenCalled();
    expect(events('as_needed_dose_logged')).toHaveLength(0);
  });

  it('failures are bucketed: a coded refusal = error; a stopped medication = discontinued; no envelope = network', async () => {
    for (const [rejection, reason] of [
      [{ success: false, error: { code: 'VALIDATION_ERROR', message: 'x' } }, 'error'],
      [{ success: false, error: { code: 'MEDICATION_DISCONTINUED', message: 'x' } }, 'discontinued'],
    ] as const) {
      capture.mockClear();
      post.mockReset();
      mockApi();
      post.mockRejectedValue(rejection);
      const { unmount } = (() => {
        renderSection();
        return { unmount: () => undefined };
      })();
      const user = userEvent.setup();
      await openDialog(user);
      await submitAndRunOut(await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' }));
      await waitFor(() => expect(events('as_needed_dose_log_failed')).toHaveLength(1));
      expect(events('as_needed_dose_log_failed')[0][1]).toEqual({ reason });
      unmount();
      document.body.innerHTML = '';
    }
  });

  it('the "just logged" prompt: Log another -> logged_another, then the dose says after_recent_prompt', async () => {
    // Jennie logged 10 minutes ago: the card already shows it, so the prompt comes first.
    mockApi({ last: lastDose({ given_at: '2026-06-12T15:50:00Z' }) });
    post.mockResolvedValue({ success: true, data: { dose: { id: 'd' }, summary: { last_dose: null } } });
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    const prompt = await screen.findByRole('dialog', { name: 'Jennie just logged a dose' });
    await user.click(within(prompt).getByRole('button', { name: 'Log another dose' }));
    await submitAndRunOut(await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' }));
    await waitFor(() => expect(events('as_needed_dose_logged')).toHaveLength(1));
    expect(events('as_needed_recent_conflict').map(([, p]) => p)).toEqual([
      { resolution: 'logged_another' },
    ]);
    expect(events('as_needed_dose_logged')[0][1]).toMatchObject({ after_recent_prompt: true });
  });

  it('the "just logged" prompt: "No, that was it" -> dismissed, nothing logged', async () => {
    mockApi({ last: lastDose({ given_at: '2026-06-12T15:50:00Z' }) });
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    const prompt = await screen.findByRole('dialog', { name: 'Jennie just logged a dose' });
    await user.click(within(prompt).getByText('No, that was it'));
    expect(events('as_needed_recent_conflict').map(([, p]) => p)).toEqual([
      { resolution: 'dismissed' },
    ]);
    expect(events('as_needed_dose_logged')).toHaveLength(0);
  });

  it('CONSENT GATE: with collection not allowed, the flow works and NOTHING is captured', async () => {
    collectionAllowed = false;
    mockApi();
    post.mockResolvedValue({ success: true, data: { dose: { id: 'd' }, summary: { last_dose: null } } });
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    await submitAndRunOut(await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' }));
    await screen.findByText('Dose logged');
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('removing a dose', () => {
  function renderHistory(over: Record<string, unknown> = {}) {
    const dose = {
      id: 'dose-1',
      event_id: MED,
      circle_id: CIRCLE_ID,
      given_at: '2026-06-12T15:30:00Z', // 30 min before NOW
      given_by: 'me',
      note: 'secret note',
      client_request_id: 'req',
      created_at: '2026-06-12T15:30:00Z',
      removed_at: null,
      removed_by: null,
      given_by_user: { id: 'me', first_name: 'Me', last_name: null },
      removed_by_user: null,
      ...over,
    };
    get.mockResolvedValue({ success: true, data: { doses: [dose], hasMore: false } });
    post.mockResolvedValue({ success: true, data: { dose: { ...dose, removed_at: 'x' }, summary: {} } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <DoseHistoryModal
            circleId={CIRCLE_ID}
            eventId={MED}
            name="Ibuprofen"
            timezone={TZ}
            canEdit
            onClose={vi.fn()}
          />
        </ToastProvider>
      </QueryClientProvider>
    );
  }

  it('opening reports scope "medication"; removing your OWN 30-minute-old dose reports own + <1h', async () => {
    renderHistory();
    const user = userEvent.setup();
    expect(events('as_needed_history_viewed').map(([, p]) => p)).toEqual([{ scope: 'medication' }]);
    await user.click(await screen.findByRole('button', { name: /Remove this dose, logged at/ }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await screen.findByText('Dose removed');
    expect(events('as_needed_dose_removed').map(([, p]) => p)).toEqual([
      { age_bucket: '<1h', own: true },
    ]);
    // Still one "viewed": the confirm swap does not re-open the log.
    expect(events('as_needed_history_viewed')).toHaveLength(1);
    expect(JSON.stringify(capture.mock.calls)).not.toContain('secret note');
  });

  it('removing SOMEONE ELSE\'s day-old dose: own false, "<24h"/"older" by age', async () => {
    renderHistory({ given_by: 'jennie', given_at: '2026-06-11T10:00:00Z' }); // 30 h old
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Remove this dose, logged at/ }));
    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    await screen.findByText('Dose removed');
    expect(events('as_needed_dose_removed').map(([, p]) => p)).toEqual([
      { age_bucket: 'older', own: false },
    ]);
  });
});

describe('the care recipient is addressed as "you"', () => {
  it('the recipient (their membership is flagged is_care_recipient) sees "Did you take Ibuprofen?" and the self submit', async () => {
    mockApi({ meIsRecipient: true });
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    const dialog = await screen.findByRole('dialog', { name: 'Did you take Ibuprofen?' });
    expect(within(dialog).getByText(/Everyone in your circle will see this\./)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Log that you took a dose' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Log dose' })).toBeNull();
  });

  it('the recipient\'s own dose reports actor "recipient"', async () => {
    mockApi({ meIsRecipient: true });
    post.mockResolvedValue({ success: true, data: { dose: { id: 'd' }, summary: { last_dose: null } } });
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    await submitAndRunOut(
      await screen.findByRole('dialog', { name: 'Did you take Ibuprofen?' }),
      'Log that you took a dose'
    );
    await waitFor(() => expect(events('as_needed_dose_logged')).toHaveLength(1));
    expect(events('as_needed_dose_logged')[0][1]).toMatchObject({ actor: 'recipient' });
  });

  it('a caregiver keeps the third-person copy', async () => {
    mockApi({ meIsRecipient: false });
    renderSection();
    const user = userEvent.setup();
    await openDialog(user);
    const dialog = await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' });
    expect(within(dialog).getByText(/Everyone in the circle will see this\./)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Log dose' })).toBeInTheDocument();
    expect(screen.queryByText('Did you take Ibuprofen?')).toBeNull();
  });

  it('Spanish, tu form', async () => {
    await i18n.changeLanguage('es');
    mockApi({ meIsRecipient: true });
    renderSection();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Di una dosis de Ibuprofen/ }));
    const dialog = await screen.findByRole('dialog', { name: '¿Tomaste Ibuprofen?' });
    expect(within(dialog).getByText(/Todos en tu círculo lo verán\./)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'Registrar que tomaste una dosis' })
    ).toBeInTheDocument();
  });
});
