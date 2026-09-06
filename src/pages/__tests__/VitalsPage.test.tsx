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
const unitPrefs = { weight_unit: 'lbs', glucose_unit: 'mg/dL' };

vi.mock('@/hooks/useVitals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useVitals')>();
  return {
    ...actual,
    useVitals: (circleId: string | undefined, params: unknown) => mockUseVitals(circleId, params),
    useDeleteVital: () => ({ mutateAsync: mockDeleteMutate, isPending: false }),
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

  it('reads a SECOND window of the same length, ending where the active one starts', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    const current = lastCurrentParams() as { from: string; to: string };
    const previous = mockUseVitals.mock.calls
      .map((call) => call[1] as { from: string; to: string })
      .filter(isPreviousWindow)
      .pop()!;

    expect(previous.to).toBe(current.from);
    expect(Date.parse(current.to) - Date.parse(current.from)).toBe(
      Date.parse(previous.to) - Date.parse(previous.from)
    );
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

  it('hides the latest-reading hero and the chart when "All types" is selected', () => {
    renderPage();
    expect(screen.queryByText('Latest')).not.toBeInTheDocument();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Trend chart/ })).not.toBeInTheDocument();
  });

  it('hides the hero when the selected type has no readings in range', async () => {
    const user = userEvent.setup();
    renderPage(); // only a heart_rate reading is served
    await user.click(screen.getByRole('radio', { name: 'Weight' }));

    expect(screen.queryByText('Latest')).not.toBeInTheDocument();
    expect(screen.queryByText('Average')).not.toBeInTheDocument();
    expect(screen.getByText('No readings yet')).toBeInTheDocument();
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

  it('says the average is UP against the previous period', async () => {
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

    expect(screen.getByText('Up 25.0% vs previous period')).toBeInTheDocument();
  });

  it('says the average is DOWN against the previous period', async () => {
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

    expect(screen.getByText('Down 20.0% vs previous period')).toBeInTheDocument();
  });

  it('calls a sub-1% move Stable rather than a direction, with the remove glyph (mobile parity)', async () => {
    const user = userEvent.setup();
    serveVitals(
      [makeVital({ id: 'hr-1', value1: 100 })],
      [makeVital({ id: 'hr-0', value1: 100.5, recorded_at: '2026-05-14T16:00:00.000Z' })]
    );
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    const stableText = screen.getByText('Stable');
    expect(stableText).toBeInTheDocument();
    // Mobile shows a `remove` (—) glyph beside "Stable" rather than no icon.
    expect(stableText.parentElement?.querySelector('svg')).not.toBeNull();
  });

  it('shows no trend at all with nothing to compare against', async () => {
    const user = userEvent.setup();
    serveVitals([makeVital({ id: 'hr-1', value1: 100 })], []);
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    expect(screen.queryByText('Stable')).not.toBeInTheDocument();
    expect(screen.queryByText(/vs previous period/)).not.toBeInTheDocument();
  });

  // ── Chart ─────────────────────────────────────────────────────────────────

  it('does not plot a chart from a single reading', async () => {
    const user = userEvent.setup();
    serveVitals([makeVital({ id: 'hr-1', value1: 72 })]);
    renderPage();
    await user.click(screen.getByRole('radio', { name: 'Heart rate' }));

    expect(screen.queryByRole('img', { name: /Trend chart/ })).not.toBeInTheDocument();
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
