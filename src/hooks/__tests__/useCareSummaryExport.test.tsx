import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// API READ fns are mocked so the hook's `fetchQuery` calls resolve from here
// (the global `@/lib/api` mock in src/test/setup.ts never answers on its own).
vi.mock('@/api/calendarEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/calendarEvents')>();
  return { ...actual, getEvents: vi.fn() };
});
vi.mock('@/api/circleMembers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/circleMembers')>();
  return { ...actual, getCircleDetail: vi.fn() };
});
vi.mock('@/api/emergencyInfo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/emergencyInfo')>();
  return { ...actual, getEmergencyInfo: vi.fn() };
});

// The print path is a hidden iframe + modal dialog — mocked; its own suite is
// src/pdf/__tests__/printHtml.test.ts. `PrintError` stays real so the hook's
// `instanceof` code extraction is exercised.
vi.mock('@/pdf/printHtml', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/pdf/printHtml')>();
  return { ...actual, printHtml: vi.fn() };
});

// REAL i18n, deliberately: the web PDF adapter (`pdf/pdfEnv.ts`) reads the
// shared template's mobile-namespaced keys through the app's own i18next
// instance, so the rendered html carries English copy — a `react-i18next`
// mock would both starve `@/i18n` of `initReactI18next` and hide that path.
import '@/i18n';

const showToast = vi.fn();
vi.mock('@/components/ui', () => ({
  useToast: () => ({ showToast }),
}));

const mockCareSummaryShared = vi.fn();
const mockCareSummaryExportFailed = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    careSummaryShared: (...args: unknown[]) => mockCareSummaryShared(...args),
    careSummaryExportFailed: (...args: unknown[]) => mockCareSummaryExportFailed(...args),
  },
}));

import { getEvents, type CalendarEvent } from '@/api/calendarEvents';
import { getCircleDetail, type CircleDetail } from '@/api/circleMembers';
import { getEmergencyInfo, type EmergencyInfo } from '@/api/emergencyInfo';
import { PrintError, printHtml } from '@/pdf/printHtml';
import { useAuthStore } from '@/store/authStore';
import { getDateInTimezone } from '@/utils/timezone';
import { addDaysToDateString } from '@/pdf/shared/medicationSelection';
import {
  careSummaryEventsKey,
  careSummaryEventsWindow,
  resolveRecipientConditions,
  useCareSummaryExport,
} from '@/hooks/useCareSummaryExport';

const mockGetEvents = vi.mocked(getEvents);
const mockGetCircleDetail = vi.mocked(getCircleDetail);
const mockGetEmergencyInfo = vi.mocked(getEmergencyInfo);
const mockPrintHtml = vi.mocked(printHtml);

const CIRCLE_ID = 'circle-1';
const TZ = 'America/New_York';
/** `emergency:careSummary.error` (EN) — the ONLY text a failure may surface. */
const ERROR_COPY = 'Failed to generate summary. Please try again.';

const circle: CircleDetail = {
  id: CIRCLE_ID,
  name: "Rose's Care Team",
  recipient_name: 'Rose Marie Whitfield',
  recipient_photo_url: null,
  recipient_dob: '1948-03-12',
  recipient_conditions: ['Hypertension'],
  owner_id: 'owner-1',
  created_at: '2026-01-01T00:00:00.000Z',
  is_self_care: false,
  care_recipient_timezone: TZ,
  members: [],
  access_level: 'view',
  is_premium_circle: false,
  can_edit: false,
  view_only: true,
};

