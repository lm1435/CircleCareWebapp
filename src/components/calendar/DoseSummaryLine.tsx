import { useTranslation } from 'react-i18next';

/**
 * The new medication form's ONE line under "What time?" (owner 2026-11-11, mobile parity): what the save will
 * create, live ("2 doses a day · 8:00 AM, 9:00 PM · Tap a time again to remove it"). The parent builds the text and
 * passes null to hide it (no dose yet, When needed, an edit). Display only.
 * `role="status"` stays mounted (sr-only while empty), so every change is announced politely.
 */
export function DoseSummaryLine({ text, testId = 'dose-summary' }: { text: string | null; testId?: string }) {
  return (
    <div role="status" className={text ? undefined : 'sr-only'}>
      {text && (
        <p data-testid={testId} className="m-0 text-sm text-ink-2 tabular-nums">
          {text}
        </p>
      )}
    </div>
  );
}

/**
 * "9:00 AM is already a dose time." A custom pick (or a custom chip changed in place) landed on a time the
 * medication already has, so nothing was added. The parent shows it until the doses change. Announced politely
 * (a mounted `role="status"`); text, not colour alone.
 */
export function DoseDuplicateNote({ time }: { time: string | null }) {
  const { t } = useTranslation('calendar');
  return (
    <div role="status" className={time ? undefined : 'sr-only'}>
      {time && (
        <p data-testid="dose-time-duplicate-note" className="m-0 text-sm text-amber-deep text-balance">
          {t('addEvent.simple.doseTimeDuplicate', { time })}
        </p>
      )}
    </div>
  );
}
