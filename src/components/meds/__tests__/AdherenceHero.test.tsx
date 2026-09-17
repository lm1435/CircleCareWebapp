// The History tab's hero. Two things it must never do: claim a trend it does
// not have, and accuse a circle of 0% adherence when nothing was ever
// scheduled.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import { AdherenceHero } from '../AdherenceHero';
import { AdherenceExportDialog } from '../AdherenceExportDialog';
import type { AdherenceReport } from '@/api/medicationConfirmations';

const mockUseAdherenceReport = vi.fn();
vi.mock('@/hooks/useMedConfirmation', () => ({
  useAdherenceReport: (circleId: string, period: string) =>
    mockUseAdherenceReport(circleId, period),
}));

// The export itself is the hook's business (hooks/__tests__/useAdherenceExport);
// here it is a spy so the chooser's wiring — which period, when, and whether
// the dialog closes — is what is under test.
const mockExportPdf = vi.fn();
const mockUseAdherenceExport = vi.fn();
vi.mock('@/hooks/useAdherenceExport', () => ({
  useAdherenceExport: (options: { circleId: string }) => mockUseAdherenceExport(options),
}));

function report(summary: Partial<AdherenceReport['summary']>): { data: AdherenceReport } {
  return {
    data: {
      period_days: 30,
      start_date: '2026-08-07',
      end_date: '2026-09-05',
      summary: {
        total_scheduled: 60,
        taken: 50,
        taken_late: 2,
        not_marked: 8,
        skipped: 0,
        adherence_rate: 82,
        trend: 'stable',
        trend_change: 0,
        ...summary,
      },
      daily_breakdown: [],
      by_medication: [],
      time_breakdown: [],
    } as AdherenceReport,
  };
}

function renderHero() {
  return render(<AdherenceHero circleId="circle-1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExportPdf.mockResolvedValue(true);
  mockUseAdherenceExport.mockReturnValue({
    exportPdf: mockExportPdf,
    isExporting: false,
    error: null,
    clearError: vi.fn(),
  });
});

describe('AdherenceHero', () => {
  it('asks for the 30-day window and shows the rounded rate', () => {
    mockUseAdherenceReport.mockReturnValue({ ...report({ adherence_rate: 81.6 }), isPending: false });
    renderHero();

    expect(mockUseAdherenceReport).toHaveBeenCalledWith('circle-1', '30d');
    expect(screen.getByText('82%')).toBeInTheDocument();
    expect(screen.getByText('Adherence · 30 days')).toBeInTheDocument();
  });

  it('names an improving trend in moss with the up arrow', () => {
    mockUseAdherenceReport.mockReturnValue({
      ...report({ trend: 'improving', trend_change: 7 }),
      isPending: false,
    });
    renderHero();

    const trend = screen.getByText('+7% vs last month');
    expect(trend.className).toContain('text-moss');
  });

  // The sign is EXPLICIT on a decline. Mobile passes `sign: change > 0 ? '+' :
  // ''`, so a 7-point drop rendered as "7% vs last month" — the same words a
  // 7-point rise would get, in a different colour. Colour alone is not a
  // signal (WCAG 2.1 AA, SC 1.4.1) and here it was not even a correct one.
  it('names a declining trend in terracotta, with the sign in the text', () => {
    mockUseAdherenceReport.mockReturnValue({
      ...report({ trend: 'declining', trend_change: -7 }),
      isPending: false,
    });
    renderHero();

    const trend = screen.getByText('-7% vs last month');
    expect(trend.className).toContain('text-terracotta');
  });

  // THE BACKEND CALLS ANYTHING INSIDE ±5 POINTS 'stable' while still sending
  // the real `trend_change`. Keying the copy off the WORD printed "Same as last
  // month" over a genuine five-point slide — the size of change a caregiver
  // most needs to catch, because it is the one still recoverable. Mobile shows
  // the signed figure whenever `trend_change !== 0`.
  it('shows a signed five-point slide the backend labelled stable', () => {
    mockUseAdherenceReport.mockReturnValue({
      ...report({ trend: 'stable', trend_change: -5 }),
      isPending: false,
    });
    renderHero();

    const trend = screen.getByText('-5% vs last month');
    expect(trend.className).toContain('text-terracotta');
    expect(screen.queryByText('Same as last month')).toBeNull();
  });

  it('shows a signed five-point gain the backend labelled stable', () => {
    mockUseAdherenceReport.mockReturnValue({
      ...report({ trend: 'stable', trend_change: 5 }),
      isPending: false,
    });
    renderHero();

    const trend = screen.getByText('+5% vs last month');
    expect(trend.className).toContain('text-moss');
  });

  it('says so in words when nothing changed', () => {
    mockUseAdherenceReport.mockReturnValue({
      ...report({ trend: 'stable', trend_change: 0 }),
      isPending: false,
    });
    renderHero();

    expect(screen.getByText('Same as last month')).toBeInTheDocument();
    expect(screen.queryByText(/vs last month/)).toBeNull();
  });

  // Zero is zero whatever the verdict says: "+0% vs last month" reads as a
  // measured claim about nothing.
  it('treats a zero change as unchanged even when the trend says improving', () => {
    mockUseAdherenceReport.mockReturnValue({
      ...report({ trend: 'improving', trend_change: 0 }),
      isPending: false,
    });
    renderHero();

    expect(screen.getByText('Same as last month')).toBeInTheDocument();
  });

  // "0% adherence" over a circle whose medications were added yesterday is a
  // false accusation, not a statistic. HistoryList's empty state says the true
  // thing instead.
  it('renders nothing when no dose was ever scheduled in the window', () => {
    mockUseAdherenceReport.mockReturnValue({
      ...report({ total_scheduled: 0, adherence_rate: 0 }),
      isPending: false,
    });
    const { container } = renderHero();

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the report failed to load', () => {
    mockUseAdherenceReport.mockReturnValue({ data: undefined, isPending: false });
    const { container } = renderHero();

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a busy skeleton while the report is in flight', () => {
    mockUseAdherenceReport.mockReturnValue({ data: undefined, isPending: true });
    renderHero();

    expect(screen.getByText('Loading adherence…')).toBeInTheDocument();
  });
});

