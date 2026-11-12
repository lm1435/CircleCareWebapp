import { useTranslation } from 'react-i18next';

/**
 * The new medication form's summary under "What time?" (owner 2026-11-11, design B, mobile parity): what the save
 * will create, live ("2 doses a day · 9:00 AM, 9:00 PM"), and under it, on its own line, a quiet `note` that changes
 * with the state ("Taken more than once a day? Tap another time." / "Tap a time again to remove it."). Plain text,
 * never a control. The parent builds both and passes null `text` to hide the block (no dose, When needed, an edit).
 * The `role="status"` region stays mounted (sr-only while empty) and holds the summary, plus the note only when
 * `announceNote` (the one-dose invitation); the remove note sits outside it, so it is never announced.
 */
export function DoseSummaryLine({
  text,
  note = null,
  announceNote = false,
  testId = 'dose-summary',
}: {
  text: string | null;
  note?: string | null;
  announceNote?: boolean;
  testId?: string;
}) {
  const noteLine = text && note && (
    <p data-testid={`${testId}-note`} className="m-0 mt-0.5 text-xs leading-[18px] text-ink-3">
      {note}
    </p>
  );
  return (
    <div>
      <div role="status" className={text ? undefined : 'sr-only'}>
        {text && (
          <p data-testid={testId} className="m-0 text-sm font-medium leading-5 tabular-nums text-ink-2">
            {text}
          </p>
        )}
        {announceNote && noteLine}
      </div>
      {!announceNote && noteLine}
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
