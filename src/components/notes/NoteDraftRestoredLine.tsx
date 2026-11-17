import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';

/**
 * "Draft restored · Discard" at the top of the notes composer when it opened pre-filled with words
 * the user did not just type: the session draft (PK9) or the note that failed to post after they
 * left the page (BH-024). Twin of mobile/src/components/notes/NoteDraftRestoredLine.tsx.
 *
 * Discard is a plain text button (44px target, no confirm dialog: owner dislikes friction) at the
 * far end of this line, away from Post. The message is a polite live region, announced on
 * appearance; the button is its own control with a full accessible name.
 */
export function NoteDraftRestoredLine({ onDiscard }: { onDiscard: () => void }): ReactElement {
  const { t } = useTranslation('notes');
  return (
    <div className="mb-1 flex items-center justify-between gap-2 pl-1" data-testid="draft-restored-notice">
      <p className="m-0 text-sm text-ink-2" role="status" aria-live="polite">
        {t('composer.draftRestored')}
      </p>
      <Button
        variant="ghost"
        tone="neutral"
        size="sm"
        onClick={onDiscard}
        aria-label={t('composer.discardDraftA11y')}
        data-testid="note-draft-discard"
      >
        {t('composer.discardDraft')}
      </Button>
    </div>
  );
}