// The "Export report" button and its period chooser (plan
// docs/plans/pdf-export-parity.md, decision 9). Export is read-only, so there
// is no canEdit gate — a view-only member sees the same button mobile shows.
describe('AdherenceHero — export report', () => {
  function openChooser(user: ReturnType<typeof userEvent.setup>) {
    mockUseAdherenceReport.mockReturnValue({ ...report({}), isPending: false });
    renderHero();
    return user.click(screen.getByRole('button', { name: 'Export report' }));
  }

  it('renders the Export report button in the reserved slot when a summary exists', () => {
    mockUseAdherenceReport.mockReturnValue({ ...report({}), isPending: false });
    renderHero();

    expect(mockUseAdherenceExport).toHaveBeenCalledWith({ circleId: 'circle-1' });
    expect(screen.getByRole('button', { name: 'Export report' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the period chooser with six periods and "Last 30 days" preselected', async () => {
    const user = userEvent.setup();
    await openChooser(user);

    const dialog = screen.getByRole('dialog', { name: 'Adherence report' });
    expect(within(dialog).getByRole('radiogroup', { name: 'Select report period' })).toBeInTheDocument();
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual([
      '7d',
      '14d',
      '30d',
      '60d',
      '90d',
      'all',
    ]);
    expect(within(dialog).getByRole('radio', { name: 'Last 30 days' })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: 'All time' })).not.toBeChecked();
    expect(mockExportPdf).not.toHaveBeenCalled();
  });

  it('exports the chosen period on confirm and closes on success', async () => {
    const user = userEvent.setup();
    await openChooser(user);
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('radio', { name: 'Last 7 days' }));
    await user.click(within(dialog).getByRole('button', { name: 'Export report' }));

    expect(mockExportPdf).toHaveBeenCalledTimes(1);
    expect(mockExportPdf).toHaveBeenCalledWith('7d');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancel closes the chooser without exporting', async () => {
    const user = userEvent.setup();
    await openChooser(user);
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockExportPdf).not.toHaveBeenCalled();
  });

  // The toast has already said what went wrong; "try again" is one click.
  it('stays open, period intact, when the export fails', async () => {
    mockExportPdf.mockResolvedValue(false);
    const user = userEvent.setup();
    await openChooser(user);
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('radio', { name: 'Last 90 days' }));
    await user.click(within(dialog).getByRole('button', { name: 'Export report' }));

    expect(mockExportPdf).toHaveBeenCalledWith('90d');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: 'Last 90 days' })).toBeChecked();
  });

  it('while exporting: confirm is busy, radios are disabled, and the wait is announced', () => {
    render(
      <AdherenceExportDialog open onClose={vi.fn()} exportPdf={mockExportPdf} isExporting />
    );
    const dialog = screen.getByRole('dialog');

    const confirm = within(dialog).getByRole('button', { name: 'Export report' });
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    for (const radio of within(dialog).getAllByRole('radio')) expect(radio).toBeDisabled();
    expect(within(dialog).getByRole('status')).toHaveTextContent('Generating PDF...');
  });

  it('shows no button (and no dialog) when nothing was ever scheduled', () => {
    mockUseAdherenceReport.mockReturnValue({
      ...report({ total_scheduled: 0, adherence_rate: 0 }),
      isPending: false,
    });
    const { container } = renderHero();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'Export report' })).toBeNull();
  });
});
