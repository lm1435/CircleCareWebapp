import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, RadioGroup, Text, type RadioOption } from '@/components/ui';
import type { AdherencePeriod } from '@/api/medicationConfirmations';

/**
 * The adherence report's period chooser (plan decision 9; mobile's export
 * period sheet in `MedicationHistoryScreen`): six periods, "Last 30 days"
 * preselected, Cancel + "Export report".
 *
 * The dialog does not own the export. `AdherenceHero` holds
 * `useAdherenceExport` and passes `exportPdf`/`isExporting` down, so the busy
 * state survives this dialog closing and the hero's button can reflect it.
 * On success the hero is told to close; on failure the dialog STAYS OPEN with
 * the chosen period intact — the toast has already said what went wrong, and
 * "try again" should be one click, not three.
 *
 * WHILE EXPORTING the dialog is not dismissible (Escape, backdrop and × are
 * all inert), the radios are disabled and the confirm button carries the
 * spinner + `aria-busy`; a `role="status"` line reads "Generating PDF…" to
 * assistive tech so the wait is announced, not just drawn.
 */

export const ADHERENCE_EXPORT_PERIODS: readonly AdherencePeriod[] = [
  '7d',
  '14d',
  '30d',
  '60d',
  '90d',
  'all',
];

export const DEFAULT_ADHERENCE_EXPORT_PERIOD: AdherencePeriod = '30d';

function isAdherencePeriod(value: string): value is AdherencePeriod {
  return (ADHERENCE_EXPORT_PERIODS as readonly string[]).includes(value);
}

export interface AdherenceExportDialogProps {
  open: boolean;
  onClose: () => void;
  /** Resolves `true` when the print dialog was requested; the dialog then closes. */
  exportPdf: (period: AdherencePeriod) => Promise<boolean>;
  isExporting: boolean;
}

export function AdherenceExportDialog({
  open,
  onClose,
  exportPdf,
  isExporting,
}: AdherenceExportDialogProps): ReactElement {
  const { t } = useTranslation('meds');
  const [period, setPeriod] = useState<AdherencePeriod>(DEFAULT_ADHERENCE_EXPORT_PERIOD);

  // Every opening starts from the default, like mobile's sheet — a period
  // chosen for one export is not a preference.
  useEffect(() => {
    if (open) setPeriod(DEFAULT_ADHERENCE_EXPORT_PERIOD);
  }, [open]);

  // Literal keys on purpose: the static key audit
  // (`i18n/__tests__/translationKeys.test.ts`) resolves each one.
  const options: RadioOption[] = [
    { value: '7d', label: t('export.period7') },
    { value: '14d', label: t('export.period14') },
    { value: '30d', label: t('export.period30') },
    { value: '60d', label: t('export.period60') },
    { value: '90d', label: t('export.period90') },
    { value: 'all', label: t('export.allTime') },
  ];

  const handleConfirm = async () => {
    if (isExporting) return;
    const ok = await exportPdf(period);
    if (ok) onClose();
  };

  return (
    <Modal
      open={open}
      title={t('export.title')}
      onClose={onClose}
      closeLabel={t('common:close')}
      size="sm"
      dismissible={!isExporting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isExporting}>
            {t('export.cancel')}
          </Button>
          <Button variant="primary" onClick={handleConfirm} loading={isExporting}>
            {t('export.button')}
          </Button>
        </>
      }
    >
      <div aria-busy={isExporting || undefined}>
        <RadioGroup
          label={t('export.selectPeriod')}
          options={options}
          value={period}
          onChange={(value) => {
            if (isAdherencePeriod(value)) setPeriod(value);
          }}
          disabled={isExporting}
        />
        {isExporting ? (
          <Text variant="caption" as="p" role="status" className="mt-3">
            {t('export.generating')}
          </Text>
        ) : null}
      </div>
    </Modal>
  );
}
