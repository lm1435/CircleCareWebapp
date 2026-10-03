import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import VitalsPage from '../VitalsPage';
import type { HealthVital } from '@/api/vitals';

// Task 21 — VitalsPage: masthead, type chips, range pill, latest hero, the
// inline SVG trend chart, and the readings list. Every reading is
// editable/deletable through the row `MoreMenu`; !canEdit hides all of it.
//
// TZ-independent: the page renders recorded_at in the (mocked) recipient TZ; we
// only assert on values + affordances, not date strings, so the machine clock
// doesn't matter.

const mockUseVitals = vi.fn();
const mockDeleteMutate = vi.fn();
const mockUseCircle = vi.fn();
const mockUseLatestVitals = vi.fn();
const unitPrefs = { weight_unit: 'lbs', glucose_unit: 'mg/dL' };

/** Every type null — the default "nothing has ever been logged" answer. */
const EMPTY_LATEST = { blood_pressure: null, heart_rate: null, glucose: null, weight: null };

vi.mock('@/hooks/useVitals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useVitals')>();
  return {
    ...actual,
    useVitals: (circleId: string | undefined, params: unknown) => mockUseVitals(circleId, params),
    useDeleteVital: () => ({ mutateAsync: mockDeleteMutate, isPending: false }),
    useLatestVitals: () => mockUseLatestVitals(),
  };
});

vi.mock('@/hooks/useUnitPreferences', () => ({
  useUnitPreferences: () => ({ data: unitPrefs }),
}));

vi.mock('@/hooks/useCircle', () => ({
  useCircle: (circleId: string) => mockUseCircle(circleId),
}));

// The recorded-at label renders in the VIEWER's hour cycle. Pin it here (the
// real hook reads the shared currentUser query) so the assertions below never
// depend on the runner's locale or the dev machine's clock.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

// Stub the modals — assert open/close via a sentinel, not the real form.
vi.mock('@/components/vitals/AddVitalModal', () => ({
  AddVitalModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="add-vital-modal">
      <button type="button" onClick={onClose}>
        close-add
      </button>
    </div>
  ),
}));
vi.mock('@/components/vitals/EditVitalModal', () => ({
  EditVitalModal: ({ vital, onClose }: { vital: HealthVital; onClose: () => void }) => (
    <div role="dialog" aria-label="edit-vital-modal">
      <span>editing-{vital.id}</span>
      <button type="button" onClick={onClose}>
        close-edit
      </button>
    </div>
  ),
}));

function makeVital(overrides: Partial<HealthVital> = {}): HealthVital {
  return {
    id: 'v-1',
    circle_id: 'circle-1',
    vital_type: 'heart_rate',
    value1: 72,
    value2: null,
    unit: 'bpm',
    recorded_at: '2026-06-15T16:00:00.000Z',
    recorded_by: 'u-1',
    notes: null,
    created_at: '2026-06-15T16:00:00.000Z',
    updated_at: '2026-06-15T16:00:00.000Z',
    ...overrides,
  };
}

function vitalsResult(vitals: HealthVital[], overrides: Record<string, unknown> = {}) {
  return {
    data: vitals,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  };
}

/**
 * The page runs TWO reads: the active window (whose `to` is "now") and the
 * previous window of the same length, which the trend sentence compares
 * against and whose `to` is a whole range-length in the past. One minute of
 * slack tells them apart under any range.
 */
const PREVIOUS_WINDOW_SLACK_MS = 60_000;

function isPreviousWindow(params: { to?: string } | undefined): boolean {
  if (!params?.to) return false;
  return Date.now() - Date.parse(params.to) > PREVIOUS_WINDOW_SLACK_MS;
}

/**
 * Serve the current window from `current` and the previous one from `previous`,
 * honouring the `type` filter the page sends — the backend narrows the list
 * server-side, so a mock that ignores `type` would hide every "this type has no
 * readings" path.
 */
function serveVitals(current: HealthVital[], previous: HealthVital[] = []) {
  mockUseVitals.mockImplementation(
    (_circleId: string | undefined, params: { to?: string; type?: string }) => {
      const source = isPreviousWindow(params) ? previous : current;
      return vitalsResult(params?.type ? source.filter((v) => v.vital_type === params.type) : source);
    }
  );
}

/** The most recent CURRENT-window call's params — the query the list renders. */
function lastCurrentParams(): Record<string, unknown> {
  const calls = mockUseVitals.mock.calls.filter(
    (call) => !isPreviousWindow(call[1] as { to?: string })
  );
  return calls[calls.length - 1]![1] as Record<string, unknown>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/circles/circle-1/vitals']}>
      <Routes>
        <Route path="/circles/:circleId/vitals" element={<VitalsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The row overflow menu for the one reading on screen, opened. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Actions for reading/ }));
  return screen.getByRole('menu');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseHourCycle.mockReturnValue('12h');
  mockUseCircle.mockReturnValue({ canEdit: true, timezone: 'America/New_York' });
  mockUseLatestVitals.mockReturnValue({ data: EMPTY_LATEST, isLoading: false });
  serveVitals([makeVital({ id: 'v-1', vital_type: 'heart_rate', value1: 72 })]);
});

