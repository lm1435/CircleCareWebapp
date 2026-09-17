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
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import '@/i18n';
import { apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { todaysMedsKey } from '@/hooks/useMedConfirmation';
import { useCreateEvent } from '@/hooks/useCalendarEvents';
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

// The first-run "Add a medication" door opens the shared AddEventModal — stub
// it and assert the sentinel, not the real form.
vi.mock('@/components/calendar/AddEventModal', () => ({
  AddEventModal: ({ initialType }: { initialType?: string }) => (
    <div data-testid="add-event-modal">{initialType}</div>
  ),
}));

// Partial mock: the confirm flow underneath still calls other Analytics
// members (medicationConfirmed, errorOccurred), so only the CTA event is
// swapped for a spy.
const homeEmptyCtaTapped = vi.fn();
vi.mock('@/lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analytics')>();
  return {
    ...actual,
    Analytics: {
      ...actual.Analytics,
      homeEmptyCtaTapped: (...args: unknown[]) => homeEmptyCtaTapped(...args),
    },
  };
});

const mockedGet = apiClient.get as unknown as Mock;
const mockedPost = apiClient.post as unknown as Mock;

const CIRCLE_ID = 'circle-1';
const TZ = 'America/New_York';
// 2026-06-12T16:00:00Z = 12:00 PM ET → "today" in the recipient TZ is 2026-06-12.
const NOW = new Date('2026-06-12T16:00:00Z');
const TODAY = '2026-06-12';
// The widget asks for yesterday too, for its Needs Attention group.
const YESTERDAY = '2026-06-11';
// ...and for a wide presence window (today-30 → today+180, the Get-started
// checklist's exact range) to tell a first-run circle from a quiet day.
const PRESENCE_START = '2026-05-13';
const PRESENCE_END = '2026-12-09';
// That window is answered by the cheap presence endpoint — per-type booleans —
// never by downloading the 211-day events list (HOME OVER-FETCH).
const PRESENCE_URL = `/circles/${CIRCLE_ID}/events/presence`;

