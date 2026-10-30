import { useTranslation } from 'react-i18next';

/**
 * Inline note under a NEW medication's dose time: "Starts with the next dose.
 * This time has already passed today." Mirrors mobile's `DosePastTimeNote`.
 *
 * Replaces the old Continue/Cancel confirm: the backend rolls the start of a new
 * medication whose time already passed today to its next dose
 * (`medicationStartRoll.ts`), so the prompt could never change the outcome.
 * The parent renders it only when that applies. Display only; NEVER blocks Save.
 * `role="status"` (always mounted) announces it politely to screen readers; text, not color alone.
 */
export function DosePastTimeNote({
  visible,
  testId = 'dose-past-time-note',
}: {
  visible: boolean;
  /** Per-dose notes under "+ Another dose" rows carry their own id (mobile: `dose-past-time-note-N`). */
  testId?: string;
}) {
  const { t } = useTranslation('calendar');
  // The live region stays mounted (sr-only, out of the layout flow, while empty) so the text is
  // announced when it appears, not skipped as a freshly inserted node.
  return (
    <div role="status" className={visible ? undefined : 'sr-only'}>
      {visible && (
        <p data-testid={testId} className="m-0 text-sm text-amber-deep text-balance">
          {t('addEvent.pastTimeInline')}
        </p>
      )}
    </div>
  );
}
