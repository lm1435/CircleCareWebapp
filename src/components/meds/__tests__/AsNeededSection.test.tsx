// As-needed (PRN) medications on Home: the section, the card states, and the
// whole "Gave a dose" flow (log dialog, 5 s undo, coordination prompt, 409
// retry, replay idempotency, view-only, Spanish).
//
// NO LIMITS (owner 2026-10-05): the card says "Last given {time} by {name}" or
// "Not given yet" and NOTHING else — no counter, no "OK again", no warning.
//
// Time: Date is frozen (setTimeout stays real unless a test fakes it for the
// 5-second window, exactly like TodaysMeds.test). The viewer zone is pinned to
// America/New_York; the recipient is America/New_York except where a test says so.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import i18n from '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { TodaysMeds } from '@/components/meds/TodaysMeds';
import { MEDICATION_UNDO_DELAY_MS } from '@/components/meds/useMedicationUndo';
import { useAuthStore } from '@/store/authStore';
import type { Circle } from '@/api/circles';
import type { TodaysMedication } from '@/api/medicationConfirmations';

const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => mockUseHourCycle() }));
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: () => <div data-testid="add-event-modal" />,
}));

const get = apiClient.get as unknown as Mock;
const post = apiClient.post as unknown as Mock;

const CIRCLE_ID = 'circle-1';
const TZ = 'America/New_York';
const NOW = new Date('2026-06-12T16:00:00Z'); // 12:00 PM New York
const TODAY = '2026-06-12';
const MED = 'prn-1';
const DOSES_URL = `/circles/${CIRCLE_ID}/medications/${MED}/as-needed-doses`;
const SUMMARY_URL = `/circles/${CIRCLE_ID}/medications/as-needed/summary`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function makeCircle(overrides: Partial<Circle> = {}): Circle {
  return {
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
    ...overrides,
  };
}

const prnRow = (overrides: Partial<TodaysMedication> = {}): TodaysMedication => ({
  id: MED,
  event_type: 'medication',
  title: 'Ibuprofen',
  medication_name: 'Ibuprofen',
  medication_dosage: '200 mg',
  scheduled_date: TODAY,
  scheduled_time: null,
  as_needed: true,
  as_needed_reason: 'pain',
  confirmation: null,
  ...overrides,
});

const scheduledRow = (overrides: Partial<TodaysMedication> = {}): TodaysMedication => ({
  id: 'sched-1',
  event_type: 'medication',
  title: 'Lisinopril',
  medication_name: 'Lisinopril',
  medication_dosage: null,
  scheduled_date: TODAY,
  scheduled_time: '08:00:00',
  confirmation: { status: 'taken', confirmed_at: '2026-06-12T12:05:00Z', confirmed_by: 'u1' },
  ...overrides,
});

const lastDose = (over: Record<string, unknown> = {}) => ({
  id: 'dose-last',
  given_at: '2026-06-12T13:15:00Z', // 9:15 AM New York — 2 h 45 min ago
  given_by: { id: 'jennie', first_name: 'Jennie', last_name: 'Ruiz' },
  note: null,
  ...over,
});

interface ApiOptions {
  events?: TodaysMedication[];
  summaries?: Record<string, { last_dose: ReturnType<typeof lastDose> | null }>;
  canEdit?: boolean;
  timezone?: string;
  presenceMedication?: boolean;
}

