// The web adherence-report export (plan docs/plans/pdf-export-parity.md, B4).
//
// What matters here is invisible in the printed page: that the CHOSEN period
// is the one fetched (the hero only ever shows 30d), that vitals are asked for
// the report's OWN date range and only when premium applies, that a vitals
// failure cannot sink the report, and that analytics carries a stage + code
// and never the document or the file title (it holds the recipient's name).

import { act, renderHook, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api/medicationConfirmations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/medicationConfirmations')>();
  return { ...actual, getAdherenceReport: vi.fn() };
});

vi.mock('@/api/circleMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circleMembers')>();
  return { ...actual, getCircleDetail: vi.fn() };
});

vi.mock('@/api/vitals', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/vitals')>();
  return { ...actual, getVitals: vi.fn() };
});

// Keep the real `PrintError` so the hook's `instanceof` checks see the class
// it imports; only the hand-off to the browser is stubbed.
vi.mock('@/pdf/printHtml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pdf/printHtml')>();
  return { ...actual, printHtml: vi.fn() };
});

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

vi.mock('@/lib/analytics', () => ({
  Analytics: { adherenceReportExported: vi.fn(), adherenceReportExportFailed: vi.fn() },
}));

// The hook reads whoever is signed in AT EXPORT TIME through a static store
// read — pin the viewer so the "Prepared by" line is deterministic.
vi.mock('@/store/authStore', () => ({
  useAuthStore: {
    getState: () => ({ user: { id: 'u1', email: 'a@x.test', first_name: 'Ana', last_name: 'Lopez' } }),
  },
}));

import { getAdherenceReport, type AdherenceReport } from '@/api/medicationConfirmations';
import { getCircleDetail, type CircleDetail } from '@/api/circleMembers';
import { getVitals, type HealthVital } from '@/api/vitals';
import { printHtml, PrintError } from '@/pdf/printHtml';
import { Analytics } from '@/lib/analytics';
import { queryClient } from '@/lib/queryClient';
import { useAdherenceExport } from '@/hooks/useAdherenceExport';

const CIRCLE_ID = 'circle-1';

const mockReport = vi.mocked(getAdherenceReport);
const mockCircle = vi.mocked(getCircleDetail);
const mockVitals = vi.mocked(getVitals);
const mockPrint = vi.mocked(printHtml);

function report(periodDays: number): AdherenceReport {
  return {
    period_days: periodDays,
    start_date: '2026-08-30',
    end_date: '2026-09-05',
    summary: {
      total_scheduled: 14,
      taken: 12,
      taken_late: 1,
      not_marked: 2,
      skipped: 0,
      adherence_rate: 85.7,
      trend: 'stable',
      trend_change: 0,
    },
    daily_breakdown: [
      { date: '2026-09-05', taken: 2, not_marked: 0, skipped: 0, total: 2, adherence_rate: 100 },
    ],
    by_medication: [
      { name: 'Metformin', dosage: '500 mg', taken: 12, not_marked: 2, skipped: 0, adherence_rate: 85.7 },
    ],
    time_breakdown: [{ time: '08:00', taken: 12, not_marked: 2, total: 14, adherence_rate: 85.7 }],
  } as AdherenceReport;
}

function circle(overrides: Partial<CircleDetail> = {}): CircleDetail {
  return {
    id: CIRCLE_ID,
    name: 'Lopez family',
    recipient_name: 'Rosa Lopez',
    recipient_photo_url: null,
    recipient_dob: '1950-03-02',
    recipient_conditions: null,
    owner_id: 'u1',
    created_at: '2026-01-01T00:00:00Z',
    is_self_care: false,
    care_recipient_timezone: 'America/New_York',
    members: [],
    access_level: 'full',
    is_premium_circle: false,
    can_edit: true,
    view_only: false,
    ...overrides,
  };
}

const bloodPressure: HealthVital = {
  id: 'v1',
  circle_id: CIRCLE_ID,
  vital_type: 'blood_pressure',
  value1: 128,
  value2: 82,
  unit: 'mmHg',
  recorded_at: '2026-09-03T14:00:00Z',
} as HealthVital;

function printedHtml(): string {
  const call = mockPrint.mock.calls[0];
  if (!call) throw new Error('printHtml was not called');
  return call[0].html;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The hook goes through the SINGLETON query client so it needs no provider;
  // a report cached by one test must not serve the next.
  queryClient.clear();
  mockReport.mockResolvedValue(report(7));
  mockCircle.mockResolvedValue(circle());
  mockVitals.mockResolvedValue([]);
  mockPrint.mockResolvedValue(undefined);
});

