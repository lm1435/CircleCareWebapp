import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getAdherenceReport,
  type AdherencePeriod,
  type AdherenceReport,
} from '@/api/medicationConfirmations';
import { getCircleDetail, type CircleDetail } from '@/api/circleMembers';
import { getVitals } from '@/api/vitals';
import { queryClient } from '@/lib/queryClient';
import { queryKeys } from '@/lib/queryKeys';
import { useToast } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { Analytics, type ExportFailureStage } from '@/lib/analytics';
import { adherenceReportFileTitle, generateAdherenceReportHtml } from '@/pdf/adherenceReportPdf';
import { PrintError, printHtml } from '@/pdf/printHtml';
import { mapPdfKey } from '@/pdf/pdfEnv';
import { computeVitalsSummary } from '@/pdf/shared/vitalsSummary';
import type { PdfVitalsSummary } from '@/pdf/shared/types';

/**
 * Web twin of `mobile/src/hooks/useAdherenceExport.ts` (plan
 * docs/plans/pdf-export-parity.md, decision 9): fetch the adherence report
 * for the chosen period, the recipient's vitals for THAT report's date range
 * when premium applies, render the shared template and hand the document to
 * the browser's print dialog.
 *
 * EVERYTHING IS READ AT CALL TIME, NOT AT RENDER. The hero mounts this hook
 * for every history page, but the report for a 7-day export is only wanted
 * once the user picks "Last 7 days" — so the report and the circle facts go
 * through `queryClient.fetchQuery` under the SAME keys `useAdherenceReport` /
 * `useCircleMembers` use. A period the tab already shows (30d) comes straight
 * from cache; anything else is one request that the cache then keeps.
 *
 * THE SINGLETON `queryClient`, NOT `useQueryClient()`. This runs inside
 * `AdherenceHero`, which the medications page renders with no
 * `QueryClientProvider` in its own test, and the export is an event handler,
 * not a render — the adapter (`pdf/pdfEnv.ts`) reads the same singleton for
 * the viewer's clock preference for the same reason.
 *
 * PREMIUM GATE. `is_premium_circle` is the DETAIL response's per-membership
 * flag (see `hooks/useCircle.ts`) and mobile reads the same field, so a
 * view-only seat exports the report without a vitals section — the report
 * itself is read-only and view-only members CAN export it.
 *
 * FAILURES. A vitals fetch that fails must not block the report (mobile
 * parity). A report or circle fetch that fails is a data problem the toast
 * names (`export.fetchError`); nothing is reported to analytics, because no
 * export was attempted. A render/print failure IS an export failure:
 * `adherence_report_export_failed` with the coarse stage + code only — never
 * the document, the title (it carries the recipient's name) or a message.
 */

export interface UseAdherenceExportOptions {
  circleId: string;
}

export interface UseAdherenceExportResult {
  /** Resolves `true` once the print dialog was requested, `false` on any failure
   *  (already toasted). Never rejects. */
  exportPdf: (period: AdherencePeriod) => Promise<boolean>;
  isExporting: boolean;
  /** The last failure's user-facing copy, until `clearError`/the next export. */
  error: string | null;
  clearError: () => void;
}

/** How long a cached circle detail may serve an export before refetching. */
const CIRCLE_DETAIL_STALE_MS = 60_000;

function fetchReport(circleId: string, period: AdherencePeriod): Promise<AdherenceReport> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.adherenceReport(circleId, period),
    queryFn: () => getAdherenceReport(circleId, period),
    staleTime: 60_000,
  });
}

function fetchCircle(circleId: string): Promise<CircleDetail> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.circleDetail(circleId),
    queryFn: () => getCircleDetail(circleId),
    staleTime: CIRCLE_DETAIL_STALE_MS,
  });
}

/** Coarse, enum-like failure code for analytics — never a message. */
function failureCode(err: unknown): string {
  if (err instanceof PrintError) return err.code;
  return 'RENDER_FAILED';
}

export function useAdherenceExport({ circleId }: UseAdherenceExportOptions): UseAdherenceExportResult {
  const { t, i18n } = useTranslation('meds');
  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The print hand-off can outlive the hero (the user switches tabs while the
  // report is fetching); same guard as mobile's hook.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fail = useCallback(
    (message: string) => {
      showToast(message, 'error');
      if (mountedRef.current) setError(message);
    },
    [showToast]
  );

  const exportPdf = useCallback(
    async (period: AdherencePeriod): Promise<boolean> => {
      setIsExporting(true);
      setError(null);

      // 1. Data. Report + circle in parallel; either failing is a fetch error.
      let report: AdherenceReport;
      let circle: CircleDetail;
      try {
        [report, circle] = await Promise.all([fetchReport(circleId, period), fetchCircle(circleId)]);
      } catch {
        fail(t('export.fetchError'));
        if (mountedRef.current) setIsExporting(false);
        return false;
      }

      // 2. Vitals for the report's own range, premium only, never blocking.
      let vitalsData: PdfVitalsSummary[] | undefined;
      if (circle.is_premium_circle) {
        try {
          const vitals = await getVitals(circleId, {
            from: report.start_date,
            to: report.end_date,
          });
          if (vitals.length > 0) {
            vitalsData = computeVitalsSummary(vitals, (key) => i18n.t(mapPdfKey(key)));
          }
        } catch {
          // Vitals fetch failure should not block the report (mobile parity).
        }
      }

      // 3. Render + print. Anything from here on is an export failure.
      const stage: ExportFailureStage = 'print';
      try {
        // Static store read, not a hook: whoever is signed in AT EXPORT TIME.
        const currentUser = useAuthStore.getState().user;
        const preparedBy = currentUser
          ? `${currentUser.first_name || ''} ${currentUser.last_name || ''}`.trim() || undefined
          : undefined;

        const html = generateAdherenceReportHtml({
          report,
          careRecipientName: circle.recipient_name,
          circleName: circle.name,
          careRecipientTimezone: circle.care_recipient_timezone,
          vitalsData,
          recipientDob: circle.recipient_dob,
          preparedBy,
        });

        await printHtml({
          html,
          title: adherenceReportFileTitle(circle.recipient_name, report.period_days),
        });
        Analytics.adherenceReportExported(circleId, period);
        return true;
      } catch (err) {
        Analytics.adherenceReportExportFailed({
          stage: err instanceof PrintError && err.code === 'PRINT_TIMEOUT' ? 'timeout' : stage,
          code: failureCode(err),
        });
        fail(t('export.error'));
        return false;
      } finally {
        if (mountedRef.current) setIsExporting(false);
      }
    },
    [circleId, t, i18n, fail]
  );

  const clearError = useCallback(() => setError(null), []);

  return { exportPdf, isExporting, error, clearError };
}