const emergencyInfo: EmergencyInfo = {
  id: 'ei-1',
  circle_id: CIRCLE_ID,
  insurance_plans: [],
  additional_doctors: [],
  allergies: ['Peanuts'],
  medication_allergies: ['Penicillin'],
  medical_conditions: ['Type 2 diabetes'],
  blood_type: 'O+',
  emergency_contacts: [
    { name: 'Sarah Whitfield', relationship: 'Daughter', phone: '555-0103', is_primary: true },
  ],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function medication(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    circle_id: CIRCLE_ID,
    event_type: 'medication',
    title: 'Medication',
    scheduled_date: getDateInTimezone(TZ),
    scheduled_time: '08:00:00',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const rendered = renderHook(() => useCareSummaryExport({ circleId: CIRCLE_ID }), { wrapper });
  return { ...rendered, queryClient };
}

function printedHtml(): string {
  const call = mockPrintHtml.mock.calls[0];
  if (!call) throw new Error('printHtml was not called');
  return call[0].html;
}

describe('useCareSummaryExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCircleDetail.mockResolvedValue(circle);
    mockGetEmergencyInfo.mockResolvedValue(emergencyInfo);
    mockGetEvents.mockResolvedValue([]);
    mockPrintHtml.mockResolvedValue(undefined);
    useAuthStore.setState({ user: null });
  });

  it('happy path: prints html carrying the recipient name under the mobile file title', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.exportPdf();
    });

    expect(mockPrintHtml).toHaveBeenCalledTimes(1);
    expect(mockPrintHtml.mock.calls[0][0].title).toBe('CircleCare_Summary_Rose_Marie_Whitfield');
    const html = printedHtml();
    expect(html).toContain('Rose Marie Whitfield');
    // Emergency info reached the template too.
    expect(html).toContain('Sarah Whitfield');
    expect(html).toContain('Penicillin');
    expect(result.current.error).toBeNull();
  });

  it('fetches the explicit ±30-day medication window in the recipient zone', async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.exportPdf();
    });

    const today = getDateInTimezone(TZ);
    expect(mockGetEvents).toHaveBeenCalledTimes(1);
    expect(mockGetEvents).toHaveBeenCalledWith(CIRCLE_ID, {
      start_date: addDaysToDateString(today, -30),
      end_date: addDaysToDateString(today, 30),
      event_type: 'medication',
    });
  });

  it('caches the window under the calendarEvents prefix but NOT the unfiltered range key', async () => {
    const { result, queryClient } = setup();
    await act(async () => {
      await result.current.exportPdf();
    });

    const today = getDateInTimezone(TZ);
    const window = careSummaryEventsWindow(today);
    expect(queryClient.getQueryData(careSummaryEventsKey(CIRCLE_ID, window))).toEqual([]);
    // The calendar's own key for the same dates must be untouched: a
    // medication-only list there would blank every appointment on the page.
    expect(
      queryClient.getQueryData([
        'calendarEvents',
        CIRCLE_ID,
        { start_date: window.start_date, end_date: window.end_date },
      ])
    ).toBeUndefined();
  });

  it('reuses fresh cached circle + emergency info instead of refetching', async () => {
    const { result, queryClient } = setup();
    queryClient.setQueryData(['circle', CIRCLE_ID], circle);
    queryClient.setQueryData(['emergencyInfo', CIRCLE_ID], emergencyInfo);

    await act(async () => {
      await result.current.exportPdf();
    });

    expect(mockGetCircleDetail).not.toHaveBeenCalled();
    expect(mockGetEmergencyInfo).not.toHaveBeenCalled();
    expect(mockPrintHtml).toHaveBeenCalledTimes(1);
  });

  it('stopped medications reach the html via discontinued_at; active ones are current', async () => {
    const today = getDateInTimezone(TZ);
    const stoppedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    mockGetEvents.mockResolvedValue([
      medication({
        id: 'met-child',
        parent_event_id: 'met-parent',
        title: 'Metformin',
        medication_name: 'Metformin',
        medication_dosage: '500mg',
        recurrence_rule: 'daily',
      }),
      medication({
        id: 'warf-child',
        parent_event_id: 'warf-parent',
        title: 'Warfarin',
        medication_name: 'Warfarin',
        medication_dosage: '5mg',
        recurrence_rule: 'daily',
        scheduled_date: addDaysToDateString(today, -5),
        discontinued_at: stoppedAt,
      }),
    ]);
    const { result } = setup();

    await act(async () => {
      await result.current.exportPdf();
    });

    const html = printedHtml();
    expect(html).toContain('Metformin');
    expect(html).toContain('Warfarin');
    // The shared template renders the stopped section only when an event
    // carries `discontinued_at` — the selection stamps the stop instant on
    // the exported row so the template can label it from the event alone.
    expect(html).toContain('Recently stopped medications');
  });

  it('omits the stopped-medications section when nothing was stopped', async () => {
    mockGetEvents.mockResolvedValue([
      medication({ id: 'met', title: 'Metformin', recurrence_rule: 'daily' }),
    ]);
    const { result } = setup();
    await act(async () => {
      await result.current.exportPdf();
    });
    expect(printedHtml()).not.toContain('Recently stopped medications');
  });

  describe('conditions precedence (mirrors EmergencyInfoScreen)', () => {
    it('prints emergency_info.medical_conditions when non-empty', async () => {
      const { result } = setup();
      await act(async () => {
        await result.current.exportPdf();
      });
      const html = printedHtml();
      expect(html).toContain('Type 2 diabetes');
      expect(html).not.toContain('Hypertension');
    });

    it('falls back to circle.recipient_conditions when medical_conditions is empty', async () => {
      mockGetEmergencyInfo.mockResolvedValue({ ...emergencyInfo, medical_conditions: [] });
      const { result } = setup();
      await act(async () => {
        await result.current.exportPdf();
      });
      expect(printedHtml()).toContain('Hypertension');
    });

    it('resolveRecipientConditions mirrors mobile: null only when the fallback is absent', () => {
      // Mobile's exact expression — `(cond ? a : b) || null` — so an EMPTY
      // fallback array passes through as `[]` (the template prints its
      // placeholder for both). Pinned so the two surfaces cannot drift.
      expect(
        resolveRecipientConditions({ ...emergencyInfo, medical_conditions: [] }, {
          recipient_conditions: [],
        })
      ).toEqual([]);
      expect(resolveRecipientConditions(null, { recipient_conditions: null })).toBeNull();
      expect(resolveRecipientConditions(null, { recipient_conditions: ['CKD'] })).toEqual([
        'CKD',
      ]);
    });
  });

  it('prints "Prepared by" from the signed-in user read at export time', async () => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'x@example.com', first_name: 'Sarah', last_name: 'Whitfield' },
    });
    const { result } = setup();
    await act(async () => {
      await result.current.exportPdf();
    });
    expect(printedHtml()).toContain('Sarah Whitfield');
  });

  it('success → careSummaryShared(circleId, "pdf") and no failure event', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.exportPdf();
    });
    expect(mockCareSummaryShared).toHaveBeenCalledTimes(1);
    expect(mockCareSummaryShared).toHaveBeenCalledWith(CIRCLE_ID, 'pdf');
    expect(mockCareSummaryExportFailed).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('PRINT_TIMEOUT → careSummaryExportFailed({stage:"timeout"}), error set, toast shown', async () => {
    mockPrintHtml.mockRejectedValue(new PrintError('PRINT_TIMEOUT'));
    const { result } = setup();

    await act(async () => {
      await result.current.exportPdf();
    });

    expect(mockCareSummaryExportFailed).toHaveBeenCalledTimes(1);
    expect(mockCareSummaryExportFailed).toHaveBeenCalledWith({
      stage: 'timeout',
      code: 'PRINT_TIMEOUT',
    });
    expect(mockCareSummaryShared).not.toHaveBeenCalled();
    expect(result.current.error).toBe(ERROR_COPY);
    expect(showToast).toHaveBeenCalledWith(ERROR_COPY, 'error');

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it('PRINT_FAILED → stage "print" with the code', async () => {
    mockPrintHtml.mockRejectedValue(new PrintError('PRINT_FAILED'));
    const { result } = setup();
    await act(async () => {
      await result.current.exportPdf();
    });
    expect(mockCareSummaryExportFailed).toHaveBeenCalledWith({
      stage: 'print',
      code: 'PRINT_FAILED',
    });
  });

  it('a fetch failure → stage "print", code "unknown" — never the message', async () => {
    mockGetEvents.mockRejectedValue(
      new Error('GET /circles/circle-1/events failed for Rose Marie Whitfield')
    );
    const { result } = setup();
    await act(async () => {
      await result.current.exportPdf();
    });
    expect(mockPrintHtml).not.toHaveBeenCalled();
    expect(mockCareSummaryExportFailed).toHaveBeenCalledWith({ stage: 'print', code: 'unknown' });
    const [payload] = mockCareSummaryExportFailed.mock.calls[0];
    expect(JSON.stringify(payload)).not.toContain('Rose');
    expect(result.current.error).toBe(ERROR_COPY);
  });

  it('isExporting toggles on around the export and off afterwards', async () => {
    let releasePrint: () => void = () => {};
    mockPrintHtml.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releasePrint = resolve;
        })
    );
    const { result } = setup();
    expect(result.current.isExporting).toBe(false);

    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.exportPdf();
    });
    await waitFor(() => expect(result.current.isExporting).toBe(true));
    expect(mockPrintHtml).toHaveBeenCalledTimes(1);

    await act(async () => {
      releasePrint();
      await pending;
    });
    expect(result.current.isExporting).toBe(false);
  });

  it('a second call while one is in flight is a no-op (one print, one event)', async () => {
    let releasePrint: () => void = () => {};
    mockPrintHtml.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releasePrint = resolve;
        })
    );
    const { result } = setup();

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.exportPdf();
      second = result.current.exportPdf();
    });
    await waitFor(() => expect(mockPrintHtml).toHaveBeenCalledTimes(1));

    await act(async () => {
      releasePrint();
      await Promise.all([first, second]);
    });
    expect(mockPrintHtml).toHaveBeenCalledTimes(1);
    expect(mockCareSummaryShared).toHaveBeenCalledTimes(1);
  });
});
