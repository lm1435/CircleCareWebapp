import { useState, type ReactElement } from 'react';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Analytics } from '@/lib/analytics';
import { ShiftFormModal, type ShiftFormPrefill, type ShiftFormSource } from './ShiftFormModal';
import { ShiftSavedDialog } from './ShiftSavedDialog';
import { ShiftTaskFormModal } from './ShiftTaskFormModal';
import { useToast } from '@/components/ui';
import { useTranslation } from 'react-i18next';

export interface ShiftComposerProps {
  circleId: string;
  /** The calendar's selected day (the form's default date). */
  initialDate?: string;
  source: ShiftFormSource;
  onClose: () => void;
}

type Stage =
  | { kind: 'form'; prefill?: ShiftFormPrefill; source: ShiftFormSource }
  | { kind: 'saved'; shift: CalendarEvent; next: ShiftFormPrefill }
  // "Add a task to this shift" from the saved dialog; closing it returns to the saved dialog.
  | { kind: 'task'; shift: CalendarEvent; next: ShiftFormPrefill };

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
  const { showToast } = useToast();
  const { t } = useTranslation('shifts');

  if (stage.kind === 'task') {
    return (
      <ShiftTaskFormModal
        circleId={circleId}
        shift={stage.shift}
        source="saved_sheet"
        onClose={() => setStage({ kind: 'saved', shift: stage.shift, next: stage.next })}
        onAdded={() => {
          showToast(t('tasks.added'), 'success');
          setStage({ kind: 'saved', shift: stage.shift, next: stage.next });
        }}
      />
    );
  }

  if (stage.kind === 'saved') {
    return (
      <ShiftSavedDialog
        circleId={circleId}
        shift={stage.shift}
        onDone={onClose}
        onAddTask={() => setStage({ kind: 'task', shift: stage.shift, next: stage.next })}
        onAddNext={() => {
          Analytics.shiftSavedSheetAction({ action: 'add_next', repeating: !!stage.shift.recurrence_rule });
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