describe('VitalsPage', () => {
  it('renders a reading in the user display units', () => {
    renderPage();
    expect(screen.getByText('72 bpm')).toBeInTheDocument();
  });

  // recorded_at 2026-06-15T16:00:00Z is 12:00 in America/New_York (EDT).
  it('renders the recorded time in the viewer 12-hour cycle', () => {
    renderPage();
    expect(screen.getByText(/12:00 PM/)).toBeInTheDocument();
  });

  it('renders the recorded time in the viewer 24-hour cycle', () => {
    mockUseHourCycle.mockReturnValue('24h');
    renderPage();
    expect(screen.getByText(/12:00(?!\s*[AP]M)/)).toBeInTheDocument();
    expect(screen.queryByText(/PM/)).not.toBeInTheDocument();
  });

  // ── Masthead ──────────────────────────────────────────────────────────────

  it('wears the Vitals masthead with a way back to the circle', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Vitals', level: 1 })).toBeInTheDocument();
    // Vitals is reached from Home's Quick Access — below xl the nav pill does
    // not carry it, so the masthead must offer the way back.
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/circles/circle-1'
    );
  });

  // ── Write gating ──────────────────────────────────────────────────────────

  it('offers Edit + Delete through the row overflow menu when canEdit', async () => {
    const user = userEvent.setup();
    renderPage();

    const menu = await openRowMenu(user);
    expect(within(menu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('hides ALL write affordances when canEdit is false', () => {
    mockUseCircle.mockReturnValue({ canEdit: false, timezone: 'America/New_York' });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Add reading' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Actions for reading/ })).not.toBeInTheDocument();
    // Read view still renders the reading.
    expect(screen.getByText('72 bpm')).toBeInTheDocument();
  });

  it('opens the add modal from the masthead "Add reading" action', async () => {
    const user = userEvent.setup();
    renderPage();

    // The masthead renders the action twice by design (round control below xl,
    // labelled button from xl up); either opens the same modal.
    const actions = screen.getAllByRole('button', { name: 'Add reading' });
    expect(actions).toHaveLength(2);
    await user.click(actions[0]!);
    expect(screen.getByRole('dialog', { name: 'add-vital-modal' })).toBeInTheDocument();
  });

  it('opens the edit modal from the row menu', async () => {
    const user = userEvent.setup();
    renderPage();

    const menu = await openRowMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit' }));

    const dialog = screen.getByRole('dialog', { name: 'edit-vital-modal' });
    expect(dialog).toHaveTextContent('editing-v-1');
  });

  it('confirms then fires delete from the row menu', async () => {
    mockDeleteMutate.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    const menu = await openRowMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    const confirm = screen.getByRole('dialog');
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));

    expect(mockDeleteMutate).toHaveBeenCalledWith('v-1');
  });

  it('shows the empty state when there are no readings', () => {
    serveVitals([]);
    renderPage();
    expect(screen.getByText('No readings yet')).toBeInTheDocument();
    // The empty state offers its own primary CTA when the user can edit.
    expect(screen.getByRole('button', { name: 'Log a reading' })).toBeInTheDocument();
  });

  // ── Empty states (mobile parity: never-logged vs out-of-range) ─────────────
  //
  // The generic "No readings yet" state above is now only ONE of three
  // stories, told apart by the latest-vitals answer (`useLatestVitals`) —
  // PORT of mobile VitalsDetailScreen's `viewState`. Pinned to a fixed instant
  // (not the real clock) so "outside the 30-day window, inside the 90-day
  // window" holds regardless of when this suite runs.
  describe('empty states (never-logged vs out-of-range)', () => {
    const PINNED_NOW = '2026-06-15T16:00:00.000Z';

    beforeEach(() => {
      // Fakes ONLY `Date` (not setTimeout/setInterval) — userEvent's internal
      // delays still run on the real clock, so `await user.click(...)` below
      // does not hang waiting for a fake timer nobody advances.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(PINNED_NOW));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('names the never-logged type and offers a CTA when the viewer can edit', async () => {
      const user = userEvent.setup();
      renderPage(); // only heart_rate is served; default latest is EMPTY_LATEST
      await user.click(screen.getByRole('radio', { name: 'Weight' }));

      expect(screen.getByText('No weight readings yet')).toBeInTheDocument();
      const cta = screen.getByRole('button', { name: 'Log weight' });
      await user.click(cta);
      expect(screen.getByRole('dialog', { name: 'add-vital-modal' })).toBeInTheDocument();
    });

    it('never-logged: a read-only viewer gets the title with no description or CTA', async () => {
      mockUseCircle.mockReturnValue({ canEdit: false, timezone: 'America/New_York' });
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('radio', { name: 'Weight' }));

      expect(screen.getByText('No weight readings yet')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Log weight' })).not.toBeInTheDocument();
    });

    it('out-of-range: names the last reading and offers to jump to the narrowest wider range', async () => {
      mockUseLatestVitals.mockReturnValue({
        data: {
          ...EMPTY_LATEST,
          // 68.0388555 kg canonical = exactly 150 lbs (same fixture value used
          // elsewhere in this file). ~45 days before PINNED_NOW: outside the
          // default 30-day window, inside 90 days.
          weight: makeVital({
            id: 'w-old',
            vital_type: 'weight',
            value1: 68.0388555,
            unit: 'kg',
            recorded_at: '2026-05-01T12:00:00.000Z',
          }),
        },
        isLoading: false,
      });
      serveVitals([]); // nothing for ANY type in the current window
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('radio', { name: 'Weight' }));

      expect(screen.getByText('No readings in the past 30 days')).toBeInTheDocument();
      expect(screen.getByText(/Last reading: 150 lbs/)).toBeInTheDocument();

      const jump = screen.getByRole('button', { name: 'Show past 90 days' });
      await user.click(jump);
      expect(screen.getByRole('button', { name: 'Time range: Last 90 days' })).toBeInTheDocument();
    });

    it('out-of-range: shown to a read-only viewer too (it is information, not a write affordance)', async () => {
      mockUseCircle.mockReturnValue({ canEdit: false, timezone: 'America/New_York' });
      mockUseLatestVitals.mockReturnValue({
        data: {
          ...EMPTY_LATEST,
          weight: makeVital({
            id: 'w-old',
            vital_type: 'weight',
            value1: 68.0388555,
            unit: 'kg',
            recorded_at: '2026-05-01T12:00:00.000Z',
          }),
        },
        isLoading: false,
      });
      serveVitals([]);
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('radio', { name: 'Weight' }));

      expect(screen.getByText('No readings in the past 30 days')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show past 90 days' })).toBeInTheDocument();
    });

    it('all types: keeps the plain generic empty state when every type is null', () => {
      serveVitals([]);
      renderPage();
      expect(screen.getByText('No readings yet')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Log a reading' })).toBeInTheDocument();
    });

    it('all types: uses the range empty state naming the MOST RECENT reading across types', () => {
      mockUseLatestVitals.mockReturnValue({
        data: {
          ...EMPTY_LATEST,
          weight: makeVital({
            id: 'w-old',
            vital_type: 'weight',
            value1: 70,
            unit: 'kg',
            recorded_at: '2026-05-01T12:00:00.000Z',
          }),
          // Older than the weight reading above — must NOT win.
          glucose: makeVital({
            id: 'g-older',
            vital_type: 'glucose',
            value1: 5.5,
            unit: 'mmol/L',
            recorded_at: '2026-03-01T12:00:00.000Z',
          }),
        },
        isLoading: false,
      });
      serveVitals([]);
      renderPage(); // 'All types' is the default filter

      expect(screen.getByText('No readings in the past 30 days')).toBeInTheDocument();
      // 70 kg canonical = 154.3 lbs, rounded to 1 decimal — the WEIGHT
      // reading, not the older glucose one.
      expect(screen.getByText(/Last reading: 154.3 lbs/)).toBeInTheDocument();
    });
  });

  // ── Type filter (a ChipSelect radiogroup, not a <select>) ──────────────────

  it('renders the type filter as a radiogroup of chips and re-fetches on selection', async () => {
    const user = userEvent.setup();
    renderPage();

    const allChip = screen.getByRole('radio', { name: 'All types' });
    const bpChip = screen.getByRole('radio', { name: 'Blood pressure' });
    expect(allChip).toBeChecked();
    expect(bpChip).not.toBeChecked();

    await user.click(bpChip);

    expect(bpChip).toBeChecked();
    expect(allChip).not.toBeChecked();
    expect(lastCurrentParams()).toMatchObject({ type: 'blood_pressure' });
  });

  // ── Range pill ────────────────────────────────────────────────────────────

  it('names the range pill by its label and current value', () => {
    renderPage();
    const pill = screen.getByRole('button', { name: 'Time range: Last 30 days' });
    // The visible text must survive inside the name (WCAG 2.5.3).
    expect(pill).toHaveTextContent('Last 30 days');
  });

  it('re-fetches a shorter window when the range menu picks 7 days', async () => {
    const user = userEvent.setup();
    renderPage();

    const before = lastCurrentParams() as { from: string; to: string };
    const spanBefore = Date.parse(before.to) - Date.parse(before.from);

    await user.click(screen.getByRole('button', { name: /Time range/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Last 7 days' }));

    expect(screen.getByRole('button', { name: 'Time range: Last 7 days' })).toBeInTheDocument();
    const after = lastCurrentParams() as { from: string; to: string };
    const spanAfter = Date.parse(after.to) - Date.parse(after.from);
    expect(Math.round(spanAfter / 86_400_000)).toBe(7);
    expect(spanAfter).toBeLessThan(spanBefore);
  });

  // The windows are CALENDAR days in the viewer's device zone ("Last 30 days"
  // = same wall-clock time, 30 dates back), not a fixed number of ms. Across a
  // DST change 30 calendar days is 30d ± 1h (NZ DST start 2026-09-27 made it
  // 2588400000 ms in Auckland), so the old real-clock ms-equality assertion was
  // a date bomb: red in Auckland/Chatham from 09-27, in Denver Nov–Dec. The
  // invariants that matter: the previous window ends EXACTLY where the current
  // one starts (no gap, no overlap), and each spans the same number of calendar
  // days at the same wall-clock time.
  //
  // Clocks are pinned to LOCAL NOON (`new Date(y, m, d, 12)`) in whatever zone
  // the suite runs in, so `npm run test:timezones` replays the same calendar
  // dates everywhere and noon never lands in a DST gap. The dates put a DST
  // change inside the current or the previous window for BOTH America/Denver
  // (Mar 8 / Nov 1 2026) and Pacific/Auckland (Apr 5 / Sep 27 2026).
  describe('the previous window used for the trend', () => {
    const DAY_MS = 86_400_000;
    const localNoon = (y: number, m1: number, d: number) => new Date(y, m1 - 1, d, 12, 0, 0, 0);
    const wall = (iso: string) => {
      const d = new Date(iso);
      return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), hm: `${d.getHours()}:${d.getMinutes()}` };
    };
    const calendarDaysBetween = (fromISO: string, toISO: string) => {
      const a = wall(fromISO);
      const b = wall(toISO);
      return Math.round((Date.UTC(b.y, b.m, b.d) - Date.UTC(a.y, a.m, a.d)) / DAY_MS);
    };
    /** The ms a span of calendar days gains/loses to the DST offset change inside it. */
    const offsetShiftMs = (fromISO: string, toISO: string) =>
      (new Date(toISO).getTimezoneOffset() - new Date(fromISO).getTimezoneOffset()) * 60_000;

    const windowsAfterSelectingHeartRate = async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole('radio', { name: 'Heart rate' }));
      const current = lastCurrentParams() as { from: string; to: string };
      const previous = mockUseVitals.mock.calls
        .map((call) => call[1] as { from: string; to: string })
        .filter(isPreviousWindow)
        .pop()!;
      return { user, current, previous };
    };

    const expectCalendarWindows = (
      current: { from: string; to: string },
      previous: { from: string; to: string },
      now: Date,
      days: number
    ) => {
      // Adjacent to the millisecond: no gap, no overlap.
      expect(previous.to).toBe(current.from);
      // The active window ends at "now" — built as instants, sent as UTC ISO.
      expect(current.to).toBe(now.toISOString());
      for (const iso of [current.from, current.to, previous.from, previous.to]) {
        expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
      // Same number of calendar days, same wall-clock time.
      expect(calendarDaysBetween(current.from, current.to)).toBe(days);
      expect(calendarDaysBetween(previous.from, previous.to)).toBe(days);
      expect(wall(current.from).hm).toBe('12:0');
      expect(wall(previous.from).hm).toBe('12:0');
      // And therefore NOT a fixed ms length when DST changes inside a window —
      // spelled out so a switch to `now - days * DAY_MS` goes red.
      for (const w of [current, previous]) {
        expect(Date.parse(w.to) - Date.parse(w.from)).toBe(days * DAY_MS + offsetShiftMs(w.from, w.to));
      }
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each<[string, Date]>([
      ['Denver spring-forward inside the current window', localNoon(2026, 3, 20)],
      ['Denver spring-forward inside the previous window', localNoon(2026, 4, 20)],
      ['Denver fall-back inside the current window', localNoon(2026, 11, 10)],
      ['Denver fall-back inside the previous window', localNoon(2026, 12, 10)],
      ['Auckland DST end inside the current window', localNoon(2026, 4, 25)],
      ['Auckland DST end inside the previous window', localNoon(2026, 5, 20)],
      ['Auckland DST start inside the current window', localNoon(2026, 10, 15)],
      ['Auckland DST start inside the previous window', localNoon(2026, 11, 5)],
      ['no DST change anywhere near (control)', localNoon(2026, 7, 15)],
    ])('30 days: adjacent, same calendar length — %s', async (_label, now) => {
      // Fakes ONLY `Date`, so userEvent's internal delays still run.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(now);
      const { current, previous } = await windowsAfterSelectingHeartRate();
      expectCalendarWindows(current, previous, now, 30);
    });

    it.each<[string, number]>([
      ['Last 7 days', 7],
      ['Last 90 days', 90],
    ])('%s: adjacent, same calendar length across Denver fall-back', async (label, days) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const now = localNoon(2026, 11, 3);
      vi.setSystemTime(now);
      const { user } = await windowsAfterSelectingHeartRate();

      await user.click(screen.getByRole('button', { name: /Time range/ }));
      await user.click(screen.getByRole('menuitem', { name: label }));

      const current = lastCurrentParams() as { from: string; to: string };
      const previous = mockUseVitals.mock.calls
        .map((call) => call[1] as { from: string; to: string })
        .filter(isPreviousWindow)
        .pop()!;
      expectCalendarWindows(current, previous, now, days);
    });
  });

  // ── Latest-reading hero ────────────────────────────────────────────────────

  it('shows the latest-reading hero with average/lowest/highest for one BP reading each', async () => {
    const user = userEvent.setup();
    serveVitals([
      makeVital({
        id: 'bp-1',
        vital_type: 'blood_pressure',
        value1: 140,
        value2: 70,
        recorded_at: '2026-06-15T16:00:00.000Z',
      }),
      makeVital({
        id: 'bp-2',
        vital_type: 'blood_pressure',
        value1: 104,
        value2: 95,
        recorded_at: '2026-06-14T16:00:00.000Z',
      }),
      makeVital({
        id: 'bp-3',
        vital_type: 'blood_pressure',
        value1: 120,
        value2: 80,
        recorded_at: '2026-06-13T16:00:00.000Z',
      }),
    ]);
    renderPage();

    await user.click(screen.getByRole('radio', { name: 'Blood pressure' }));

    // The hero eyebrow says "Latest", as on mobile: it marks this ONE number as
    // the most recent reading, which is what separates it from the three period
    // stats below the hairline. Which vital is on screen is already said by the
    // selected chip.
    expect(screen.getByText('Latest')).toBeInTheDocument();
    // Lowest/Highest come from ONE reading each (by systolic) — never a
    // componentwise min/max of systolic and diastolic independently, which
    // would stitch together a pair no reading actually recorded.
    expect(screen.getByText('104/95')).toBeInTheDocument();
    // "140/70" is both the latest reading (headline) AND the Highest tile.
    expect(screen.getAllByText('140/70')).toHaveLength(2);
    // Average is a per-field mean: (140+104+120)/3 ≈ 121, (70+95+80)/3 ≈ 82.
    expect(screen.getByText('121/82')).toBeInTheDocument();
  });

  // ── Logged by (mobile parity: "<time> · <First Last>", "System" when none) ──

  describe('who logged a reading', () => {
    const ana = { first_name: 'Ana', last_name: 'Ruiz' };

    it('prints the author name after the timestamp on a reading row', () => {
      serveVitals([makeVital({ id: 'v-1', users: ana })]);
      renderPage();
      expect(screen.getByText(/12:00 PM · Ana Ruiz/)).toBeInTheDocument();
    });

    it('also prints the author in the latest-reading hero', async () => {
      const user = userEvent.setup();
      serveVitals([
        makeVital({ id: 'v-1', users: ana }),
        makeVital({
          id: 'v-2',
          users: { first_name: 'Ben', last_name: 'Cole' },
          recorded_at: '2026-06-14T16:00:00.000Z',
        }),
      ]);
      renderPage();
      await user.click(screen.getByRole('radio', { name: 'Heart rate' }));
      // Hero (newest) + its own row both name Ana; Ben appears on the older row only.
      expect(screen.getAllByText(/ · Ana Ruiz/)).toHaveLength(2);
      expect(screen.getAllByText(/ · Ben Cole/)).toHaveLength(1);
    });

    it('says "System" when the reading has no author (null embed)', () => {
      serveVitals([makeVital({ id: 'v-1', users: null })]);
      renderPage();
      expect(screen.getByText(/12:00 PM · System/)).toBeInTheDocument();
    });

    it('says "System" when the users embed is missing entirely', () => {
      serveVitals([makeVital({ id: 'v-1' })]);
      renderPage();
      expect(screen.getByText(/12:00 PM · System/)).toBeInTheDocument();
    });

    it('is Spanish under es ("Sistema" for no author)', async () => {
      const { default: i18n } = await import('@/i18n');
      await i18n.changeLanguage('es');
      try {
        serveVitals([
          makeVital({ id: 'v-1', users: ana }),
          makeVital({ id: 'v-2', users: null, recorded_at: '2026-06-14T16:00:00.000Z' }),
        ]);
        renderPage();
        expect(screen.getByText(/ · Ana Ruiz/)).toBeInTheDocument();
        expect(screen.getByText(/ · Sistema/)).toBeInTheDocument();
        expect(screen.queryByText(/ · System\b/)).not.toBeInTheDocument();
      } finally {
        await i18n.changeLanguage('en');
      }
    });
  });

  it('hides the latest-reading hero and the chart when "All types" is selected', () => {
    renderPage();
    expect(screen.queryByText('Latest')).not.toBeInTheDocument();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Trend chart/ })).not.toBeInTheDocument();
  });

  it('hides the hero when the selected type has no readings in range, naming the never-logged type', async () => {
    // The default latest-vitals mock (EMPTY_LATEST) says Weight has never been
    // logged at all — mobile parity distinguishes that from "not in range".
    const user = userEvent.setup();
    renderPage(); // only a heart_rate reading is served
    await user.click(screen.getByRole('radio', { name: 'Weight' }));

    expect(screen.queryByText('Latest')).not.toBeInTheDocument();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    expect(screen.getByText('No weight readings yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log weight' })).toBeInTheDocument();
  });

  it('renders a BP reading with no diastolic as systolic-only — never "/0"', async () => {
    const user = userEvent.setup();
    serveVitals([
      makeVital({
        id: 'bp-1',
        vital_type: 'blood_pressure',
        value1: 140,
        value2: null,
        recorded_at: '2026-06-15T16:00:00.000Z',
      }),
    ]);
    renderPage();

    await user.click(screen.getByRole('radio', { name: 'Blood pressure' }));

    // Only the headline — the Average/Lowest/Highest row is hidden for a single
    // reading (it would just repeat this same number three times).
    expect(screen.getAllByText('140')).toHaveLength(1);
    expect(screen.queryByText(/\/0/)).not.toBeInTheDocument();
  });

  it('hides the Average/Lowest/Highest tile row when there is exactly one reading in range', async () => {
    const user = userEvent.setup();
    serveVitals([makeVital({ id: 'hr-1', vital_type: 'heart_rate', value1: 72 })]);
    renderPage();

    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    // The hero itself stays — only its period summary is suppressed.
    expect(screen.getByText('Latest')).toBeInTheDocument();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    expect(screen.queryByText('Lowest')).not.toBeInTheDocument();
    expect(screen.queryByText('Highest')).not.toBeInTheDocument();
  });

  it('shows the Average/Lowest/Highest tile row once there are 2+ readings in range', async () => {
    const user = userEvent.setup();
    serveVitals([
      makeVital({ id: 'hr-1', vital_type: 'heart_rate', value1: 72 }),
      makeVital({
        id: 'hr-2',
        vital_type: 'heart_rate',
        value1: 80,
        recorded_at: '2026-06-14T16:00:00.000Z',
      }),
    ]);
    renderPage();

    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    expect(screen.getByText('Average')).toBeInTheDocument();
    expect(screen.getByText('Lowest')).toBeInTheDocument();
    expect(screen.getByText('Highest')).toBeInTheDocument();
  });

  it('converts the hero + rows into the reader display unit (kg stored, lbs shown)', async () => {
    const user = userEvent.setup();
    // 68.0388555 kg canonical = exactly 150 lbs.
    serveVitals([makeVital({ id: 'w-1', vital_type: 'weight', value1: 68.0388555, unit: 'kg' })]);
    renderPage();

    await user.click(screen.getByRole('radio', { name: 'Weight' }));

    expect(screen.getByText('150')).toBeInTheDocument(); // hero headline
    expect(screen.getByText('150 lbs')).toBeInTheDocument(); // list row
  });

  // ── Trend ─────────────────────────────────────────────────────────────────

  // Trend is now mobile's signed AVERAGE DELTA ("Average +20 bpm vs the
  // previous 30 days"), not a percent-of-average comparison — see
  // src/lib/vitalsTrend.ts's `formatAverageDelta`.

  it('says the average is up by a signed delta, with the up glyph', async () => {
    const user = userEvent.setup();
    serveVitals(
      [
        makeVital({ id: 'hr-1', value1: 100 }),
        makeVital({ id: 'hr-2', value1: 100, recorded_at: '2026-06-14T16:00:00.000Z' }),
      ],
      [makeVital({ id: 'hr-0', value1: 80, recorded_at: '2026-05-14T16:00:00.000Z' })]
    );
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    const trendText = screen.getByText('Average +20 bpm vs the previous 30 days');
    expect(trendText).toBeInTheDocument();
    expect(trendText.parentElement?.querySelector('svg')).not.toBeNull();
  });

  it('says the average is down by a signed delta, with the real minus sign', async () => {
    const user = userEvent.setup();
    serveVitals(
      [
        makeVital({ id: 'hr-1', value1: 80 }),
        makeVital({ id: 'hr-2', value1: 80, recorded_at: '2026-06-14T16:00:00.000Z' }),
      ],
      [makeVital({ id: 'hr-0', value1: 100, recorded_at: '2026-05-14T16:00:00.000Z' })]
    );
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    // U+2212 MINUS SIGN, not a hyphen.
    expect(screen.getByText('Average −20 bpm vs the previous 30 days')).toBeInTheDocument();
  });

  it('rounds a sub-1-unit heart-rate move to "same average", with the remove glyph (mobile parity)', async () => {
    const user = userEvent.setup();
    serveVitals(
      [makeVital({ id: 'hr-1', value1: 100 })],
      [makeVital({ id: 'hr-0', value1: 100.5, recorded_at: '2026-05-14T16:00:00.000Z' })]
    );
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    const sameText = screen.getByText('Same average as the previous 30 days');
    expect(sameText).toBeInTheDocument();
    // Mobile shows a `remove` (—) glyph beside the "same" sentence rather than no icon.
    expect(sameText.parentElement?.querySelector('svg')).not.toBeNull();
  });

  it('shows no trend at all with nothing to compare against', async () => {
    const user = userEvent.setup();
    serveVitals([makeVital({ id: 'hr-1', value1: 100 })], []);
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    expect(screen.queryByText('Same average as the previous 30 days')).not.toBeInTheDocument();
    expect(screen.queryByText(/vs the previous/)).not.toBeInTheDocument();
  });

  it('shows both components for a blood-pressure trend, in a clay/dusk-neutral single line', async () => {
    const user = userEvent.setup();
    serveVitals(
      [
        makeVital({ id: 'bp-1', vital_type: 'blood_pressure', value1: 124, value2: 79 }),
        makeVital({
          id: 'bp-2',
          vital_type: 'blood_pressure',
          value1: 124,
          value2: 79,
          recorded_at: '2026-06-14T16:00:00.000Z',
        }),
      ],
      [
        makeVital({
          id: 'bp-0',
          vital_type: 'blood_pressure',
          value1: 120,
          value2: 80,
          recorded_at: '2026-05-14T16:00:00.000Z',
        }),
      ]
    );
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Blood pressure' }));

    // Systolic +4 (up), diastolic −1 (down) — a MIXED direction renders no icon.
    const trendText = screen.getByText('Average +4/−1 mmHg vs the previous 30 days');
    expect(trendText).toBeInTheDocument();
    expect(trendText.parentElement?.querySelector('svg')).toBeNull();
  });

  // ── Chart ─────────────────────────────────────────────────────────────────

  it('does not plot a chart from a single reading', async () => {
    const user = userEvent.setup();
    serveVitals([makeVital({ id: 'hr-1', value1: 72 })]);
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    expect(screen.queryByRole('img', { name: /Trend chart/ })).not.toBeInTheDocument();
  });

  it('labels the x axis with the range start, a midpoint, and "Today" — not the first/last reading', async () => {
    // Pinned so "range start" / "midpoint" resolve to fixed, assertable dates
    // (not the real clock) — mobile parity: the axis describes the QUERY
    // WINDOW, not wherever the loaded readings happen to fall.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T16:00:00.000Z'));
    try {
      const user = userEvent.setup();
      serveVitals([
        // Both readings sit in the LAST couple of days of the 30-day window —
        // a first/last-reading axis would mislabel the start as mid-June.
        makeVital({ id: 'hr-1', value1: 72, recorded_at: '2026-06-15T16:00:00.000Z' }),
        makeVital({ id: 'hr-2', value1: 80, recorded_at: '2026-06-14T16:00:00.000Z' }),
      ]);
      renderPage();
      await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

      // Range start = 2026-06-15 minus 30 days = 2026-05-16 (America/New_York).
      expect(screen.getByText('May 16')).toBeInTheDocument();
      expect(screen.getByText('Today')).toBeInTheDocument();
      // NEITHER reading's own day ("Jun 15"/"Jun 14") is the axis label the
      // legacy first/last scheme would have shown for the start.
      expect(screen.queryByText('Jun 14')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('plots one terracotta line for 2+ heart-rate readings', async () => {
    const user = userEvent.setup();
    serveVitals([
      makeVital({ id: 'hr-1', value1: 72 }),
      makeVital({ id: 'hr-2', value1: 80, recorded_at: '2026-06-14T16:00:00.000Z' }),
    ]);
    const { container } = renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    const chart = screen.getByRole('img', { name: /Trend chart/ });
    expect(chart).toHaveAccessibleName(/Lowest 72 bpm/);
    expect(chart).toHaveAccessibleName(/highest 80 bpm/i);
    expect(chart).toHaveAccessibleName(/latest 72 bpm/i);

    const lines = container.querySelectorAll('[data-testid^="vitals-chart-line-"]');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveAttribute('stroke', 'var(--color-terracotta)');
  });

  it('plots systolic (clay) and diastolic (dusk) as two lines with a legend', async () => {
    const user = userEvent.setup();
    serveVitals([
      makeVital({ id: 'bp-1', vital_type: 'blood_pressure', value1: 140, value2: 90 }),
      makeVital({
        id: 'bp-2',
        vital_type: 'blood_pressure',
        value1: 120,
        value2: 80,
        recorded_at: '2026-06-14T16:00:00.000Z',
      }),
    ]);
    const { container } = renderPage();
    await user.click(screen.getByRole('radio', { name: 'Blood pressure' }));

    const lines = container.querySelectorAll('[data-testid^="vitals-chart-line-"]');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveAttribute('stroke', 'var(--color-clay)');
    expect(lines[1]).toHaveAttribute('stroke', 'var(--color-dusk)');
    // Only the first series is tinted underneath.
    expect(container.querySelectorAll('[data-testid^="vitals-chart-area-"]')).toHaveLength(1);
    // The legend names which line is which.
    expect(screen.getByText('Systolic')).toBeInTheDocument();
    expect(screen.getByText('Diastolic')).toBeInTheDocument();
  });

  it('leaves a BP reading with no diastolic OFF the diastolic line', async () => {
    // Mobile substitutes the systolic value there, drawing a diastolic reading
    // that was never taken. This app omits the point instead.
    const user = userEvent.setup();
    serveVitals([
      makeVital({ id: 'bp-1', vital_type: 'blood_pressure', value1: 140, value2: null }),
      makeVital({
        id: 'bp-2',
        vital_type: 'blood_pressure',
        value1: 120,
        value2: 80,
        recorded_at: '2026-06-14T16:00:00.000Z',
      }),
    ]);
    const { container } = renderPage();
    await user.click(screen.getByRole('radio', { name: 'Blood pressure' }));

    const diastolic = container.querySelector('[data-testid="vitals-chart-line-1"]')!;
    // One point only ⇒ a bare moveto, no cubic segment.
    expect(diastolic.getAttribute('d')).not.toContain('C');
  });

  // ── List shape ────────────────────────────────────────────────────────────

  it('wraps each type group in an expanded-by-default accordion with a count', () => {
    serveVitals([
      makeVital({ id: 'hr-1', vital_type: 'heart_rate', value1: 72 }),
      makeVital({
        id: 'hr-2',
        vital_type: 'heart_rate',
        value1: 80,
        recorded_at: '2026-06-14T16:00:00.000Z',
      }),
      makeVital({ id: 'w-1', vital_type: 'weight', value1: 70 }),
    ]);
    renderPage();

    const hrHeader = screen.getByRole('button', { name: /Heart rate/i, expanded: true });
    expect(hrHeader).toHaveTextContent('2'); // reading count in the meta slot
    expect(screen.getByRole('button', { name: /Weight/i, expanded: true })).toBeInTheDocument();
  });

  it('drops the accordion for a single selected type — the chip already names it', async () => {
    const user = userEvent.setup();
    serveVitals([
      makeVital({ id: 'hr-1', vital_type: 'heart_rate', value1: 72 }),
      makeVital({
        id: 'hr-2',
        vital_type: 'heart_rate',
        value1: 80,
        recorded_at: '2026-06-14T16:00:00.000Z',
      }),
    ]);
    renderPage();

    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    expect(screen.queryByRole('button', { name: /Heart rate/i, expanded: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Collapse all' })).toBeNull();
    expect(screen.getByText('72 bpm')).toBeInTheDocument();
    expect(screen.getByText('80 bpm')).toBeInTheDocument();
  });

  it('collapsing a group keeps its readings mounted (visually hidden)', async () => {
    const user = userEvent.setup();
    renderPage();

    const header = screen.getByRole('button', { name: /Heart rate/i, expanded: true });
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');

    const panel = document.getElementById('vitals-group-heart_rate-accordion-panel');
    // Collapsed = grid row collapsed to 0fr (visually hidden) but still 1fr
    // under print, and `inert` keeps it out of focus/the a11y tree.
    expect(panel?.className).toContain('[grid-template-rows:0fr]');
    expect(panel?.className).toContain('print:[grid-template-rows:1fr]');
    expect(panel).toHaveAttribute('inert');
    // Reading still in the DOM.
    expect(within(panel as HTMLElement).getByText('72 bpm')).toBeInTheDocument();
  });

  it('Expand all / Collapse all toggles every group', async () => {
    const user = userEvent.setup();
    serveVitals([
      makeVital({ id: 'hr-1', vital_type: 'heart_rate', value1: 72 }),
      makeVital({ id: 'w-1', vital_type: 'weight', value1: 70 }),
    ]);
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(
      screen.getByRole('button', { name: /Heart rate/i, expanded: false })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Weight/i, expanded: false })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByRole('button', { name: /Heart rate/i, expanded: true })).toBeInTheDocument();
  });
});
