import { useTranslation } from 'react-i18next';
import { isAddedByVoice } from '@/utils/entrySource';

interface EntrySourceNoteProps {
  /** The medication, appointment or task whose detail view this sits in. */
  event: { entry_source?: string | null } | null | undefined;
  className?: string;
}

/**
 * "Added by voice": one muted line on an entry's detail view, so the care
 * circle knows the entry was dictated on the phone (a name or a dose may have
 * been misheard). Same sentence, same rule as mobile's `EntrySourceNote`.
 *
 * Renders NOTHING unless the entry was saved by voice: a typed or scanned
 * entry, and one saved before this was recorded, get no line and no gap.
 * Plain text, no icon: a screen reader reads it as the sentence it is.
 */
export function EntrySourceNote({ event, className }: EntrySourceNoteProps) {
  const { t } = useTranslation();
  if (!isAddedByVoice(event)) return null;
  return (
    <p data-testid="entry-source-note" className={`m-0 text-sm text-ink-3 ${className ?? ''}`.trim()}>
      {t('calendar:entrySource.addedByVoice')}
    </p>
  );
}
