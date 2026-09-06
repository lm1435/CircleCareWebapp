// Plan Task 48 — TodaysMeds + ConfirmMedDialog: status rendering, confirm
// flow, skip-with-note flow, can_edit=false gating + banners, permission
// (402/403) toast handling.
//
// Time is pinned two ways so tests never depend on the dev machine
// (America/Denver):
// - vi.useFakeTimers({ toFake: ['Date'] }) freezes "now" (setTimeout stays
//   real so React Testing Library and userEvent work normally).
// - Intl.resolvedOptions is spied to America/New_York (same pattern as
//   src/utils/__tests__/timezone.test.ts) — only getDeviceTimezone reads it.

import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { ToastProvider } from '@/components/ui';
import { TodaysMeds } from '@/components/meds/TodaysMeds';
import { MEDICATION_UNDO_DELAY_MS } from '@/components/meds/useMedicationUndo';
import type { Circle } from '@/api/circles';
import type { TodaysMedication } from '@/api/medicationConfirmations';

// The viewer's 12h/24h clock. The real hook resolves off the shared currentUser
// query (unmocked here) and would otherwise fall through to the runner's
// navigator.language — pin it so the scheduled-time labels are deterministic.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const mockedGet = apiClient.get as unknown as Mock;
const mockedPost = apiClient.post as unknown as Mock;

const CIRCLE_ID = 'circle-1';
const TZ = 'America/New_York';
// 2026-06-12T16:00:00Z = 12:00 PM ET → "today" in the recipient TZ is 2026-06-12.
const NOW = new Date('2026-06-12T16:00:00Z');
const TODAY = '2026-06-12';
// The widget asks for yesterday too, for its Needs Attention group.
const YESTERDAY = '2026-06-11';

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

function makeMed(overrides: Partial<TodaysMedication>): TodaysMedication {
  return {
    id: 'med-x',
    event_type: 'medication',
    title: 'Medication',
    medication_name: null,
    medication_dosage: null,
    scheduled_date: TODAY,
    scheduled_time: '08:00:00',
    confirmation: null,
    ...overrides,
  };
}

const DEFAULT_MEDS: TodaysMedication[] = [
  makeMed({
    id: 'med-1',
    medication_name: 'Lisinopril',
    scheduled_time: '08:00:00',
    confirmation: { status: 'taken', confirmed_at: '2026-06-12T12:05:00Z', confirmed_by: 'u1' },
  }),
  makeMed({
    id: 'med-2',
    medication_name: 'Metformin',
    scheduled_time: '09:00:00',
    confirmation: { status: 'skipped', confirmed_at: '2026-06-12T13:00:00Z', confirmed_by: 'u1' },
  }),
  // 10:00 ET is before the pinned 12:00 ET "now" → past due, unconfirmed → Not confirmed
  makeMed({ id: 'med-3', medication_name: 'Atorvastatin', scheduled_time: '10:00:00' }),
  // 1:00 PM ET is one hour after the pinned 12:00 ET "now" — not yet due, but
  // INSIDE the 2h early-confirm window, so it is answerable and reads
  // "Due soon". (It used to be a 20:00 dose: eight hours out, and web offered
  // Confirm on it. That is the falsified-adherence bug this file now pins.)
  makeMed({
    id: 'med-4',
    medication_name: 'Levothyroxine',
    medication_dosage: '50 mcg',
    scheduled_time: '13:00:00',
  }),
];

