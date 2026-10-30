import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useIsOffline } from '@/hooks/useIsOffline';
import { useMarkFirstDose } from '@/hooks/useMarkFirstDose';
import { offlineDisabledProps } from '@/lib/offlineWrite';
import { Analytics } from '@/lib/analytics';
import { markFirstMedNoteMarked, readFirstMedNote } from '@/lib/firstMedNote';
import { addDays } from '@/components/calendar/dateMath';
import { formatEventTimeCompact, zoneReferenceInstant } from '@/utils/timezone';

// Today's "Tomorrow" row for a FIRST medication whose start rolled, with the
// "Already given today? Mark it" line under it (onboarding 1.3.1, spec section 1; boards
// ObTodayLine / ObTodayMarked). The candidate is the local first-med note the add form wrote
// (per user + circle + event, expiring at the end of the recipient's day). After a
// successful tap the line is replaced by the normal Taken state ("Taken by you") and the
// med's today row. Editors only: a view-only viewer never sees it.

export interface FirstMedMarkItProps {
  circleId: string;
  /** The recipient's IANA zone (its today decides the note's validity). */
  timezone: string;
  today: string;
  canEdit: boolean;
  stacked: boolean;
}

export function FirstMedMarkIt({
  circleId,
  timezone,
  today,
  canEdit,
  stacked,
}: FirstMedMarkItProps): ReactElement | null {
  const { t } = useTranslation('overview');
  const hourCycle = useHourCycle();
  const offline = useIsOffline();
  // Bumped after a mark so the note is re-read (marked: true).
  const [, setTick] = useState(0);
  /** Set by THIS mount's successful tap (not by a note already marked on load). */
  const [justMarked, setJustMarked] = useState(false);
  const takenRowRef = useRef<HTMLDivElement>(null);
  const markFirstDose = useMarkFirstDose(circleId, 'today');

  const note = canEdit ? readFirstMedNote(circleId, today) : null;
  const marked = note?.marked === true || markFirstDose.done;
  const offered = note !== null && !marked;

  const noteEventId = note?.eventId ?? null;
  useEffect(() => {
    if (offered) Analytics.markItShown('today');
  }, [offered, noteEventId]);

  // The Mark it button just left the DOM with focus on it: hand focus to the new Taken row
  // (it reads "Today, <med>, Taken by you, Taken") instead of letting it fall to <body>.
  useEffect(() => {
    if (justMarked) takenRowRef.current?.focus({ preventScroll: true });
  }, [justMarked]);

  if (!note) return null;

  const dose = note.dosage.trim();
  const time = formatEventTimeCompact(
    note.time,
    timezone,
    hourCycle,
    zoneReferenceInstant(addDays(today, 1))
  );
  const rowClass = stacked ? 'flex flex-col items-stretch gap-1 py-3' : 'flex items-center gap-4 py-3';
  const labelClass = `text-md font-semibold tabular-nums text-ink-2 ${stacked ? '' : 'w-20 flex-none'}`;

  const handleMark = async (): Promise<void> => {
    const ok = await markFirstDose.mark({ eventId: note.eventId, time: note.time });
    if (ok) {
      markFirstMedNoteMarked(circleId, today);
      setTick((n) => n + 1);
      setJustMarked(true);
    }
  };

  return (
    <Sheet padding="none" className="mb-4 px-4" data-testid="first-med-mark-it">
      {/* ALWAYS mounted, empty until this tap succeeds (WCAG 4.1.3): a live region inserted
          together with its text is not reliably spoken, and a reload of an already-marked
          day must not announce anything. */}
      <span role="status" className="sr-only" data-testid="mark-it-announcer">
        {justMarked ? t('today.markIt.taken') : ''}
      </span>
      <ul className="m-0 list-none p-0">
        {marked && (
          <li className="border-t border-line-2 first:border-t-0">
            <div
              ref={takenRowRef}
              tabIndex={-1}
              data-testid="mark-it-taken-row"
              className={`${rowClass} rounded-md`}
            >
              <span className={labelClass}>{t('today.markIt.today')}</span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="break-words text-lg font-semibold text-ink">{note.name}</span>
                <span className="break-words text-sm text-ink-2">
                  {[dose, t('today.markIt.takenByYou')].filter(Boolean).join(' · ')}
                </span>
              </div>
              <span className="text-md font-semibold text-moss-deep">
                {t('today.markIt.taken')}
              </span>
            </div>
          </li>
        )}
        <li className="border-t border-line-2 first:border-t-0">
          <div className={rowClass}>
            <span className={labelClass}>{t('today.markIt.tomorrow')}</span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="break-words text-lg font-semibold text-ink">{note.name}</span>
              <span className="break-words text-sm text-ink-2">
                {[dose, time].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          {offered && (
            <p className="m-0 pb-3 text-md text-ink" data-testid="mark-it-line">
              {t('today.markIt.question')}{' '}
              <button
                type="button"
                // aria-disabled while in flight, not disabled: a disabled button drops
                // keyboard focus, and on a failed mark the user is left nowhere.
                aria-disabled={markFirstDose.pending || undefined}
                {...offlineDisabledProps(offline)}
                onClick={() => void handleMark()}
                data-testid="mark-it-button"
                className="min-h-[44px] cursor-pointer border-0 bg-transparent p-0 text-md font-semibold text-moss-deep underline underline-offset-2 hover:text-moss aria-disabled:cursor-wait"
              >
                {t('today.markIt.action')}
              </button>
            </p>
          )}
        </li>
      </ul>
    </Sheet>
  );
}