function mockApi({
  events = [prnRow()],
  summaries = { [MED]: { last_dose: null } },
  canEdit = true,
  timezone = TZ,
  presenceMedication = false,
}: ApiOptions = {}): void {
  get.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
    if (url === '/circles') {
      return Promise.resolve({ success: true, data: { circles: [makeCircle({ can_edit: canEdit })] } });
    }
    if (url === `/circles/${CIRCLE_ID}`) {
      return Promise.resolve({
        success: true,
        data: {
          circle: {
            id: CIRCLE_ID,
            care_recipient_timezone: timezone,
            can_edit: canEdit,
            view_only: !canEdit,
          },
        },
      });
    }
    if (url === `/circles/${CIRCLE_ID}/events/presence`) {
      return Promise.resolve({
        success: true,
        data: { medication: presenceMedication, appointment: false, task: false },
      });
    }
    if (url === `/circles/${CIRCLE_ID}/events`) {
      return Promise.resolve({
        success: true,
        data: { events: config?.params?.start_date === TODAY ? events : [] },
      });
    }
    if (url === SUMMARY_URL) {
      return Promise.resolve({ success: true, data: { summaries } });
    }
    if (url === DOSES_URL) {
      return Promise.resolve({ success: true, data: { doses: [], hasMore: false } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderHome(): { queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TodaysMeds circleId={CIRCLE_ID} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { queryClient };
}

const card = (): HTMLElement => {
  const li = screen.getByText('Ibuprofen').closest('li');
  if (!li) throw new Error('as-needed card not found');
  return li;
};

/** Open "Gave a dose" -> the dialog, then click "Log dose" with the 5 s window faked. */
async function openAndLog(user: ReturnType<typeof userEvent.setup>, note?: string) {
  await user.click(await screen.findByRole('button', { name: 'Gave a dose of Ibuprofen' }));
  const dialog = await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' });
  if (note) await user.type(within(dialog).getByLabelText(/Note/), note);
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Log dose' }));
}

async function runOutWindow() {
  await act(async () => {
    vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
  });
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
}

const postedBody = (n = 0) => post.mock.calls[n][1] as Record<string, unknown>;

beforeEach(() => {
  mockUseHourCycle.mockReturnValue('12h');
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/New_York',
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

describe('Home: the As needed section', () => {
  it('draws one card per active as-needed medication: badge, reason, dosage, "Not given yet"', async () => {
    mockApi();
    renderHome();

    expect(await screen.findByRole('heading', { name: 'As needed' })).toBeInTheDocument();
    const c = card();
    expect(within(c).getByText('for pain')).toBeInTheDocument();
    expect(within(c).getByText('200 mg')).toBeInTheDocument();
    expect(await within(c).findByText('Not given yet')).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'Gave a dose of Ibuprofen' })).toBeInTheDocument();
    expect(within(c).getByRole('button', { name: 'History for Ibuprofen' })).toBeInTheDocument();
  });

  it('asks for the as-needed rows in the SAME request as today (no second events read)', async () => {
    mockApi();
    renderHome();
    await screen.findByRole('heading', { name: 'As needed' });
    const todayReads = get.mock.calls.filter(
      ([url, cfg]) =>
        url === `/circles/${CIRCLE_ID}/events` && cfg?.params?.start_date === TODAY
    );
    expect(todayReads).toHaveLength(1);
    expect(todayReads[0][1].params.includeAsNeeded).toBe('true');
  });

  it('NEVER counts toward all-done: a circle with ONLY as-needed medications shows the section alone', async () => {
    mockApi({ events: [prnRow()] });
    renderHome();
    await screen.findByRole('heading', { name: 'As needed' });
    expect(screen.queryByText('All medications answered for today')).toBeNull();
    // ...and is not mistaken for a first-run circle.
    expect(screen.queryByText(/No medications yet/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
    // No dose controls: it is not a scheduled dose.
    expect(screen.queryByRole('button', { name: /^Confirm/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Skip/ })).toBeNull();
  });

  it('beside scheduled doses: all-done reflects the SCHEDULED doses only', async () => {
    mockApi({ events: [scheduledRow(), prnRow()] });
    renderHome();
    expect(await screen.findByText('All medications answered for today')).toBeInTheDocument();
    // The as-needed card, with nobody having given it, did not stop all-done.
    expect(await screen.findByText('Not given yet')).toBeInTheDocument();
  });

  it('an inactive as-needed medication is not offered on Home', async () => {
    mockApi({ events: [prnRow({ discontinued_at: '2026-06-01T00:00:00Z' })] });
    renderHome();
    await waitFor(() => expect(get).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/events`, expect.anything()));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByRole('heading', { name: 'As needed' })).toBeNull();
  });

  it('an as-needed row cached under a day later read as "yesterday" never reaches Needs attention', async () => {
    // Same cache entry, read by the yesterday reader that did not ask for them.
    mockApi({ events: [] });
    get.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
      if (url === '/circles') return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
      if (url === `/circles/${CIRCLE_ID}`)
        return Promise.resolve({ success: true, data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ, can_edit: true } } });
      if (url === `/circles/${CIRCLE_ID}/events/presence`)
        return Promise.resolve({ success: true, data: { medication: true, appointment: false, task: false } });
      if (url === `/circles/${CIRCLE_ID}/events`)
        return Promise.resolve({
          success: true,
          data: { events: config?.params?.start_date === '2026-06-11' ? [prnRow({ scheduled_date: '2026-06-11' })] : [] },
        });
      if (url === SUMMARY_URL) return Promise.resolve({ success: true, data: { summaries: {} } });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderHome();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText('Needs attention')).toBeNull();
  });
});

describe('card states: "Last given {time} by {name}"', () => {
  it('another member: "Last given 9:15 AM by Jennie" in the RECIPIENT zone', async () => {
    mockApi({ summaries: { [MED]: { last_dose: lastDose() } } });
    renderHome();
    const line = await within(await screen.findByRole('listitem', { name: '' }).catch(() => card())).findByTestId(
      'as-needed-last-given'
    );
    expect(line.textContent).toBe('Last given 9:15 AM by Jennie');
  });

  it('your own dose reads "by you"', async () => {
    mockApi({ summaries: { [MED]: { last_dose: lastDose({ given_by: { id: 'me', first_name: 'Me', last_name: null } }) } } });
    renderHome();
    expect((await screen.findByTestId('as-needed-last-given')).textContent).toBe(
      'Last given 9:15 AM by you'
    );
  });

  it('a recipient in another zone: the clock is THEIR clock, labelled — never the browser\'s', async () => {
    // 13:15Z is 6:15 AM... in Denver, 9:15 AM New York; the recipient lives in Los Angeles: 6:15 AM.
    mockApi({
      timezone: 'America/Los_Angeles',
      summaries: { [MED]: { last_dose: lastDose() } },
    });
    renderHome();
    const line = await screen.findByTestId('as-needed-last-given');
    expect(line.textContent).toBe('Last given 6:15 AM (Los Angeles) by Jennie');
  });

  it('FALSIFIER — no counter, no limit, no "OK again", no warning, whatever the server adds', async () => {
    mockApi({
      summaries: {
        [MED]: {
          // A hostile/old payload carrying limit fields must not be rendered.
          last_dose: lastDose(),
          count_24h: 3,
          max_per_24h: 4,
          min_interval_minutes: 360,
          next_ok_at: '2026-06-12T20:00:00Z',
        } as never,
      },
    });
    renderHome();
    await screen.findByTestId('as-needed-last-given');
    const text = card().textContent ?? '';
    expect(text).not.toMatch(/\d+ of \d+/);
    expect(text).not.toMatch(/in 24 ?h/i);
    expect(text).not.toMatch(/OK again|limit|at least|max/i);
    expect(text).not.toMatch(/sooner than|at the limit/i);
  });

  it('does not claim "Not given yet" before the summary has answered', async () => {
    mockApi();
    get.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
      if (url === SUMMARY_URL) return new Promise(() => {});
      if (url === '/circles') return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
      if (url === `/circles/${CIRCLE_ID}`)
        return Promise.resolve({ success: true, data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ, can_edit: true } } });
      if (url === `/circles/${CIRCLE_ID}/events/presence`)
        return Promise.resolve({ success: true, data: { medication: false, appointment: false, task: false } });
      return Promise.resolve({
        success: true,
        data: { events: config?.params?.start_date === TODAY ? [prnRow()] : [] },
      });
    });
    renderHome();
    await screen.findByRole('heading', { name: 'As needed' });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(screen.queryByText('Not given yet')).toBeNull();
  });
});

describe('view-only', () => {
  it('FALSIFIER — a view-only member sees the card and the last-given line, and NO "Gave a dose"', async () => {
    mockApi({ canEdit: false, summaries: { [MED]: { last_dose: lastDose() } } });
    renderHome();
    expect(await screen.findByTestId('as-needed-last-given')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gave a dose/ })).toBeNull();
    // History stays readable.
    expect(screen.getByRole('button', { name: 'History for Ibuprofen' })).toBeInTheDocument();
  });

  it('fails CLOSED while the circle is still loading (no button flash for a view-only member)', async () => {
    mockApi();
    get.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
      if (url === `/circles/${CIRCLE_ID}`) return new Promise(() => {});
      if (url === '/circles') return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
      if (url === `/circles/${CIRCLE_ID}/events/presence`)
        return Promise.resolve({ success: true, data: { medication: false, appointment: false, task: false } });
      return Promise.resolve({
        success: true,
        data: { events: config?.params?.start_date === TODAY ? [prnRow()] : [], summaries: {} },
      });
    });
    renderHome();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole('button', { name: /Gave a dose/ })).toBeNull();
  });
});

describe('giving a dose', () => {
  it('log dialog -> badge + Undo, NOTHING sent; after 5 s ONE POST with client_request_id, note, no given_at', async () => {
    mockApi();
    post.mockResolvedValue({
      success: true,
      data: { dose: { id: 'd1' }, summary: { last_dose: lastDose({ id: 'd1' }) } },
    });
    renderHome();
    const user = userEvent.setup();

    await openAndLog(user, 'after dinner');

    // The badge replaces "Gave a dose"; the request has NOT left.
    expect(within(card()).getByRole('button', { name: 'Undo Ibuprofen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gave a dose of Ibuprofen' })).toBeNull();
    expect(post).not.toHaveBeenCalled();

    await runOutWindow();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    expect(post.mock.calls[0][0]).toBe(DOSES_URL);
    const body = postedBody();
    // FALSIFIER — a dose without an idempotency key is a double-dose waiting to happen.
    expect(body.client_request_id).toMatch(UUID);
    expect(body.note).toBe('after dinner');
    expect(body.known_last_dose_id).toBeNull();
    expect('given_at' in body).toBe(false); // "Now": the server stamps it
    expect('acknowledge_recent' in body).toBe(false);
    expect(await screen.findByText('Dose logged')).toBeInTheDocument();
  });

  it('Undo inside the window: no POST, ever; "Gave a dose" returns', async () => {
    mockApi();
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user);

    fireEvent.click(within(card()).getByRole('button', { name: 'Undo Ibuprofen' }));
    await runOutWindow();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Gave a dose of Ibuprofen' })).toBeInTheDocument();
  });

  it('Undo returns keyboard focus to "Gave a dose", not to the card\'s first control (WCAG 2.4.3)', async () => {
    mockApi();
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user);

    const undo = within(card()).getByRole('button', { name: 'Undo Ibuprofen' });
    undo.focus();
    fireEvent.click(undo);
    const give = within(card()).getByRole('button', { name: 'Gave a dose of Ibuprofen' });
    // Past UndoBadge's own setTimeout(0) fallback, which would otherwise win.
    await act(async () => {
      vi.advanceTimersByTime(30);
    });
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    expect(give).toHaveFocus();
  });

  it('a second click while counting down never makes a second dose', async () => {
    mockApi();
    post.mockResolvedValue({ success: true, data: { dose: { id: 'd1' }, summary: { last_dose: null } } });
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user);
    // The button is gone — a mis-click has nothing to hit.
    expect(screen.queryByRole('button', { name: 'Gave a dose of Ibuprofen' })).toBeNull();
    await runOutWindow();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('REPLAY: a replayed:true answer is a quiet success (one toast, no error)', async () => {
    mockApi();
    post.mockResolvedValue({
      success: true,
      data: { dose: { id: 'd1' }, summary: { last_dose: lastDose({ id: 'd1' }) }, replayed: true },
    });
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user);
    await runOutWindow();
    expect(await screen.findByText('Dose logged')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't log the dose/)).toBeNull();
  });

  it('a failed POST says so and puts "Gave a dose" back (the dose was NOT recorded)', async () => {
    mockApi();
    post.mockRejectedValue({ success: false, error: { code: 'VALIDATION_ERROR', message: 'x' } });
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user);
    await runOutWindow();
    expect(await screen.findByText("Couldn't log the dose. Please try again.")).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Gave a dose of Ibuprofen' })).toBeInTheDocument();
  });

  it('an AMBIGUOUS failure (network/5xx) is retried ONCE with the SAME client_request_id', async () => {
    mockApi();
    post
      .mockRejectedValueOnce({ success: false, error: { code: 'SERVER_ERROR' } })
      .mockResolvedValueOnce({
        success: true,
        data: { dose: { id: 'd1' }, summary: { last_dose: null }, replayed: true },
      });
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user);
    await runOutWindow();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(postedBody(1).client_request_id).toBe(postedBody(0).client_request_id);
    expect(await screen.findByText('Dose logged')).toBeInTheDocument();
  });

  it('a stopped medication: its own sentence (a retry can never work)', async () => {
    mockApi();
    post.mockRejectedValue({ success: false, error: { code: 'MEDICATION_DISCONTINUED' } });
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user);
    await runOutWindow();
    expect(
      await screen.findByText('This medication is inactive. Reactivate it to log a dose.')
    ).toBeInTheDocument();
  });

  it('403 VIEW_ONLY at write time: permission toast + the access flags are refreshed', async () => {
    mockApi();
    post.mockRejectedValue({ success: false, error: { code: 'VIEW_ONLY' } });
    const { queryClient } = renderHome();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    await openAndLog(user);
    await runOutWindow();
    expect(
      await screen.findByText("You have view-only access, so you can't log doses.")
    ).toBeInTheDocument();
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify((f as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['circles']));
    expect(keys).toContain(JSON.stringify(['circle', CIRCLE_ID]));
  });
});

describe('coordination: "Jennie logged a dose 1 minute ago. Log another?"', () => {
  const conflict = {
    success: false,
    error: {
      code: 'AS_NEEDED_DOSE_RECENTLY_LOGGED',
      message: 'recent',
      latest_dose: {
        id: 'dose-jennie',
        given_at: '2026-06-12T15:59:00Z', // 1 minute before NOW
        given_by: { first_name: 'Jennie' },
      },
    },
  };

  it('409 after the undo window: the SAME dose is offered again, and "Log another" replays it with acknowledge_recent and the SAME client_request_id', async () => {
    mockApi();
    post.mockRejectedValueOnce(conflict).mockResolvedValueOnce({
      success: true,
      data: { dose: { id: 'd2' }, summary: { last_dose: lastDose({ id: 'd2' }) } },
    });
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user, 'second one');
    await runOutWindow();

    const prompt = await screen.findByRole('dialog', { name: 'Jennie just logged a dose' });
    expect(prompt).toHaveTextContent('Jennie logged Ibuprofen 1 minute ago, at 11:59 AM. Do you want to log another one?');
    // Nothing was written: the first POST was refused.
    expect(post).toHaveBeenCalledTimes(1);

    await user.click(within(prompt).getByRole('button', { name: 'Log another dose' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    const first = postedBody(0);
    const second = postedBody(1);
    expect(second.acknowledge_recent).toBe(true);
    expect(second.client_request_id).toBe(first.client_request_id);
    expect(second.note).toBe('second one');
    expect('acknowledge_recent' in first).toBe(false);
    expect(await screen.findByText('Dose logged')).toBeInTheDocument();
  });

  it('"No, that was it": nothing more is sent, and the dose is not logged', async () => {
    mockApi();
    post.mockRejectedValue(conflict);
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user);
    await runOutWindow();

    const prompt = await screen.findByRole('dialog', { name: 'Jennie just logged a dose' });
    await user.click(within(prompt).getAllByRole('button', { name: 'No, that was it' })[0]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Dose logged')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Gave a dose of Ibuprofen' })).toBeInTheDocument();
  });

  it('the card ALREADY shows Jennie\'s dose from 10 min ago: ask BEFORE the log dialog, and send acknowledge_recent', async () => {
    mockApi({
      summaries: {
        [MED]: { last_dose: lastDose({ id: 'dose-jennie', given_at: '2026-06-12T15:50:00Z' }) },
      },
    });
    post.mockResolvedValue({ success: true, data: { dose: { id: 'd3' }, summary: { last_dose: null } } });
    renderHome();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Gave a dose of Ibuprofen' }));
    const prompt = await screen.findByRole('dialog', { name: 'Jennie just logged a dose' });
    expect(prompt).toHaveTextContent('10 minutes ago');
    // The log dialog has NOT opened yet.
    expect(screen.queryByRole('dialog', { name: 'Log a dose of Ibuprofen?' })).toBeNull();

    await user.click(within(prompt).getByRole('button', { name: 'Log another dose' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log dose' }));
    await runOutWindow();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    const body = postedBody();
    expect(body.acknowledge_recent).toBe(true);
    // What THIS client showed — so the server does not prompt for a dose it saw.
    expect(body.known_last_dose_id).toBe('dose-jennie');
  });

  it('your OWN recent dose never prompts', async () => {
    mockApi({
      summaries: {
        [MED]: {
          last_dose: lastDose({
            given_at: '2026-06-12T15:55:00Z',
            given_by: { id: 'me', first_name: 'Me', last_name: null },
          }),
        },
      },
    });
    renderHome();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gave a dose of Ibuprofen' }));
    expect(await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /just logged a dose/ })).toBeNull();
  });

  it('Jennie\'s dose from 2 hours ago does not prompt either', async () => {
    mockApi({ summaries: { [MED]: { last_dose: lastDose() } } });
    renderHome();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Gave a dose of Ibuprofen' }));
    expect(await screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' })).toBeInTheDocument();
  });
});

describe('the log dialog: "Given" presets (Now, 15/30 min, 1/2/4/8 h ago)', () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: 'Gave a dose of Ibuprofen' }));
    return screen.findByRole('dialog', { name: 'Log a dose of Ibuprofen?' });
  }

  it('offers exactly the seven presets, Now selected, and the recipient-zone clock', async () => {
    mockApi();
    renderHome();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const labels = within(dialog)
      .getAllByRole('radio')
      .map((b) => b.textContent)
      .filter((t) => /^(Now|\d+ (min|h) ago)$/.test(t ?? ''));
    expect(labels).toEqual(['Now', '15 min ago', '30 min ago', '1 h ago', '2 h ago', '4 h ago', '8 h ago']);
    expect(within(dialog).getByTestId('log-dose-when')).toHaveTextContent('12:00 PM');
    expect(dialog).toHaveTextContent('200 mg · Everyone in the circle will see this.');
  });

  it('the given-at time is a polite live region that stays mounted as the chip changes', async () => {
    mockApi();
    renderHome();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const when = within(dialog).getByTestId('log-dose-when');
    expect(when).toHaveAttribute('role', 'status');
    await user.click(within(dialog).getByRole('radio', { name: '2 h ago' }));
    // Same node, new text: an update a screen reader announces.
    expect(within(dialog).getByTestId('log-dose-when')).toBe(when);
    expect(when).toHaveTextContent('10:00 AM');
  });

  it('"2 h ago" sends the instant two hours back; "Now" omits given_at', async () => {
    mockApi();
    post.mockResolvedValue({ success: true, data: { dose: { id: 'd' }, summary: { last_dose: null } } });
    renderHome();
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('radio', { name: '2 h ago' }));
    expect(within(dialog).getByTestId('log-dose-when')).toHaveTextContent('10:00 AM');
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log dose' }));
    await runOutWindow();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(postedBody().given_at).toBe('2026-06-12T14:00:00.000Z');
  });

  it('every OPEN mints its own client_request_id (a new dose is not a replay of the last)', async () => {
    mockApi();
    post.mockResolvedValue({ success: true, data: { dose: { id: 'd' }, summary: { last_dose: null } } });
    renderHome();
    const user = userEvent.setup();
    await openAndLog(user);
    await runOutWindow();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await screen.findByText('Dose logged');
    await openAndLog(user);
    await runOutWindow();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(postedBody(0).client_request_id).not.toBe(postedBody(1).client_request_id);
  });
});

describe('Spanish', () => {
  it('section, card, dialog and prompt render in Spanish (Latin American)', async () => {
    await i18n.changeLanguage('es');
    mockApi({ summaries: { [MED]: { last_dose: lastDose({ given_at: '2026-06-12T15:50:00Z' }) } } });
    renderHome();
    const user = userEvent.setup();

    expect(await screen.findByRole('heading', { name: 'Según se necesite' })).toBeInTheDocument();
    expect((await screen.findByTestId('as-needed-last-given')).textContent).toBe(
      'Última dosis 11:50 a. m. por Jennie'
    );
    await user.click(screen.getByRole('button', { name: 'Di una dosis de Ibuprofen' }));
    const prompt = await screen.findByRole('dialog', { name: 'Jennie acaba de registrar una dosis' });
    expect(prompt).toHaveTextContent('registró Ibuprofen hace 10 minutos (a las 11:50 a. m.). ¿Quieres registrar otra?');
    await user.click(within(prompt).getByRole('button', { name: 'Registrar otra dosis' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Registrar una dosis de Ibuprofen?' });
    expect(within(dialog).getByRole('button', { name: 'Registrar dosis' })).toBeInTheDocument();
  });
});

describe('Home section: eyebrow and the 3-row cap (mobile parity)', () => {
  const four = [
    prnRow({ id: 'p1', title: 'Ibuprofen', medication_name: 'Ibuprofen' }),
    prnRow({ id: 'p2', title: 'Tylenol', medication_name: 'Tylenol' }),
    prnRow({ id: 'p3', title: 'Melatonin', medication_name: 'Melatonin' }),
    prnRow({ id: 'p4', title: 'Tums', medication_name: 'Tums' }),
  ];

  it('the eyebrow is the MOST RECENT dose across the medications, in the recipient zone — never a count', async () => {
    mockApi({
      events: four.slice(0, 2),
      summaries: {
        p1: { last_dose: lastDose({ given_at: '2026-06-12T13:15:00Z' }) },
        p2: { last_dose: lastDose({ id: 'x', given_at: '2026-06-12T14:40:00Z' }) },
      },
    });
    renderHome();
    expect((await screen.findByTestId('as-needed-eyebrow')).textContent).toBe('Last given 10:40 AM');
  });

  it('no doses at all: "No doses yet"; and nothing is claimed before the summary answers', async () => {
    mockApi({ events: four.slice(0, 1), summaries: {} });
    renderHome();
    expect((await screen.findByTestId('as-needed-eyebrow')).textContent).toBe('No doses yet');
  });

  it('shows 3 cards and "1 more as needed" linking to the Medications tab', async () => {
    mockApi({ events: four, summaries: {} });
    renderHome();
    await screen.findByTestId('as-needed-eyebrow');
    expect(screen.getAllByTestId('as-needed-card')).toHaveLength(3);
    expect(screen.queryByText('Tylenol')).toBeNull(); // rows are name-sorted: the 4th is Tylenol
    const more = screen.getByTestId('as-needed-more');
    expect(more).toHaveTextContent('1 more as needed');
    expect(more).toHaveAttribute('href', `/circles/${CIRCLE_ID}/meds`);
  });

  it('exactly 3 medications: no overflow link', async () => {
    mockApi({ events: four.slice(0, 3), summaries: {} });
    renderHome();
    await screen.findByTestId('as-needed-eyebrow');
    expect(screen.getAllByTestId('as-needed-card')).toHaveLength(3);
    expect(screen.queryByTestId('as-needed-more')).toBeNull();
  });
});
