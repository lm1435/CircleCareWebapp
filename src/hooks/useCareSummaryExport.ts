import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getEvents, type CalendarEvent } from '@/api/calendarEvents';
import { getCircleDetail, type CircleDetail } from '@/api/circleMembers';
import { getEmergencyInfo, type EmergencyInfo } from '@/api/emergencyInfo';
import { useToast } from '@/components/ui';
import { Analytics, type ExportFailureStage } from '@/lib/analytics';
import { queryKeys } from '@/lib/queryKeys';
import { careSummaryFileTitle, generateCareSummaryHtml } from '@/pdf/careSummaryPdf';
import { PrintError, printHtml } from '@/pdf/printHtml';
import {
  addDaysToDateString,
  CARE_SUMMARY_MEDICATION_LOOKBACK_DAYS,
  selectCareSummaryMedications,
} from '@/pdf/shared/medicationSelection';
import { useAuthStore } from '@/store/authStore';
import { getDateInTimezone } from '@/utils/timezone';

/**
 * Web twin of `mobile/src/hooks/useCareSummaryExport.ts` (plan
 * docs/plans/pdf-export-parity.md, B3).
 *
 * WHAT DIFFERS FROM MOBILE, AND WHY. Mobile's screen already holds the circle,
 * the emergency info and the ±30-day medication window in React Query hooks
 * and hands them to `exportPdf(emergencyInfo, medications)`. The web page
 * renders from the same caches but never needed the medication window, so
 * this hook gathers EVERYTHING itself at call time through
 * `queryClient.fetchQuery` on the page's own keys: whatever is fresh (the
 * default `staleTime` is a minute) is reused untouched, and only the
 * medication window is a new request. The page passes nothing but the id.
 *
 * WHAT IS IDENTICAL. The list of medications (the shared
 * `selectCareSummaryMedications`), the conditions precedence (the maintained
 * `emergency_info.medical_conditions` first, the create-time
 * `circle.recipient_conditions` as a fallback only), the "Prepared by" line
 * (the signed-in user's name read from the store AT EXPORT TIME), the file
 * name and the two analytics events.
 *
 * PHI. Nothing here is logged or tracked: not the HTML, not the title (it
 * carries the care recipient's name), not an error message. Failures reach
 * analytics as `{stage, code}` only.
 */

/** America/New_York is the documented timezone fallback for a null/missing TZ. */
const DEFAULT_TIMEZONE = 'America/New_York';

/** The one events window the summary needs — see plan decision 6. */
export interface CareSummaryEventsWindow {
  start_date: string;
  end_date: string;
  event_type: 'medication';
}

/**
 * `today ± 30` stepped as date STRINGS in the recipient's zone (never instant
 * arithmetic, which drifts a day across DST). Exported so the test can pin the
 * exact window that reaches `getEvents`.
 */
export function careSummaryEventsWindow(todayStr: string): CareSummaryEventsWindow {
  return {
    start_date: addDaysToDateString(todayStr, -CARE_SUMMARY_MEDICATION_LOOKBACK_DAYS),
    end_date: addDaysToDateString(todayStr, CARE_SUMMARY_MEDICATION_LOOKBACK_DAYS),
    event_type: 'medication',
  };
}

/**
 * Mobile's `['calendarEvents', circleId, params]` shape (its `useCalendarEvents`
 * with a params object) — NOT `queryKeys.calendarEventsRange`, which is the
 * calendar's unfiltered window: caching a medication-only response under that
 * key would hand the calendar a page with every appointment missing. Under
 * the `calendarEvents(circleId)` prefix so every event write still invalidates it.
 */
export function careSummaryEventsKey(circleId: string, window: CareSummaryEventsWindow) {
  return [...queryKeys.calendarEvents(circleId), window] as const;
}

/** `first last` of the signed-in user, or undefined when there is nothing to print. */
function preparedByFromStore(): string | undefined {
  const user = useAuthStore.getState().user;
  if (!user) return undefined;
  return `${user.first_name || ''} ${user.last_name || ''}`.trim() || undefined;
}

/**
 * The printed summary shows the ONE list caregivers actually maintain (Edit
 * medical info). `circle.recipient_conditions` is a create-time field, so it
 * is a fallback only — mobile shipped a summary that ignored every in-app
 * edit by printing it first. Same expression as `EmergencyInfoScreen`.
 */
