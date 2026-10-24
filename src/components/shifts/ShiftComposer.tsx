import { useState, type ReactElement } from 'react';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { ShiftFormModal, type ShiftFormPrefill, type ShiftFormSource } from './ShiftFormModal';
import { ShiftSavedDialog } from './ShiftSavedDialog';

export interface ShiftComposerProps {
  circleId: string;
  /** The calendar's selected day (the form's default date). */
  initialDate?: string;
  source: ShiftFormSource;
  onClose: () => void;
}

type Stage =
  | { kind: 'form'; prefill?: ShiftFormPrefill; source: ShiftFormSource }
  | { kind: 'saved'; shift: CalendarEvent; next: ShiftFormPrefill };

/**
 * The create flow end to end: the form, then "Morning shift saved" with "Add the
 * next shift" (re-opens the form pre-filled: start = the previous end, same date,
 * repeat and reminder; name and end empty) and "Done".
 */
export function ShiftComposer({
  circleId,
  initialDate,
  source,
  onClose,
}: ShiftComposerProps): ReactElement {
  const [stage, setStage] = useState<Stage>({ kind: 'form', source });

  if (stage.kind === 'saved') {
    return (
      <ShiftSavedDialog
        circleId={circleId}
        shift={stage.shift}
        onDone={onClose}
        onAddNext={() => {
          Analytics.shiftAddNextTapped();
          setStage({ kind: 'form', prefill: stage.next, source: 'add_next' });
        }}
      />
    );
  }

  return (
    <ShiftFormModal
      // A fresh form (and state) for each "add next".
      key={stage.source}
      circleId={circleId}
      initialDate={initialDate}
      prefill={stage.prefill}
      source={stage.source}
      onClose={onClose}
      onCreated={(shift, next) => setStage({ kind: 'saved', shift, next })}
    />
  );
}