describe('useAdherenceExport', () => {
  it('fetches the CHOSEN period, prints under the mobile file name and reports the period', async () => {
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.exportPdf('7d');
    });

    expect(ok).toBe(true);
    expect(mockReport).toHaveBeenCalledWith(CIRCLE_ID, '7d');
    expect(mockCircle).toHaveBeenCalledWith(CIRCLE_ID);
    expect(mockPrint).toHaveBeenCalledTimes(1);
    expect(mockPrint.mock.calls[0][0].title).toBe('CircleCare_Adherence_Rosa_Lopez_7d');
    expect(Analytics.adherenceReportExported).toHaveBeenCalledWith(CIRCLE_ID, '7d');
    expect(Analytics.adherenceReportExportFailed).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.isExporting).toBe(false);
  });

  it('names the signed-in viewer and the recipient in the document', async () => {
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    await act(async () => {
      await result.current.exportPdf('7d');
    });

    const html = printedHtml();
    expect(html).toContain('Prepared by Ana Lopez');
    // The fixture's circle NAME ('Lopez family') and recipient_name ('Rosa Lopez')
    // differ on purpose: the report is ABOUT the recipient, so she heads it and
    // the circle is only the subline. A bare "contains 'Rosa Lopez'" passes even
    // with the two swapped (both names are printed then), so pin the slots.
    expect(html).toContain('<div class="patient-name">Rosa Lopez</div>');
    expect(html).not.toContain('<div class="patient-name">Lopez family</div>');
    expect(html).toMatch(/margin-top:2px">Lopez family<\/div>/);
    expect(html).toContain('Metformin');
  });

  it('premium: asks for vitals over the REPORT range and summarises them into the document', async () => {
    mockCircle.mockResolvedValue(circle({ is_premium_circle: true }));
    mockVitals.mockResolvedValue([bloodPressure]);
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    await act(async () => {
      await result.current.exportPdf('7d');
    });

    expect(mockVitals).toHaveBeenCalledWith(CIRCLE_ID, { from: '2026-08-30', to: '2026-09-05' });
    const html = printedHtml();
    expect(html).toContain('Health vitals');
    // The label comes from the web `vitals:` namespace via the adapter's key
    // map — never the raw `blood_pressure` type.
    expect(html).toContain('Blood pressure');
    expect(html).not.toContain('vitals.types.blood_pressure');
  });

  it('non-premium: never asks for vitals', async () => {
    mockCircle.mockResolvedValue(circle({ is_premium_circle: false }));
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    await act(async () => {
      await result.current.exportPdf('30d');
    });

    expect(mockVitals).not.toHaveBeenCalled();
    expect(mockPrint).toHaveBeenCalledTimes(1);
    expect(printedHtml()).not.toContain('Health vitals');
  });

  // Mobile parity: the vitals table is a bonus section, not a dependency.
  it('a vitals failure does not block the report', async () => {
    mockCircle.mockResolvedValue(circle({ is_premium_circle: true }));
    mockVitals.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.exportPdf('7d');
    });

    expect(ok).toBe(true);
    expect(mockPrint).toHaveBeenCalledTimes(1);
    expect(Analytics.adherenceReportExported).toHaveBeenCalledWith(CIRCLE_ID, '7d');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('a print timeout is reported as stage "timeout" with its code, and toasted', async () => {
    mockPrint.mockRejectedValue(new PrintError('PRINT_TIMEOUT'));
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.exportPdf('7d');
    });

    expect(ok).toBe(false);
    expect(Analytics.adherenceReportExportFailed).toHaveBeenCalledWith({
      stage: 'timeout',
      code: 'PRINT_TIMEOUT',
    });
    expect(Analytics.adherenceReportExported).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Failed to generate report. Please try again.', 'error');
    expect(result.current.error).toBe('Failed to generate report. Please try again.');
    expect(result.current.isExporting).toBe(false);
  });

  it('a print failure is reported as stage "print"', async () => {
    mockPrint.mockRejectedValue(new PrintError('PRINT_FAILED'));
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    await act(async () => {
      await result.current.exportPdf('7d');
    });

    expect(Analytics.adherenceReportExportFailed).toHaveBeenCalledWith({
      stage: 'print',
      code: 'PRINT_FAILED',
    });
  });

  // No export was attempted, so there is no export failure to count — only
  // the data problem the toast names.
  it('a report fetch failure toasts fetchError and fires no analytics', async () => {
    mockReport.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.exportPdf('7d');
    });

    expect(ok).toBe(false);
    expect(mockPrint).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('Could not load report data. Please try again.', 'error');
    expect(Analytics.adherenceReportExportFailed).not.toHaveBeenCalled();
    expect(Analytics.adherenceReportExported).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Could not load report data. Please try again.');
  });

  it('clearError forgets the last failure', async () => {
    mockReport.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    await act(async () => {
      await result.current.exportPdf('7d');
    });
    expect(result.current.error).not.toBeNull();

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('is busy from the call until the print dialog was requested', async () => {
    let releasePrint: () => void = () => {};
    mockPrint.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releasePrint = resolve;
        })
    );
    const { result } = renderHook(() => useAdherenceExport({ circleId: CIRCLE_ID }));

    let pending: Promise<boolean> | undefined;
    act(() => {
      pending = result.current.exportPdf('7d');
    });
    await waitFor(() => expect(result.current.isExporting).toBe(true));
    await waitFor(() => expect(mockPrint).toHaveBeenCalled());

    await act(async () => {
      releasePrint();
      await pending;
    });
    expect(result.current.isExporting).toBe(false);
  });
});