function mockApi({
  circles = [makeCircle()],
  events = DEFAULT_MEDS,
  yesterdayEvents = [],
}: {
  circles?: Circle[];
  events?: TodaysMedication[];
  /** Yesterday's doses — the Needs Attention group's source. Empty by default. */
  yesterdayEvents?: TodaysMedication[];
} = {}): void {
  // Routed by date. The widget makes TWO events calls (today and yesterday) and
  // the real endpoint is date-scoped, so a mock that answers both with the same
  // list would render every dose twice — once per group.
  mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
    if (url === '/circles') {
      return Promise.resolve({ success: true, data: { circles } });
    }
    if (url === `/circles/${CIRCLE_ID}`) {
      return Promise.resolve({
        success: true,
        data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
      });
    }
    if (url === `/circles/${CIRCLE_ID}/events`) {
      const forYesterday = config?.params?.start_date === YESTERDAY;
      return Promise.resolve({
        success: true,
        data: { events: forYesterday ? yesterdayEvents : events },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderWidget(): { queryClient: QueryClient; unmount: () => void } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { unmount } = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TodaysMeds circleId={CIRCLE_ID} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { queryClient, unmount };
}

function medRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (!row) throw new Error(`list item for ${name} not found`);
  return row;
}

/**
 * A dose card renders its Take/Skip pair TWICE by design (spec §4.6): once
 * inline at the end of the meta line, once stacked in its own row for a card
 * narrower than 360px. Container queries hide whichever is not in play, so in a
 * REAL browser exactly one is visible and in the accessibility tree — but jsdom
 * applies no stylesheet, so both are found here. Every action assertion goes
 * through this, and the length check pins the pair count so a regression that
 * dropped one of the two layouts would still fail.
 *
 * The buttons are queried BY THE MEDICATION THEY ANSWER ("Confirm Metformin"),
 * which is also the assertion that they carry that name at all: a day of doses
 * offering four identically-named "Confirm" buttons is how a screen-reader user
 * answers the wrong drug.
 */
function medOf(row: HTMLElement): string {
  const name = row.querySelector('p')?.textContent;
  if (!name) throw new Error('row has no medication name');
  return name;
}

function action(row: HTMLElement, verb: 'Confirm' | 'Skip'): HTMLElement {
  const buttons = within(row).getAllByRole('button', { name: `${verb} ${medOf(row)}` });
  expect(buttons).toHaveLength(2);
  return buttons[0];
}

function hasAction(row: HTMLElement, verb: 'Confirm' | 'Skip'): boolean {
  return within(row).queryAllByRole('button', { name: `${verb} ${medOf(row)}` }).length > 0;
}

beforeEach(() => {
  mockUseHourCycle.mockReturnValue('12h');
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/New_York',
  } as Intl.ResolvedDateTimeFormatOptions);
  mockedGet.mockReset();
  mockedPost.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('TodaysMeds', () => {
  it('renders today\'s medications with times and status badges', async () => {
    mockApi();
    renderWidget();

    expect(await screen.findByText('Lisinopril')).toBeInTheDocument();

    // Fetch uses "today" computed in the care recipient's timezone
    expect(mockedGet).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/events`, {
      params: { start_date: TODAY, end_date: TODAY, event_type: 'medication' },
    });

    // Status badges per state
    expect(within(medRow('Lisinopril')).getByText('Taken')).toBeInTheDocument();
    expect(within(medRow('Metformin')).getByText('Skipped')).toBeInTheDocument();
    expect(within(medRow('Atorvastatin')).getByText('Not confirmed')).toBeInTheDocument();
    expect(within(medRow('Levothyroxine')).getByText('Due soon')).toBeInTheDocument();

    // Scheduled time shown (care recipient TZ, same as pinned device TZ) — and
    // because those match, NO zone label: this row is the one that used to read
    // "1:00 PM ET" to a caregiver already standing in New York.
    expect(within(medRow('Levothyroxine')).getByText('1:00 PM')).toBeInTheDocument();
    expect(screen.getByText('50 mcg')).toBeInTheDocument();

    // Confirm/skip only on unconfirmed meds (not-confirmed + pending) — two
    // answerable doses, each carrying the inline AND stacked copy of the pair,
    // and each pair named after ITS medication.
    expect(screen.getAllByRole('button', { name: /^Confirm / })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: /^Skip / })).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Confirm Atorvastatin' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Skip Levothyroxine' })).toHaveLength(2);
    // A bare "Confirm" names nothing — the failure this labelling exists to stop.
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
    expect(within(medRow('Lisinopril')).queryByRole('button')).not.toBeInTheDocument();
  });

  // A dose of a medication that was stopped LATER THE SAME DAY. This widget
  // fetches through the calendar events endpoint with no `includeDiscontinued`,
  // so the backend only sends it because the dose was genuinely DUE — it stays
  // answerable. Suppressing the buttons here is what left a dose really given
  // but not yet logged permanently unloggable, and permanently counted missed
  // in the clinician-facing adherence report.
  it('keeps Confirm/Skip on a dose of an INACTIVE medication, and marks it Inactive in text', async () => {
    mockApi({
      events: [
        makeMed({
          id: 'med-inactive',
          medication_name: 'Warfarin',
          scheduled_time: '10:00:00',
          discontinued_at: '2026-06-12T15:00:00Z',
        }),
      ],
    });
    renderWidget();

    expect(await screen.findByText('Warfarin')).toBeInTheDocument();
    const row = medRow('Warfarin');
    // The state is still conveyed in TEXT (WCAG 2.1 AA 1.4.1) — only the
    // actionability changed.
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
    expect(action(row, 'Confirm')).toBeInTheDocument();
    expect(action(row, 'Skip')).toBeInTheDocument();
  });

  // ==========================================================================
  // CONFIRM WINDOW — `isDoseConfirmable`, the predicate ported from mobile.
  // This widget used to offer Confirm on ANY unanswered dose of the current
  // day, so at noon a web user could mark the 8 PM dose taken and write a
  // falsified row into the clinician-facing adherence report. The pair now
  // opens DOSE_EARLY_CONFIRM_WINDOW_MINUTES (2h) before the scheduled moment.
  // ==========================================================================
  describe('an auto-missed dose still asks', () => {
    // The reminder cron writes `missed` when nobody answered in time — that is
    // the SYSTEM recording silence, not a caregiver saying the dose was skipped.
    // The dose may really have been given, so this widget must still offer the
    // pair. It used to gate on a bare `!confirmation`, so the only way to correct
    // an auto-missed dose was to hunt it down on the calendar.
    it('offers Confirm/Skip on a dose the cron marked missed', async () => {
      mockApi({
        events: [
          makeMed({
            id: 'auto-missed',
            medication_name: 'Levothyroxine',
            scheduled_time: '11:00:00', // already past at the pinned 12:00 ET now
            confirmation: {
              status: 'missed',
              confirmed_at: '2026-06-12T15:30:00Z',
              confirmed_by: 'cron',
            },
          }),
        ],
      });
      renderWidget();

      await screen.findByText('Levothyroxine');
      const row = medRow('Levothyroxine');
      expect(action(row, 'Confirm')).toBeInTheDocument();
      expect(action(row, 'Skip')).toBeInTheDocument();
    });

    it('does NOT ask again once a human answered', async () => {
      mockApi({
        events: [
          makeMed({
            id: 'human-answered',
            medication_name: 'Levothyroxine',
            scheduled_time: '11:00:00',
            confirmation: {
              status: 'taken',
              confirmed_at: '2026-06-12T15:30:00Z',
              confirmed_by: 'u1',
            },
          }),
        ],
      });
      renderWidget();

      await screen.findByText('Levothyroxine');
      const row = medRow('Levothyroxine');
      expect(hasAction(row, 'Confirm')).toBe(false);
      expect(hasAction(row, 'Skip')).toBe(false);
    });
  });

  describe('confirm window', () => {
    it('hides Confirm/Skip on a dose more than 2h out and calls it Upcoming', async () => {
      mockApi({
        events: [
          makeMed({ id: 'far', medication_name: 'Levothyroxine', scheduled_time: '20:00:00' }),
        ],
      });
      renderWidget();

      await screen.findByText('Levothyroxine');
      const row = medRow('Levothyroxine');
      expect(within(row).getByText('Upcoming')).toBeInTheDocument();
      expect(hasAction(row, 'Confirm')).toBe(false);
      expect(hasAction(row, 'Skip')).toBe(false);
    });

    it('shows the pair exactly at scheduled_time − 2h, and not a minute earlier', async () => {
      // "Now" is 12:00 PM ET, so the boundary dose is 14:00 and 14:01 is out.
      mockApi({
        events: [
          makeMed({ id: 'edge-in', medication_name: 'Boundary', scheduled_time: '14:00:00' }),
          makeMed({ id: 'edge-out', medication_name: 'JustOutside', scheduled_time: '14:01:00' }),
        ],
      });
      renderWidget();

      await screen.findByText('Boundary');
      const inWindow = medRow('Boundary');
      expect(within(inWindow).getByText('Due soon')).toBeInTheDocument();
      expect(action(inWindow, 'Confirm')).toBeInTheDocument();

      const outside = medRow('JustOutside');
      expect(within(outside).getByText('Upcoming')).toBeInTheDocument();
      expect(hasAction(outside, 'Confirm')).toBe(false);
    });

    it('keeps the pair on an overdue dose earlier today', async () => {
      mockApi({
        events: [makeMed({ id: 'late', medication_name: 'Atorvastatin', scheduled_time: '08:00:00' })],
      });
      renderWidget();

      await screen.findByText('Atorvastatin');
      const row = medRow('Atorvastatin');
      expect(within(row).getByText('Not confirmed')).toBeInTheDocument();
      expect(action(row, 'Confirm')).toBeInTheDocument();
    });

    // The window is measured in the CARE RECIPIENT's timezone, never the
    // viewer's device (the dev machine is America/Denver). Same instant, same
    // dose, opposite answers — so this widget is re-rendered against a circle
    // whose recipient lives in Denver while everything else is unchanged.
    it('measures the window in the care recipient timezone, not the device', async () => {
      // 12:00 PM in New York is 10:00 AM in Denver: a 13:00 dose is 1h away for
      // a New York recipient (open) and 3h away for a Denver one (closed).
      mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
        if (url === '/circles') {
          return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
        }
        if (url === `/circles/${CIRCLE_ID}`) {
          return Promise.resolve({
            success: true,
            data: { circle: { id: CIRCLE_ID, care_recipient_timezone: 'America/Denver' } },
          });
        }
        if (url === `/circles/${CIRCLE_ID}/events`) {
          // Yesterday is empty here; this case is only about the confirm window.
          if (config?.params?.start_date === YESTERDAY) {
            return Promise.resolve({ success: true, data: { events: [] } });
          }
          return Promise.resolve({
            success: true,
            data: {
              events: [
                makeMed({ id: 'tz', medication_name: 'Lisinopril', scheduled_time: '13:00:00' }),
              ],
            },
          });
        }
        return Promise.reject(new Error(`unexpected GET ${url}`));
      });
      renderWidget();

      await screen.findByText('Lisinopril');
      const row = medRow('Lisinopril');
      expect(within(row).getByText('Upcoming')).toBeInTheDocument();
      expect(hasAction(row, 'Confirm')).toBe(false);
    });
  });

  it('renders the empty state when there are no medications today', async () => {
    mockApi({ events: [] });
    renderWidget();

    expect(
      await screen.findByText(
        "No medications scheduled today. Add them from the calendar so the whole circle knows what's needed and when."
      )
    ).toBeInTheDocument();
  });

  it('shows an error with retry that refetches', async () => {
    let failEvents = true;
    mockedGet.mockImplementation((url: string) => {
      if (url === '/circles') {
        return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
      }
      if (url === `/circles/${CIRCLE_ID}`) {
        return Promise.resolve({
          success: true,
          data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
        });
      }
      if (url === `/circles/${CIRCLE_ID}/events`) {
        return failEvents
          ? Promise.reject({ success: false, error: { code: 'SERVER_ERROR' } })
          : Promise.resolve({ success: true, data: { events: DEFAULT_MEDS } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderWidget();

    expect(await screen.findByText("Couldn't load today's medications")).toBeInTheDocument();

    failEvents = false;
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Lisinopril')).toBeInTheDocument();
  });

  // ==========================================================================
  // THE UNDO WINDOW (mobile parity — useMedicationUndo).
  //
  // Take/Skip no longer open a dialog that asks the caregiver to re-state the
  // thing they just clicked. The row answers optimistically, swaps its pair for
  // an UndoBadge, and the POST only leaves once the 5-second window closes.
  // `setTimeout` is faked ONLY in this block (the file-wide fake clock covers
  // `Date` alone, so RTL and userEvent behave normally everywhere else).
  // ==========================================================================
  describe('answering a dose', () => {
    /**
     * Answer a dose with `setTimeout` faked, so the 5-second window can be run
     * forward instead of waited out.
     *
     * The fake clock has to be in place BEFORE the click — that click is what
     * arms the timer — and it has to be gone again before any `waitFor` /
     * `findBy*`, which poll on a real one (and before React Query's own
     * scheduling), or the test hangs. Hence the pair: `answer()` opens the
     * faked span, `runOutWindow()` closes it. `fireEvent` rather than
     * `userEvent` for the same reason — userEvent schedules its own timers.
     */
    function answer(row: HTMLElement, name: 'Confirm' | 'Skip') {
      const button = action(row, name);
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
      fireEvent.click(button);
    }

    async function runOutWindow() {
      await act(async () => {
        vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
      });
      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    }

    it('marks taken optimistically and POSTs once the undo window closes', async () => {
      mockApi();
      mockedPost.mockResolvedValue({
        success: true,
        data: { confirmation: { id: 'conf-1', event_id: 'med-4', status: 'taken' } },
      });
      renderWidget();

      await screen.findByText('Levothyroxine');
      answer(medRow('Levothyroxine'), 'Confirm');

      // The badge replaces the pair immediately, and NOTHING has been sent.
      const row = medRow('Levothyroxine');
      expect(
        within(row).getByRole('button', { name: 'Undo Levothyroxine' })
      ).toBeInTheDocument();
      expect(hasAction(row, 'Confirm')).toBe(false);
      expect(mockedPost).not.toHaveBeenCalled();

      await runOutWindow();

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/medications/confirm`, {
          event_id: 'med-4',
          status: 'taken',
          scheduled_time: '13:00:00',
        });
      });
      expect(await screen.findByText('Marked as taken')).toBeInTheDocument();
    });

    it('skips a medication', async () => {
      mockApi();
      mockedPost.mockResolvedValue({
        success: true,
        data: { confirmation: { id: 'conf-2', event_id: 'med-4', status: 'skipped' } },
      });
      renderWidget();

      await screen.findByText('Levothyroxine');
      answer(medRow('Levothyroxine'), 'Skip');

      await runOutWindow();

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/medications/confirm`, {
          event_id: 'med-4',
          status: 'skipped',
          scheduled_time: '13:00:00',
        });
      });
    });

    // The whole point of the window: nothing is sent, so there is nothing to
    // reverse. A dose answered by mistake goes back to asking.
    it('sends nothing at all when Undo is pressed inside the window', async () => {
      mockApi();
      renderWidget();

      await screen.findByText('Levothyroxine');
      answer(medRow('Levothyroxine'), 'Confirm');
      fireEvent.click(
        within(medRow('Levothyroxine')).getByRole('button', { name: 'Undo Levothyroxine' })
      );

      await runOutWindow();

      expect(mockedPost).not.toHaveBeenCalled();
      // ...and the dose is asking again.
      expect(action(medRow('Levothyroxine'), 'Confirm')).toBeInTheDocument();
    });

    // Leaving the page inside the window must not silently drop the answer:
    // the UI already said "Taken", and an unsent confirmation is later
    // auto-missed by the reminder cron.
    it('flushes a still-pending answer on unmount', async () => {
      mockApi();
      mockedPost.mockResolvedValue({
        success: true,
        data: { confirmation: { id: 'conf-3', event_id: 'med-4', status: 'taken' } },
      });
      const { unmount } = renderWidget();

      await screen.findByText('Levothyroxine');
      answer(medRow('Levothyroxine'), 'Confirm');
      expect(mockedPost).not.toHaveBeenCalled();

      vi.useFakeTimers({ toFake: ['Date'], now: NOW });
      unmount();

      await waitFor(() => {
        expect(mockedPost).toHaveBeenCalledWith(`/circles/${CIRCLE_ID}/medications/confirm`, {
          event_id: 'med-4',
          status: 'taken',
          scheduled_time: '13:00:00',
        });
      });
    });
  });

  it('hides confirm/skip and shows the view-only banner when can_edit is false (view_only)', async () => {
    mockApi({
      circles: [makeCircle({ can_edit: false, view_only: true, access_level: 'view' })],
    });
    renderWidget();

    expect(await screen.findByText('Levothyroxine')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Skip / })).not.toBeInTheDocument();
    expect(
      screen.getByText('View-only — you can see everything, but changes are off.')
    ).toBeInTheDocument();
  });

  it('shows the owner read-only banner when the circle is read_only', async () => {
    mockApi({
      circles: [makeCircle({ can_edit: false, read_only: true, role: 'owner' })],
    });
    renderWidget();

    expect(await screen.findByText('Levothyroxine')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm / })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Your subscription ended, so this circle is view-only for now. Everything is saved — re-subscribe to pick up where you left off.'
      )
    ).toBeInTheDocument();
  });

  it('shows the member read-only banner when a member views a read_only circle', async () => {
    mockApi({
      circles: [makeCircle({ can_edit: false, read_only: true, role: 'member' })],
    });
    renderWidget();

    expect(await screen.findByText('Levothyroxine')).toBeInTheDocument();
    expect(
      screen.getByText(
        "This circle is view-only right now because the owner's subscription ended. Everything is still here to see, and editing comes back if the owner re-subscribes."
      )
    ).toBeInTheDocument();
  });

  it('shows a permission toast and refetches circles when the backend rejects with 402/403', async () => {
    mockApi();
    // The api client rejects with the backend envelope (requireCircleEditAccess).
    mockedPost.mockRejectedValue({
      success: false,
      error: { code: 'SUBSCRIPTION_REQUIRED', message: 'This circle requires a subscription' },
    });
    renderWidget();

    await screen.findByText('Levothyroxine');
    const circlesCallsBefore = mockedGet.mock.calls.filter(([url]) => url === '/circles').length;

    // Same trick as the block above: `setTimeout` is faked across the click
    // that arms the undo window and the advance that closes it, then restored
    // so the assertions below can poll on a real clock.
    const take = action(medRow('Levothyroxine'), 'Confirm');
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW });
    fireEvent.click(take);
    await act(async () => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });

    expect(
      await screen.findByText("You don't have permission to confirm medications in this circle.")
    ).toBeInTheDocument();

    // The optimistic badge is withdrawn and circle access flags refetch.
    await waitFor(() => {
      expect(
        within(medRow('Levothyroxine')).queryByRole('button', { name: 'Undo Levothyroxine' })
      ).not.toBeInTheDocument();
    });
    await waitFor(() => {
      const circlesCallsAfter = mockedGet.mock.calls.filter(([url]) => url === '/circles').length;
      expect(circlesCallsAfter).toBeGreaterThan(circlesCallsBefore);
    });
  });

  it('caps the list at `limit` and toggles the rest in place', async () => {
    mockApi(); // 4 meds
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <TodaysMeds circleId={CIRCLE_ID} limit={2} />
        </ToastProvider>
      </QueryClientProvider>
    );

    // The two doses still WAITING ON A CAREGIVER are the two that render.
    //
    // This assertion used to read the other way round — "the first two by
    // time" — which, on this fixture, meant the collapsed card showed
    // Lisinopril (taken) and Metformin (skipped) and hid BOTH outstanding
    // doses behind the toggle. The test was pinning the bug: a control whose
    // whole job is tidying away the tail was tidying away the only rows with
    // anything to do. Answered doses are still kept, just never ahead of one
    // that is outstanding.
    expect(await screen.findByText('Atorvastatin')).toBeInTheDocument();
    expect(screen.getByText('Levothyroxine')).toBeInTheDocument();
    expect(screen.queryByText('Lisinopril')).not.toBeInTheDocument();
    expect(screen.queryByText('Metformin')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show all 4' }));
    expect(screen.getByText('Lisinopril')).toBeInTheDocument();
    expect(screen.getByText('Metformin')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.queryByText('Lisinopril')).not.toBeInTheDocument();
  });

  // ── Needs Attention (yesterday) ────────────────────────────────────────
  //
  // Mobile has surfaced yesterday's unanswered doses since it shipped. Web had
  // no equivalent: the card asks for TODAY, so at midnight a dose nobody
  // answered stopped existing on the surface a caregiver is most likely to be
  // looking at. These pin the group and the one predicate it turns on.
  describe('Needs Attention', () => {
    const yesterdayDose = (over: Partial<TodaysMedication> = {}) =>
      makeMed({
        id: 'y-1',
        medication_name: 'Warfarin',
        scheduled_date: YESTERDAY,
        scheduled_time: '08:00:00',
        ...over,
      });

    it('surfaces a dose from yesterday that nobody answered', async () => {
      mockApi({ events: [], yesterdayEvents: [yesterdayDose()] });
      renderWidget();

      expect(await screen.findByText('Needs attention')).toBeInTheDocument();
      expect(screen.getByText('Warfarin')).toBeInTheDocument();
    });

    // The cron writing 'missed' is it recording that nobody replied — not a
    // reply. The dose may well have been given and simply not logged.
    it("KEEPS an auto-missed dose — the cron missed it, nobody answered", async () => {
      mockApi({
        events: [],
        yesterdayEvents: [
          yesterdayDose({
            // The cron writes the row; `confirmed_by` names the job, not a person.
            confirmation: {
              status: 'missed',
              confirmed_at: '2026-06-12T05:00:00Z',
              confirmed_by: 'system',
            },
          }),
        ],
      });
      renderWidget();

      expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    });

    it('drops a dose a caregiver actually answered', async () => {
      mockApi({
        events: DEFAULT_MEDS,
        yesterdayEvents: [
          yesterdayDose({
            confirmation: { status: 'taken', confirmed_at: '2026-06-11T13:00:00Z', confirmed_by: 'u1' },
          }),
        ],
      });
      renderWidget();

      await screen.findByText('Atorvastatin');
      expect(screen.queryByText('Needs attention')).not.toBeInTheDocument();
    });

    // An empty day is not empty when yesterday still owes an answer.
    it('does not claim the card is empty while yesterday is outstanding', async () => {
      mockApi({ events: [], yesterdayEvents: [yesterdayDose()] });
      renderWidget();

      expect(await screen.findByText('Warfarin')).toBeInTheDocument();
      // MATCHED BY PREFIX, against the real string. This queried
      // 'No medications scheduled for today' — copy that appears nowhere in the
      // app (`meds:empty` reads "No medications scheduled today. Add them from
      // the calendar…"), and `queryByText` with a string is an EXACT full-text
      // match, so the assertion was inert in every state: it passed whether the
      // empty copy was on screen or not.
      expect(screen.queryByText(/^No medications scheduled today/)).not.toBeInTheDocument();
    });

    it('caps the group and toggles the rest in place', async () => {
      mockApi({
        events: [],
        yesterdayEvents: [
          yesterdayDose({ id: 'y-1', medication_name: 'Warfarin', scheduled_time: '08:00:00' }),
          yesterdayDose({ id: 'y-2', medication_name: 'Digoxin', scheduled_time: '09:00:00' }),
          yesterdayDose({ id: 'y-3', medication_name: 'Furosemide', scheduled_time: '10:00:00' }),
        ],
      });
      const user = userEvent.setup();
      renderWidget();

      expect(await screen.findByText('Warfarin')).toBeInTheDocument();
      expect(screen.getByText('Digoxin')).toBeInTheDocument();
      expect(screen.queryByText('Furosemide')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Show all 3' }));
      expect(screen.getByText('Furosemide')).toBeInTheDocument();
    });
  });
});