/** The presence endpoint's envelope for a window holding `events`. */
function presenceOf(events: { event_type: string }[]) {
  const types = new Set(events.map((e) => e.event_type));
  return {
    success: true,
    data: {
      medication: types.has('medication'),
      appointment: types.has('appointment'),
      task: types.has('task'),
    },
  };
}

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
  presenceEvents = events,
}: {
  circles?: Circle[];
  events?: TodaysMedication[];
  /** Yesterday's doses — the Needs Attention group's source. Empty by default. */
  yesterdayEvents?: TodaysMedication[];
  /**
   * Everything in the wide presence window. Defaults to today's list, so a
   * circle with doses today naturally counts as having medications.
   */
  presenceEvents?: TodaysMedication[];
} = {}): void {
  // Routed by date. The widget makes THREE events calls (today, yesterday, and
  // the presence window) and the real endpoint is date-scoped, so a mock that
  // answered them all with the same list would render every dose twice — once
  // per group. Any other range is a `useCalendarEvents` neighbour prefetch the
  // widget never reads.
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
    if (url === PRESENCE_URL) {
      return Promise.resolve(presenceOf(presenceEvents));
    }
    if (url === `/circles/${CIRCLE_ID}/events`) {
      const start = config?.params?.start_date;
      const list =
        start === PRESENCE_START
          ? presenceEvents
          : start === YESTERDAY
            ? yesterdayEvents
            : start === TODAY
              ? events
              : [];
      return Promise.resolve({ success: true, data: { events: list } });
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
  homeEmptyCtaTapped.mockReset();
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

  // ==========================================================================
  // EMPTY STATES. "Nothing today" is two different circles: one whose weekly
  // dose is simply not due today, and one that has never had a medication.
  // The widget tells them apart with the checklist's wide presence window
  // (today-30 → today+180) and only the first-run one gets a door.
  // ==========================================================================
  it('renders the empty state when there are no medications today', async () => {
    // A medication exists in the window (a weekly dose, say) — just not today.
    mockApi({ events: [], presenceEvents: [makeMed({ id: 'weekly', scheduled_date: '2026-06-15' })] });
    renderWidget();

    expect(await screen.findByText('No medications scheduled today.')).toBeInTheDocument();
    expect(screen.queryByText(/No medications yet/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
  });

  // THE PRESENCE WINDOW IS PART OF THE LOADING GATE, NOT AN AFTERTHOUGHT.
  //
  // `presence.isLoading` sits inside the same `if` as `medsQuery.isPending`
  // (TodaysMeds body). Deleting it leaves this whole file green, because every
  // other case here resolves all three event requests together — and ships a
  // FLASH OF THE WRONG STORY: today's list settles empty first, `presence`
  // still has no rows, so `hasAnyMedication` is false and the widget tells a
  // household that HAS medications "No medications yet" and offers a first-run
  // door, before correcting itself a moment later. That is the one distinction
  // this widget's empty state exists to make.
  it('shows neither empty copy until the presence window has answered', async () => {
    let answerPresence: (events: TodaysMedication[]) => void = () => {};
    const presencePromise = new Promise<ReturnType<typeof presenceOf>>((resolve) => {
      answerPresence = (events) => resolve(presenceOf(events));
    });

    mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
      if (url === '/circles') {
        return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
      }
      if (url === `/circles/${CIRCLE_ID}`) {
        return Promise.resolve({
          success: true,
          data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
        });
      }
      // Only the PRESENCE read is held open; today and yesterday answer at once.
      if (url === PRESENCE_URL) return presencePromise;
      if (url === `/circles/${CIRCLE_ID}/events`) {
        const start = config?.params?.start_date;
        // A 211-day LIST read is the old over-fetch; it never answers here.
        if (start === PRESENCE_START) return new Promise(() => {});
        return Promise.resolve({ success: true, data: { events: [] } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderWidget();

    // Today's list has come back EMPTY and the presence window has not. The
    // widget must still be busy — not guessing.
    await waitFor(() =>
      expect(mockedGet).toHaveBeenCalledWith(PRESENCE_URL, {
        params: { start_date: PRESENCE_START, end_date: PRESENCE_END },
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText(/No medications yet/)).toBeNull();
    expect(screen.queryByText('No medications scheduled today.')).toBeNull();

    // The window answers: this circle DOES have a medication, just not today.
    await act(async () => {
      answerPresence([makeMed({ id: 'weekly', scheduled_date: '2026-06-15' })]);
      await presencePromise;
    });

    expect(await screen.findByText('No medications scheduled today.')).toBeInTheDocument();
    // The first-run copy and its door never appeared at all.
    expect(screen.queryByText(/No medications yet/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
  });

  /** Every events-LIST request, as "start..end". */
  const listRanges = () =>
    mockedGet.mock.calls
      .filter(([url]) => url === `/circles/${CIRCLE_ID}/events`)
      .map(([, config]) => `${config?.params?.start_date}..${config?.params?.end_date}`);

  // HOME OVER-FETCH: presence used to be a 211-day events LIST (1,511 rows,
  // ~1.4 MB on the demo circle) plus two prefetched 211-day neighbours.
  it("asks the presence ENDPOINT on the checklist's exact range, and fetches no wide events list", async () => {
    mockApi({ events: [], presenceEvents: [] });
    renderWidget();

    await screen.findByText(/No medications yet/);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(mockedGet).toHaveBeenCalledWith(PRESENCE_URL, {
      params: { start_date: PRESENCE_START, end_date: PRESENCE_END },
    });
    expect(mockedGet.mock.calls.filter(([url]) => url === PRESENCE_URL)).toHaveLength(1);
    // Only today's and yesterday's dose reads — no 211-day list, no neighbours.
    expect([...listRanges()].sort()).toEqual([`${YESTERDAY}..${YESTERDAY}`, `${TODAY}..${TODAY}`]);
  });

  // DEPLOY ORDER: a web build can reach an OLDER backend that has no presence
  // route — GET /events/presence then lands on GET /events/:eventId and answers
  // 404 NOT_FOUND. The widget must behave exactly as it did before: derive
  // presence from ONE full-range list read (and still no neighbour prefetch).
  describe('older backend without the presence route (404)', () => {
    const OLD_BACKEND_404 = { success: false, error: { code: 'NOT_FOUND', message: 'Event not found' } };

    function oldBackend(opts: { presence: TodaysMedication[]; failList?: boolean }) {
      mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
        if (url === '/circles') {
          return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
        }
        if (url === `/circles/${CIRCLE_ID}`) {
          return Promise.resolve({
            success: true,
            data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
          });
        }
        if (url === PRESENCE_URL) return Promise.reject(OLD_BACKEND_404);
        if (url === `/circles/${CIRCLE_ID}/events`) {
          if (config?.params?.start_date === PRESENCE_START) {
            return opts.failList
              ? Promise.reject({ success: false, error: { code: 'SERVER_ERROR' } })
              : Promise.resolve({ success: true, data: { events: opts.presence } });
          }
          return Promise.resolve({ success: true, data: { events: [] } });
        }
        return Promise.reject(new Error(`unexpected GET ${url}`));
      });
    }

    it('a circle with a medication (none today): "none today", no door; ONE 211-day list read, no neighbours', async () => {
      oldBackend({ presence: [makeMed({ id: 'weekly', scheduled_date: '2026-06-15' })] });
      renderWidget();

      expect(await screen.findByText('No medications scheduled today.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect([...listRanges()].sort()).toEqual([
        `${PRESENCE_START}..${PRESENCE_END}`,
        `${YESTERDAY}..${YESTERDAY}`,
        `${TODAY}..${TODAY}`,
      ]);
    });

    it('an empty circle: the first-run door, exactly as before', async () => {
      oldBackend({ presence: [] });
      renderWidget();
      expect(await screen.findByRole('button', { name: 'Add a medication' })).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load medications")).toBeNull();
    });

    it('the fallback list read fails: neutral error, no door', async () => {
      oldBackend({ presence: [], failList: true });
      renderWidget();
      expect(await screen.findByText("Couldn't load medications")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      expect(screen.queryByText(/No medications yet/)).toBeNull();
    });
  });

  // THE PRESENCE ANSWER MUST NOT GO STALE AFTER A WRITE. It is a separate query
  // from the events lists, so unless the write hooks' invalidation reaches it,
  // a caregiver who adds the first medication keeps being offered "Add a
  // medication" — the duplicate-series generator — until the cache expires.
  it('creating the first medication refreshes presence: the first-run door gives way to the fact copy', async () => {
    let existing: TodaysMedication[] = [];
    const weekly = makeMed({ id: 'weekly', medication_name: 'Aspirin', scheduled_date: '2026-06-15' });
    mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
      if (url === '/circles') {
        return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
      }
      if (url === `/circles/${CIRCLE_ID}`) {
        return Promise.resolve({
          success: true,
          data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
        });
      }
      if (url === PRESENCE_URL) return Promise.resolve(presenceOf(existing));
      if (url === `/circles/${CIRCLE_ID}/events`) {
        const list = config?.params?.start_date === PRESENCE_START ? existing : [];
        return Promise.resolve({ success: true, data: { events: list } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    mockedPost.mockImplementation((url: string) =>
      url === `/circles/${CIRCLE_ID}/events`
        ? Promise.resolve({
            success: true,
            data: { event: { ...weekly, circle_id: CIRCLE_ID, created_at: '', updated_at: '' } },
          })
        : Promise.reject(new Error(`unexpected POST ${url}`))
    );

    // The real write hook, as AddEventModal uses it.
    function CreateMedication() {
      const create = useCreateEvent(CIRCLE_ID);
      return (
        <button
          type="button"
          onClick={() =>
            create.mutate({
              event_type: 'medication',
              title: 'Aspirin',
              medication_name: 'Aspirin',
              scheduled_date: '2026-06-15',
              scheduled_time: '09:00',
            })
          }
        >
          test: save medication
        </button>
      );
    }

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <TodaysMeds circleId={CIRCLE_ID} />
            <CreateMedication />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    );

    expect(await screen.findByRole('button', { name: 'Add a medication' })).toBeInTheDocument();

    existing = [weekly];
    await userEvent.setup().click(screen.getByRole('button', { name: 'test: save medication' }));

    expect(await screen.findByText('No medications scheduled today.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
    expect(mockedPost).toHaveBeenCalledWith(
      `/circles/${CIRCLE_ID}/events`,
      expect.objectContaining({ event_type: 'medication' })
    );
  });

  it('on a first-run circle offers "Add a medication", which opens the med form and is tracked', async () => {
    const user = userEvent.setup();
    mockApi({ events: [], presenceEvents: [] });
    renderWidget();

    expect(
      await screen.findByText(
        'No medications yet. Add the first one and everyone in the circle gets the reminder.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('No medications scheduled today.')).toBeNull();
    expect(screen.queryByTestId('add-event-modal')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add a medication' }));

    expect(screen.getByTestId('add-event-modal')).toHaveTextContent('medication');
    expect(homeEmptyCtaTapped).toHaveBeenCalledTimes(1);
    expect(homeEmptyCtaTapped).toHaveBeenCalledWith('medications');
  });

  it('on a first-run circle the viewer cannot edit, shows the copy but no door', async () => {
    mockApi({
      circles: [makeCircle({ can_edit: false, view_only: true, access_level: 'view' })],
      events: [],
      presenceEvents: [],
    });
    renderWidget();

    expect(await screen.findByText(/No medications yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
  });

  // ==========================================================================
  // A FAILED READ IS NOT A FIRST RUN.
  //
  // `presence.events` is empty when the wide window FAILS, so with no error
  // branch a circle that HAS medications was told "No medications yet" and
  // offered "Add a medication" — a duplicate series, a doubled adherence
  // denominator (e2e/unhappy/writes/first-run-cta-failed-read.spec.ts).
  // ==========================================================================
  describe('failed reads', () => {
    /** Routes like `mockApi`, but the named window(s) reject until `heal()`. */
    function mockApiFailing(fail: { presence?: boolean; today?: boolean }, presenceEvents: TodaysMedication[]) {
      const state = { failing: true };
      mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
        if (url === '/circles') {
          return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
        }
        if (url === `/circles/${CIRCLE_ID}`) {
          return Promise.resolve({
            success: true,
            data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
          });
        }
        if (url === PRESENCE_URL) {
          return state.failing && fail.presence
            ? Promise.reject({ success: false, error: { code: 'SERVER_ERROR' } })
            : Promise.resolve(presenceOf(presenceEvents));
        }
        if (url === `/circles/${CIRCLE_ID}/events`) {
          const start = config?.params?.start_date;
          const isPresence = start === PRESENCE_START;
          const isToday = start === TODAY;
          if (state.failing && ((fail.presence && isPresence) || (fail.today && isToday))) {
            return Promise.reject({ success: false, error: { code: 'SERVER_ERROR' } });
          }
          return Promise.resolve({ success: true, data: { events: isPresence ? presenceEvents : [] } });
        }
        return Promise.reject(new Error(`unexpected GET ${url}`));
      });
      return { heal: () => (state.failing = false) };
    }

    const presenceCalls = () =>
      mockedGet.mock.calls.filter(
        ([url, config]) => url === PRESENCE_URL && config?.params?.start_date === PRESENCE_START
      ).length;

    it('presence window fails: neutral copy, no first-run door, and Retry refetches it', async () => {
      const weekly = makeMed({ id: 'weekly', scheduled_date: '2026-06-15' });
      const api = mockApiFailing({ presence: true }, [weekly]);
      renderWidget();

      expect(await screen.findByText("Couldn't load medications")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      expect(screen.queryByText(/No medications yet/)).toBeNull();
      expect(screen.queryByText('No medications scheduled today.')).toBeNull();

      const before = presenceCalls();
      api.heal();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      // The real answer: this circle has a medication, just not today.
      expect(await screen.findByText('No medications scheduled today.')).toBeInTheDocument();
      expect(presenceCalls()).toBe(before + 1);
      expect(screen.queryByText("Couldn't load medications")).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
    });

    it("today's read fails: error copy, no first-run door (even with an empty presence window), and Retry refetches", async () => {
      const api = mockApiFailing({ today: true }, []);
      renderWidget();

      expect(await screen.findByText("Couldn't load today's medications")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      expect(screen.queryByText(/No medications yet/)).toBeNull();

      api.heal();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      // Presence says never had one, today now loads empty: the real first run.
      expect(await screen.findByRole('button', { name: 'Add a medication' })).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load today's medications")).toBeNull();
    });

    it('loading: skeleton, no first-run door', async () => {
      // Every events window held open.
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
        return new Promise(() => {});
      });
      const { container } = render(
        <MemoryRouter>
          <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
            <ToastProvider>
              <TodaysMeds circleId={CIRCLE_ID} />
            </ToastProvider>
          </QueryClientProvider>
        </MemoryRouter>
      );
      await waitFor(() =>
        expect(mockedGet).toHaveBeenCalledWith(PRESENCE_URL, {
          params: { start_date: PRESENCE_START, end_date: PRESENCE_END },
        })
      );
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      expect(screen.queryByText("Couldn't load medications")).toBeNull();
    });

    it('success with data: the list, no first-run door, no error copy', async () => {
      mockApi();
      renderWidget();
      expect(await screen.findByText('Lisinopril')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      expect(screen.queryByText("Couldn't load medications")).toBeNull();
    });

    it('success and truly empty: the first-run door, no error copy', async () => {
      mockApi({ events: [], presenceEvents: [] });
      renderWidget();
      expect(await screen.findByRole('button', { name: 'Add a medication' })).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load medications")).toBeNull();
    });
  });

  // ==========================================================================
  // PAUSED OFFLINE, AND PARTIAL FAILURES.
  //
  // The first-run door needs EVERY deciding read (today, yesterday, presence)
  // to have SUCCEEDED and found nothing. Paused (offline: `isPending`, but
  // `isLoading` false) and errored reads never reach it; doses that did load
  // always render; a failed yesterday read is named instead of silently
  // dropping its doses from Needs Attention.
  // ==========================================================================
  describe('paused offline and partial failures', () => {
    const EVENTS_URL = `/circles/${CIRCLE_ID}/events`;
    const presenceKey = () =>
      queryKeys.calendarEventsPresence(CIRCLE_ID, {
        start_date: PRESENCE_START,
        end_date: PRESENCE_END,
      });

    afterEach(() => onlineManager.setOnline(true));

    function routedApi(opts: {
      today?: TodaysMedication[];
      yesterday?: TodaysMedication[];
      presence?: TodaysMedication[];
      fail?: { presence?: boolean; yesterday?: boolean };
    }) {
      const state = { failing: true };
      mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
        if (url === '/circles') {
          return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
        }
        if (url === `/circles/${CIRCLE_ID}`) {
          return Promise.resolve({
            success: true,
            data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
          });
        }
        if (url === PRESENCE_URL) {
          return state.failing && opts.fail?.presence
            ? Promise.reject({ success: false, error: { code: 'SERVER_ERROR' } })
            : Promise.resolve(presenceOf(opts.presence ?? []));
        }
        if (url === EVENTS_URL) {
          const start = config?.params?.start_date;
          const reject = () => Promise.reject({ success: false, error: { code: 'SERVER_ERROR' } });
          const ok = (events: TodaysMedication[] = []) =>
            Promise.resolve({ success: true, data: { events } });
          if (start === PRESENCE_START) {
            return state.failing && opts.fail?.presence ? reject() : ok(opts.presence);
          }
          if (start === YESTERDAY) {
            return state.failing && opts.fail?.yesterday ? reject() : ok(opts.yesterday);
          }
          if (start === TODAY) return ok(opts.today);
          return ok([]);
        }
        return Promise.reject(new Error(`unexpected GET ${url}`));
      });
      return { heal: () => (state.failing = false) };
    }

    /** Requests for a window; PRESENCE_START counts the presence ENDPOINT, not a list read. */
    const callsFor = (start: string) =>
      mockedGet.mock.calls.filter(
        ([url, config]) =>
          url === (start === PRESENCE_START ? PRESENCE_URL : EVENTS_URL) &&
          config?.params?.start_date === start
      ).length;

    const weekly = () => makeMed({ id: 'weekly', scheduled_date: '2026-06-15' });

    /**
     * A REAL QueryClient, offline, holding what an earlier visit cached (the
     * circle, its timezone, today's doses) but NOT the presence window or
     * yesterday — exactly the client-side-navigation-while-offline case. Those
     * two reads end up genuinely paused.
     */
    function renderOfflineWithCache(today: TodaysMedication[]) {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, networkMode: 'online' } },
      });
      queryClient.setQueryData(queryKeys.circles, [makeCircle()]);
      queryClient.setQueryData(queryKeys.circleDetail(CIRCLE_ID), {
        id: CIRCLE_ID,
        care_recipient_timezone: TZ,
      });
      queryClient.setQueryData([...todaysMedsKey(CIRCLE_ID), TODAY], today);
      onlineManager.setOnline(false);
      const view = render(
        <MemoryRouter>
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <TodaysMeds circleId={CIRCLE_ID} />
            </ToastProvider>
          </QueryClientProvider>
        </MemoryRouter>
      );
      return { queryClient, ...view };
    }

    it('(a) offline: presence + yesterday paused on a circle WITH a medication → no first-run door; online lands the real state', async () => {
      routedApi({ today: [], presence: [weekly()] });
      const { queryClient, container } = renderOfflineWithCache([]);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // Genuinely paused: pending, no fetch in flight, nothing sent.
      const presence = queryClient.getQueryCache().find({ queryKey: presenceKey() })?.state;
      const yesterday = queryClient
        .getQueryCache()
        .find({ queryKey: [...todaysMedsKey(CIRCLE_ID), YESTERDAY] })?.state;
      expect(`${presence?.status}/${presence?.fetchStatus}`).toBe('pending/paused');
      expect(`${yesterday?.status}/${yesterday?.fetchStatus}`).toBe('pending/paused');
      expect(callsFor(PRESENCE_START)).toBe(0);

      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      expect(screen.queryByText(/No medications yet/)).toBeNull();
      expect(screen.queryByText('No medications scheduled today.')).toBeNull();
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();

      await act(async () => {
        onlineManager.setOnline(true);
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(await screen.findByText('No medications scheduled today.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
    });

    it('offline: a paused presence read does not hide today\'s doses that are cached', async () => {
      routedApi({});
      renderOfflineWithCache([makeMed({ id: 'm1', medication_name: 'Lisinopril' })]);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(screen.getByText('Lisinopril')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
    });

    it("presence fails while today's doses are listed: the doses render, no door, no presence error", async () => {
      routedApi({
        today: [makeMed({ id: 'm1', medication_name: 'Lisinopril' })],
        fail: { presence: true },
      });
      renderWidget();
      expect(await screen.findByText('Lisinopril')).toBeInTheDocument();
      await waitFor(() => expect(callsFor(PRESENCE_START)).toBeGreaterThan(0));
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      expect(screen.queryByText("Couldn't load medications")).toBeNull();
    });

    it("presence fails while yesterday's doses are listed: Needs Attention renders, no door", async () => {
      routedApi({
        today: [],
        yesterday: [
          makeMed({ id: 'y1', medication_name: 'Warfarin', scheduled_date: YESTERDAY }),
        ],
        fail: { presence: true },
      });
      renderWidget();
      expect(await screen.findByText('Needs attention')).toBeInTheDocument();
      expect(screen.getByText('Warfarin')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      expect(screen.queryByText(/No medications yet/)).toBeNull();
    });

    it("yesterday's read fails while today's doses are listed: the doses render, the gap is named, and Retry refetches yesterday", async () => {
      const api = routedApi({
        today: [makeMed({ id: 'm1', medication_name: 'Lisinopril' })],
        yesterday: [
          makeMed({ id: 'y1', medication_name: 'Warfarin', scheduled_date: YESTERDAY }),
        ],
        presence: [makeMed({ id: 'm1' })],
        fail: { yesterday: true },
      });
      renderWidget();

      expect(await screen.findByText("Couldn't load yesterday's doses")).toBeInTheDocument();
      expect(screen.getByText('Lisinopril')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();

      const before = callsFor(YESTERDAY);
      api.heal();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

      // The dose that would have silently vanished is back.
      expect(await screen.findByText('Warfarin')).toBeInTheDocument();
      expect(screen.getByText('Needs attention')).toBeInTheDocument();
      expect(callsFor(YESTERDAY)).toBe(before + 1);
      expect(screen.queryByText("Couldn't load yesterday's doses")).toBeNull();
    });

    it("yesterday's read fails on a circle with medications but none today: the fact copy plus the named gap, no door", async () => {
      routedApi({ today: [], presence: [weekly()], fail: { yesterday: true } });
      renderWidget();
      expect(await screen.findByText('No medications scheduled today.')).toBeInTheDocument();
      expect(screen.getByText("Couldn't load yesterday's doses")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
    });

    it("yesterday's read fails and presence found nothing: neutral error, no door; Retry refetches yesterday and lands the real first run", async () => {
      const api = routedApi({ today: [], presence: [], fail: { yesterday: true } });
      renderWidget();

      expect(await screen.findByText("Couldn't load medications")).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add a medication' })).toBeNull();
      expect(screen.queryByText(/No medications yet/)).toBeNull();

      const before = callsFor(YESTERDAY);
      const presenceBefore = callsFor(PRESENCE_START);
      api.heal();
      await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByRole('button', { name: 'Add a medication' })).toBeInTheDocument();
      expect(callsFor(YESTERDAY)).toBe(before + 1);
      // Presence did not fail, so it is not re-asked.
      expect(callsFor(PRESENCE_START)).toBe(presenceBefore);
    });
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
      if (url === PRESENCE_URL) return Promise.resolve(presenceOf(DEFAULT_MEDS));
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

    // EXACTLY ONE toast. The mutation hook owns the permission toast; the
    // widget's own onError must stand down for it (`isPermissionDeniedError`),
    // or the caregiver is told twice — once correctly, once with a generic
    // "Couldn't save" that implies a retry could work.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByText("Couldn't save. Please try again.")).not.toBeInTheDocument();
  });

  /**
   * THE NOT-DUE RE-CHECK IN `handleConfirm`, reached through the UI.
   *
   * The Take/Skip pair is rendered off `isDoseConfirmable` at RENDER time; the
   * handler re-checks at CLICK time. The two disagree whenever the clock moves
   * the predicate from true to false with no render in between — and moving
   * forward can do that: on the recipient's fall-back night the wall clock
   * repeats 01:00–02:00. A 03:30 dose is answerable from 01:30 (the 2h early
   * window); at 01:45 EDT the pair is live, fifteen minutes later it is 01:00
   * EST and the dose is 2½ hours away again. A card left on screen across that
   * instant would POST a dose that is not due — a falsified adherence row.
   */
  it('refuses a stale Confirm when the dose stopped being due (DST fall-back), and says so', async () => {
    // 2026-11-01 is America/New_York's fall-back day.
    const BEFORE_FALL_BACK = new Date('2026-11-01T05:45:00Z'); // 01:45 EDT
    const AFTER_FALL_BACK = new Date('2026-11-01T06:00:00Z'); // 01:00 EST
    const DST_DAY = '2026-11-01';
    const dose = makeMed({
      id: 'dst-dose',
      medication_name: 'Warfarin',
      scheduled_date: DST_DAY,
      scheduled_time: '03:30:00',
    });
    vi.useFakeTimers({ toFake: ['Date'], now: BEFORE_FALL_BACK });
    mockedGet.mockImplementation((url: string, config?: { params?: { start_date?: string } }) => {
      if (url === '/circles') {
        return Promise.resolve({ success: true, data: { circles: [makeCircle()] } });
      }
      if (url === `/circles/${CIRCLE_ID}`) {
        return Promise.resolve({
          success: true,
          data: { circle: { id: CIRCLE_ID, care_recipient_timezone: TZ } },
        });
      }
      if (url === PRESENCE_URL) return Promise.resolve(presenceOf([dose]));
      if (url === `/circles/${CIRCLE_ID}/events`) {
        const start = config?.params?.start_date;
        // Today's list and the presence window (today - 30) carry the dose.
        const list = start === DST_DAY || start === '2026-10-02' ? [dose] : [];
        return Promise.resolve({ success: true, data: { events: list } });
      }
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });
    renderWidget();

    await screen.findByText('Warfarin');
    // Live at render time: 01:45 is inside the window that opened at 01:30.
    const take = action(medRow('Warfarin'), 'Confirm');

    // The clock falls back with no render in between, then the stale button
    // is pressed. The undo window is run out so a POST that slipped through
    // would be visible.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: AFTER_FALL_BACK });
    fireEvent.click(take);
    await act(async () => {
      vi.advanceTimersByTime(MEDICATION_UNDO_DELAY_MS);
    });
    vi.useFakeTimers({ toFake: ['Date'], now: AFTER_FALL_BACK });

    expect(
      await screen.findByText("This dose isn't due yet, so it can't be recorded.")
    ).toBeInTheDocument();
    expect(mockedPost).not.toHaveBeenCalled();
    // Nothing was armed: no optimistic "Taken" with an Undo on it.
    expect(
      within(medRow('Warfarin')).queryByRole('button', { name: 'Undo Warfarin' })
    ).not.toBeInTheDocument();
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
