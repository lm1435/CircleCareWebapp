import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, Toggle } from '@/components/ui';
import { useEventNotesRange } from '@/hooks/useEventNotes';
import { useCareNotes } from '@/hooks/useCareNotes';
import { careSummaryNotesWindow } from '@/hooks/useCareSummaryExport';
import { getDateInTimezone } from '@/utils/timezone';

// docs/plans/notes-first-class.md, Slice 4, task 30 — replaces the plain
// privacy confirm (`emergency:careSummary.privacy.*`) with a full share
// sheet: the SAME privacy sentence, plus two opt-in switches ("Include visit
// notes" default ON, "Include daily care notes" default OFF) and a live
// count line. Built on the shared `ConfirmDialog` shell (spec: "reuse the
// app's existing dialog/confirm component pattern") — only its `message`
// body is new.
//
// The two counts are read from the SAME last-30-days-to-today window
// `useCareSummaryExport` fetches at share time (`careSummaryNotesWindow`), so
// what this dialog shows is what actually gets included — it does not invent
// its own window.

export interface CareSummaryShareDialogProps {
  circleId: string;
  /** The care recipient's IANA timezone, or `null` while the circle detail
   *  is still loading — the count line reads as "Counting notes…" until it
   *  resolves (there is no window to count over yet). */
  careRecipientTimezone: string | null;
  /** True while `exportPdf` is in flight — mirrors the old privacy dialog's
   *  `loading` prop 1:1 (same busy label, same disabled Cancel). */
  isSharing: boolean;
  onShare: (options: { includeVisitNotes: boolean; includeCareNotes: boolean }) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Mobile's privacy notice is two paragraphs joined by "\n\n" (the string is
 * copied verbatim into `careSummary.privacy.message`) — split into `<p>`s so
 * a plain string inside `ConfirmDialog` doesn't collapse the break.
 */
function PrivacyParagraphs({ text }: { text: string }): ReactElement {
  return (
    <>
      {text.split(/\n\s*\n/).map((paragraph, index) => (
        <p key={index} className={index === 0 ? 'm-0' : 'mb-0 mt-3'}>
          {paragraph}
        </p>
      ))}
    </>
  );
}

export function CareSummaryShareDialog({
  circleId,
  careRecipientTimezone,
  isSharing,
  onShare,
  onCancel,
}: CareSummaryShareDialogProps): ReactElement {
  const { t } = useTranslation(['emergency']);
  const [includeVisitNotes, setIncludeVisitNotes] = useState(true);
  const [includeCareNotes, setIncludeCareNotes] = useState(false);

  // `null` while the recipient timezone hasn't resolved yet -- there is no
  // window to count over, so both queries stay in a "counting" state below
  // rather than briefly showing a count from the WRONG window.
  const notesWindow = careRecipientTimezone
    ? careSummaryNotesWindow(getDateInTimezone(careRecipientTimezone))
    : null;

  const visitQuery = useEventNotesRange(
    circleId,
    notesWindow ? { ...notesWindow, event_type: 'appointment' } : undefined
  );
  const careQuery = useCareNotes(circleId, notesWindow ?? undefined);

  const isCounting = !notesWindow || visitQuery.isLoading || careQuery.isLoading;
  const isCountError = !!notesWindow && (visitQuery.isError || careQuery.isError);
  const visitCount = notesWindow ? (visitQuery.data?.length ?? 0) : 0;
  const careCount = notesWindow ? (careQuery.data?.notes.length ?? 0) : 0;

  let countLine: string;
  if (isCounting) {
    countLine = t('emergency:shareSummary.counting');
  } else if (isCountError) {
    countLine = t('emergency:shareSummary.countError');
  } else {
    countLine = t('emergency:shareSummary.countLine', { visit: visitCount, care: careCount });
  }

  return (
    <ConfirmDialog
      title={t('emergency:shareSummary.title')}
      message={
        <div className="flex flex-col gap-4 text-left">
          <PrivacyParagraphs text={t('emergency:careSummary.privacy.message')} />
          <div className="flex flex-col gap-3">
            <Toggle
              checked={includeVisitNotes}
              onChange={setIncludeVisitNotes}
              disabled={isCountError}
              label={t('emergency:shareSummary.includeVisitNotes')}
            />
            <Toggle
              checked={includeCareNotes}
              onChange={setIncludeCareNotes}
              disabled={isCountError}
              label={t('emergency:shareSummary.includeCareNotes')}
            />
          </div>
          {/* Announced when it changes (loading -> counted/error) — plan
              Accessibility: "the share sheet count line is announced when it
              changes". */}
          <p className="m-0 text-sm text-ink-3" aria-live="polite">
            {countLine}
          </p>
        </div>
      }
      confirmLabel={t('emergency:careSummary.privacy.confirm')}
      cancelLabel={t('emergency:careSummary.privacy.cancel')}
      loading={isSharing}
      loadingLabel={t('emergency:careSummary.generating')}
      onConfirm={() => onShare({ includeVisitNotes, includeCareNotes })}
      onCancel={onCancel}
    />
  );
}
