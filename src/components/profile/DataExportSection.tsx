import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Text, useToast } from '@/components/ui';
import { exportUserData } from '@/api/users';
import { isRateLimitError } from '@/lib/apiErrors';

/** Filename the browser saves the export as. */
export const EXPORT_FILENAME = 'circlecare-export.json';

/**
 * "Download my data" card on the profile page (GDPR data export).
 *
 * GET /users/me/export returns the user's full export as a JSON blob; this
 * turns it into a browser download via a transient object URL. The endpoint is
 * rate-limited to 5 exports/day — a 429 `RATE_LIMIT` rejection gets a friendly
 * "try again tomorrow" toast instead of the generic failure message.
 *
 * Accessibility: the trigger is a real button with visible focus (the shared
 * `Button` primitive), `aria-busy` + disabled while the export is being
 * prepared, and the label swaps to a progress message; success/error feedback
 * lands in the toast live region (role="status" / role="alert").
 */
export function DataExportSection(): ReactElement {
  const { t } = useTranslation('profile');
  const { showToast } = useToast();
  const [isExporting, setIsExporting] = useState(false);

  const handleDownload = async (): Promise<void> => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const blob = await exportUserData();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = EXPORT_FILENAME;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      showToast(t('dataExport.success'), 'success');
    } catch (err) {
      showToast(
        isRateLimitError(err) ? t('dataExport.rateLimited') : t('dataExport.error'),
        'error'
      );
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card padding="lg" className="mt-6">
      <Text variant="h3" as="h2">
        {t('dataExport.title')}
      </Text>
      <Text variant="caption" className="mt-1">
        {t('dataExport.description')}
      </Text>
      <Button
        className="mt-5"
        onClick={() => void handleDownload()}
        disabled={isExporting}
        aria-busy={isExporting}
      >
        {isExporting ? t('dataExport.preparing') : t('dataExport.cta')}
      </Button>
    </Card>
  );
}