export function resolveRecipientConditions(
  emergencyInfo: EmergencyInfo | null | undefined,
  circle: Pick<CircleDetail, 'recipient_conditions'>
): string[] | null {
  return (
    (emergencyInfo?.medical_conditions?.length
      ? emergencyInfo.medical_conditions
      : circle.recipient_conditions) || null
  );
}

export interface UseCareSummaryExportOptions {
  circleId: string;
}

export interface UseCareSummaryExportResult {
  /**
   * Gather, render and hand the document to the browser's print dialog.
   * Resolves once the dialog has been REQUESTED (it is modal and unobservable
   * — plan decision 7). Never rejects: failures land in `error`, a toast and
   * analytics. A call made while one is in flight is a no-op.
   */
  exportPdf: () => Promise<void>;
  isExporting: boolean;
  /** Localised failure copy, or null. Cleared by `clearError` and on the next export. */
  error: string | null;
  clearError: () => void;
}

export function useCareSummaryExport({
  circleId,
}: UseCareSummaryExportOptions): UseCareSummaryExportResult {
  const { t } = useTranslation(['emergency']);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // THE SYNCHRONOUS RE-ENTRANCY GUARD. `isExporting` is state committed a
  // render after the click that started the export; a second call in the
  // same tick would see it still `false`. The ref closes that window (same
  // reasoning as `useGuardedSubmit`).
  const inFlightRef = useRef(false);

  // The print hand-off can outlive the page (a route change while the dialog
  // is up), so no state is written after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reportFailure = useCallback(
    (err: unknown) => {
      const code = err instanceof PrintError ? err.code : 'unknown';
      const stage: ExportFailureStage = code === 'PRINT_TIMEOUT' ? 'timeout' : 'print';
      Analytics.careSummaryExportFailed({ stage, code });
      if (!mountedRef.current) return;
      // Always the localised copy — never `err.message`, which for a fetch
      // failure can carry a URL with the circle id and for a DOM failure the
      // document title with the recipient's name.
      const message = t('emergency:careSummary.error');
      setError(message);
      showToast(message, 'error');
    },
    [t, showToast]
  );

  const exportPdf = useCallback(async (): Promise<void> => {
    if (inFlightRef.current || !circleId) return;
    inFlightRef.current = true;
    setIsExporting(true);
    setError(null);

    try {
      // Circle detail and emergency info are the page's own queries: fresh
      // cache is returned as-is, so the export prints what is on screen.
      const [circle, emergencyInfo] = await Promise.all([
        queryClient.fetchQuery({
          queryKey: queryKeys.circleDetail(circleId),
          queryFn: () => getCircleDetail(circleId),
        }),
        queryClient.fetchQuery({
          queryKey: queryKeys.emergencyInfo(circleId),
          queryFn: () => getEmergencyInfo(circleId),
        }),
      ]);

      const careRecipientTimezone = circle.care_recipient_timezone || DEFAULT_TIMEZONE;
      // "What day is it for the care recipient" — resolved in THEIR zone, the
      // same derivation as mobile's `todayStr`.
      const todayStr = getDateInTimezone(careRecipientTimezone);
      const eventsWindow = careSummaryEventsWindow(todayStr);

      // Explicit ±30-day window: the backend's default window can never fill
      // the 30-day lookback (memory: project_care_summary_export_silent_failure).
      const events = await queryClient.fetchQuery<CalendarEvent[]>({
        queryKey: careSummaryEventsKey(circleId, eventsWindow),
        queryFn: () => getEvents(circleId, eventsWindow),
      });

      const { forExport } = selectCareSummaryMedications(events, {
        todayStr,
        careRecipientTimezone,
        getDateInTimezone,
      });

      const html = generateCareSummaryHtml({
        recipientName: circle.recipient_name,
        recipientDob: circle.recipient_dob || null,
        recipientConditions: resolveRecipientConditions(emergencyInfo, circle),
        emergencyInfo,
        medications: forExport,
        careRecipientTimezone,
        preparedBy: preparedByFromStore(),
      });

      await printHtml({ html, title: careSummaryFileTitle(circle.recipient_name) });

      // Fired when the dialog is requested — mobile fires on share hand-off
      // (plan decision 7). ids and enums only.
      Analytics.careSummaryShared(circleId, 'pdf');
    } catch (err) {
      reportFailure(err);
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setIsExporting(false);
    }
  }, [circleId, queryClient, reportFailure]);

  const clearError = useCallback(() => setError(null), []);

  return { exportPdf, isExporting, error, clearError };
}
