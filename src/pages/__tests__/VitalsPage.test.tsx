import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@/i18n';
import VitalsPage from '../VitalsPage';
import type { HealthVital } from '@/api/vitals';

// Task 6.7 — VitalsPage tests: manual-only edit/delete gating, !canEdit hides
// all write affordances, synced readings render read-only.
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
    useVitals: (circleId: string, params: unknown) => mockUseVitals(circleId, params),
    useDeleteVital: () => ({ mutateAsync: mockDeleteMutate, isPending: false }),
  };
});

vi.mock('@/hooks/useUnitPreferences', () => ({
  useUnitPreferences: () => ({ data: unitPrefs }),
}));

vi.mock('@/hooks/useCircle', () => ({
  useCircle: (circleId: string) => mockUseCircle(circleId),
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
    source: 'manual',
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

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/circles/circle-1/vitals']}>
      <Routes>
        <Route path="/circles/:circleId/vitals" element={<VitalsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseCircle.mockReturnValue({ canEdit: true, timezone: 'America/New_York' });
  mockUseVitals.mockReturnValue(
    vitalsResult([
      makeVital({ id: 'v-1', vital_type: 'heart_rate', value1: 72, source: 'manual' }),
    ])
  );
});

describe('VitalsPage', () => {
  it('renders a reading in the user display units', () => {
    renderPage();
    expect(screen.getByText('72 bpm')).toBeInTheDocument();
  });

  it('shows edit + delete for manual readings when canEdit', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Edit reading/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete reading/ })).toBeInTheDocument();
  });

  it('hides edit/delete for SYNCED readings and shows a synced badge', () => {
    mockUseVitals.mockReturnValue(
      vitalsResult([
        makeVital({ id: 'v-sync', source: 'apple_health', value1: 65 }),
      ])
    );
    renderPage();

    expect(screen.getByText('65 bpm')).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit reading/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete reading/ })).not.toBeInTheDocument();
  });

  it('hides ALL write affordances when canEdit is false', () => {
    mockUseCircle.mockReturnValue({ canEdit: false, timezone: 'America/New_York' });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Add reading' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit reading/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete reading/ })).not.toBeInTheDocument();
    // Read view still renders the reading.
    expect(screen.getByText('72 bpm')).toBeInTheDocument();
  });

  it('opens the add modal from "Add reading"', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Add reading' }));
    expect(screen.getByRole('dialog', { name: 'add-vital-modal' })).toBeInTheDocument();
  });

  it('opens the edit modal for a manual reading', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Edit reading/ }));
    const dialog = screen.getByRole('dialog', { name: 'edit-vital-modal' });
    expect(dialog).toHaveTextContent('editing-v-1');
  });

  it('confirms then fires delete', async () => {
    mockDeleteMutate.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /Delete reading/ }));
    // Confirm dialog appears; confirm with its Delete action.
    const confirm = screen.getByRole('dialog');
    const confirmBtn = within(confirm).getByRole('button', { name: 'Delete' });
    await user.click(confirmBtn);

    expect(mockDeleteMutate).toHaveBeenCalledWith('v-1');
  });

  it('shows the empty state when there are no readings', () => {
    mockUseVitals.mockReturnValue(vitalsResult([]));
    renderPage();
    expect(screen.getByText('No readings yet')).toBeInTheDocument();
    // The empty state offers its own primary CTA when the user can edit.
    expect(screen.getByRole('button', { name: 'Log a reading' })).toBeInTheDocument();
  });

  // ── Type-group accordions ─────────────────────────────────────────────────

  it('wraps each type group in an expanded-by-default accordion with a count', () => {
    mockUseVitals.mockReturnValue(
      vitalsResult([
        makeVital({ id: 'hr-1', vital_type: 'heart_rate', value1: 72 }),
        makeVital({ id: 'hr-2', vital_type: 'heart_rate', value1: 80 }),
        makeVital({ id: 'w-1', vital_type: 'weight', value1: 70 }),
      ])
    );
    renderPage();

    // Two groups, each a disclosure header (h2) expanded by default.
    const hrHeader = screen.getByRole('button', { name: /Heart rate/i });
    expect(hrHeader).toHaveAttribute('aria-expanded', 'true');
    expect(hrHeader).toHaveTextContent('2'); // reading count in the meta slot
    expect(screen.getByRole('button', { name: /Weight/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('collapsing a group keeps its readings mounted (visually hidden)', async () => {
    const user = userEvent.setup();
    renderPage();

    const header = screen.getByRole('button', { name: /Heart rate/i });
    await user.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');

    const panel = document.getElementById('vitals-group-heart_rate-accordion-panel');
    expect(panel?.className).toContain('hidden');
    expect(panel?.className).toContain('print:block');
    // Reading still in the DOM.
    expect(within(panel as HTMLElement).getByText('72 bpm')).toBeInTheDocument();
  });

  it('Expand all / Collapse all toggles every group', async () => {
    const user = userEvent.setup();
    mockUseVitals.mockReturnValue(
      vitalsResult([
        makeVital({ id: 'hr-1', vital_type: 'heart_rate', value1: 72 }),
        makeVital({ id: 'w-1', vital_type: 'weight', value1: 70 }),
      ])
    );
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.getByRole('button', { name: /Heart rate/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByRole('button', { name: /Weight/i })).toHaveAttribute(
      'aria-expanded',
      'false'
    );

    await user.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getByRole('button', { name: /Heart rate/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });
});
