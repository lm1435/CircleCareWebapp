import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import {
  Icon,
  UndoBadge,
  careCardActionPrimary,
  careCardActionsInline,
  careCardActionsRow,
  careCardLeading,
  careCardShell,
  careCardTitle,
  careCardTopRow,
  STATUS_PILL,
} from '@/components/ui';
import { UNDO_DELAY_MS } from '@/hooks/useTaskCompletion';
import { useHourCycle } from '@/hooks/useHourCycle';
import {
  formatEventTimeCompact,
  getRelativeDateLabel,
  zoneReferenceInstant,
} from '@/utils/timezone';

// The ONE task row (Wave 3, Task 16 — mobile parity pass). Rendered by the
// full Tasks page and by the Overview "Open tasks" card, the same way mobile
// shares mobile/src/components/tasks/TaskRow.tsx between its Tasks tab and its
// home-screen OpenTasks card (and the same way MedicationRow is shared across
// every medication surface here).
//
// SHELL: careCardShell (mobile parity — 14px pad, 1.5px border, r20). The
// Done action renders in BOTH careCardActionsInline (trailing, inline at
// normal card widths) and careCardActionsRow (stacked, shown only once the
// card's own content-box narrows below 360px) — a container query on
// careCardShell's `[container-type:inline-size]` picks exactly one at a time
// in a real browser. Both exist in the DOM simultaneously (this is the same
// pattern PageMasthead's right action already uses for its round/labelled
// pair), so a test asserting presence must expect two matches.
//
// TIMEZONE: due-date labels use the care recipient's timezone (never
// device-local). scheduled_date/scheduled_time are naive local values in that
// timezone — formatted with getRelativeDateLabel / formatEventTimeCompact.
//
// PRESS INTENT: an OPEN row presses into the edit form (`onEdit`); a COMPLETED
// row presses into the read-only detail (`onViewDetails`). The press target is
// the TITLE only — the meta row (assignee, due date, overdue pill) is a plain
// sibling underneath so it is never swallowed into the button's accessible
// name and is announced on its own. Both title buttons also carry
// `aria-describedby` pointing at the meta row's id, so a keyboard/screen-
// reader user tabbing to the button still hears the assignee/due-date/overdue
// text as its DESCRIPTION — additive, so it never changes the accessible
// NAME (OpenTasksCard's pinned aria-label stays byte-identical).

function memberDisplayName(member: CircleMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return name || member.email;
}

export interface TaskRowProps {
  task: CalendarEvent;
  timezone: string;
  canEdit: boolean;
  members: CircleMember[];
  onComplete: (task: CalendarEvent) => void;
  onUndo: (taskId: string) => void;
  onEdit: (task: CalendarEvent) => void;
  /**
   * Open the READ-ONLY detail for a task whose completion has persisted.
   * Deliberately a separate prop from `onEdit`: the completed row's intent is
   * VIEW, never EDIT, and the two must never be reachable from the same
   * affordance (see the completed-row comment below).
   *
   * Optional. A surface that can only ever render OPEN tasks (the Overview
   * "Open tasks" card queries `status: 'open'`) passes nothing, and a completed
   * row there stays static text exactly as before.
   */
  onViewDetails?: (task: CalendarEvent) => void;
  /** True while this row is in the 5s undo window (committed but not yet sent). */
  isPendingComplete: boolean;
  /**
   * The care-recipient "today" (YYYY-MM-DD), for the overdue pill. Optional —
   * a caller that doesn't have it (the Overview "Open tasks" card doesn't
   * fetch it today) simply never shows the pill rather than computing it
   * wrong from the viewer's device clock.
   */
  today?: string;
}

export function TaskRow({
  task,
  timezone,
  canEdit,
  members,
  onComplete,
  onUndo,
  onEdit,
  onViewDetails,
  isPendingComplete,
  today,
}: TaskRowProps): ReactElement {
  const { t, i18n } = useTranslation('tasks');
  // Viewer's 12h/24h clock — every rendered time goes through it.
  const hourCycle = useHourCycle();

  // Persisted completion (from the server) OR an in-flight optimistic one.
  const isDone = Boolean(task.completed_at) || isPendingComplete;
  const hasDueDate = Boolean(task.scheduled_date);

  const assignee = useMemo(
    () => (task.assigned_to ? members.find((m) => m.id === task.assigned_to) : undefined),
    [members, task.assigned_to]
  );

  const isOverdue =
    !!today &&
    !task.completed_at &&
    !isPendingComplete &&
    hasDueDate &&
    task.scheduled_date < today;

  // Due-date label — TZ-correct. relative (Today/Yesterday) when applicable,
  // otherwise a short month/day; append the time (or "All day").
  const dueLabel = useMemo(() => {
    const relative = getRelativeDateLabel(task.scheduled_date, timezone);
    let dayLabel: string;
    if (relative === 'today') {
      dayLabel = t('due.today');
    } else if (relative === 'yesterday') {
      dayLabel = t('due.yesterday');
    } else {
      // Render the naive YYYY-MM-DD in the recipient TZ. Anchor at noon UTC so
      // the date never slips across midnight in any timezone.
      // DISPLAY locale is the APP language, not the browser's — a Spanish user
      // on an en-US browser must not get English month names.
      dayLabel = new Intl.DateTimeFormat(i18n.language, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${task.scheduled_date}T12:00:00Z`));
    }
    const timeLabel = task.scheduled_time
      ? formatEventTimeCompact(
          task.scheduled_time,
          timezone,
          hourCycle,
          // The task's OWN day, not today: Phoenix and Denver are one clock in
          // January and two in July, so whether this time needs naming depends
          // on when it falls, never on when it is read.
          zoneReferenceInstant(task.scheduled_date)
        )
      : t('row.allDay');
    return `${dayLabel} · ${timeLabel}`;
    // hourCycle MUST be a dep — the label is memoized, and the hook's value
    // flips once the currentUser query resolves.
  }, [task.scheduled_date, task.scheduled_time, timezone, t, hourCycle, i18n.language]);

  const titleClass = `${careCardTitle} font-semibold leading-[21px] ${
    isDone ? 'line-through text-ink-3' : ''
  }`;

  // Title text + its sr-only completion status — identical across the three
  // press-intent branches below so they cannot drift.
  const titleContent = (
    <>
      {task.title}
      <span className="sr-only"> {isDone ? t('row.statusDone') : t('row.statusPending')}</span>
    </>
  );

  // Meta row's own id — referenced by BOTH title buttons' `aria-describedby`
  // below, so a Tab/screen-reader user hears the assignee/due-date/overdue
  // text as the button's DESCRIPTION without it becoming part of the
  // accessible NAME (aria-describedby is additive; it never touches the name
  // computation). This is what keeps OpenTasksCard's pinned aria-label
  // constant identical while still surfacing this content to keyboard users.
  const metaRowId = `task-meta-${task.id}`;

  // Meta row — assignee, a separator dot, the due date (or "No due date"),
  // and the overdue pill. A plain SIBLING of the title (never inside a
  // button): the title alone carries the edit/view-details press so this
  // row's text is always independently announced rather than being folded
  // into (and duplicating) the button's aria-label.
  const metaRow = (
    <div id={metaRowId} className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
      {assignee ? (
        <span>{memberDisplayName(assignee)}</span>
      ) : (
        <span className="italic text-ink-3">{t('row.unassigned')}</span>
      )}
      <span aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-line" />
      {hasDueDate ? (
        <span>{dueLabel}</span>
      ) : (
        <span className="italic text-ink-3">{t('row.noDueDate')}</span>
      )}
      {isOverdue && <span className={STATUS_PILL.overdue}>{t('row.overdue')}</span>}
    </div>
  );

  // The Done / Undo action — identical markup rendered in both action slots
  // (see the module doc comment above). A PERSISTED completion renders
  // nothing here (mirrors mobile/src/components/tasks/TaskRow.tsx: its action
  // slot is `isPendingComplete ? <UndoBadge/> : !isCompleted ? <Done/> :
  // null`) — the completed row's "who did this" answer lives in the meta row
  // as a NAME, never an avatar; mobile's own meta row is name-only, no avatar.
  function renderAction(key: string): ReactElement | null {
    if (isPendingComplete) {
      return (
        <UndoBadge
          key={key}
          kind="done"
          label={t('row.completing')}
          undoLabel={t('row.undo')}
          itemLabel={task.title}
          onUndo={() => onUndo(task.id)}
          durationMs={UNDO_DELAY_MS}
        />
      );
    }
    if (task.completed_at) {
      return null;
    }
    if (canEdit) {
      return (
        <button
          key={key}
          type="button"
          onClick={() => onComplete(task)}
          aria-label={t('row.completeLabel', { title: task.title })}
          className={`${careCardActionPrimary} min-w-[66px] px-4`}
        >
          {t('row.done')}
        </button>
      );
    }
    return null;
  }

  return (
    <li className={careCardShell}>
      <div className={careCardTopRow}>
        {/* Status indicator, NOT a control — the Done button is the action, so
            a task is completed the same way a dose is taken. */}
        <span
          aria-hidden="true"
          className={`${careCardLeading} border-moss ${isDone ? 'bg-moss-deep' : ''} ${
            isDone ? 'opacity-55' : ''
          }`}
        >
          {isDone && <Icon name="checkmark" size={12} className="text-cream" />}
        </span>

        <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center">
          {/* Title — the ONLY pressable part of the row. Press intent:
              open → edit; completed → the read-only detail. A COMPLETED TASK
              IS NOT EDITABLE (founder directive): the gate keys on
              `completed_at` alone, so a task that were ever re-opened becomes
              editable again. */}
          {canEdit && !task.completed_at && !isPendingComplete ? (
            <button
              type="button"
              onClick={() => onEdit(task)}
              aria-label={`${t('row.editLabel', { title: task.title })}, ${dueLabel}, ${t(
                'row.statusPending'
              )}`}
              aria-describedby={metaRowId}
              className={`${titleClass} min-h-11 w-full text-left`}
            >
              {titleContent}
            </button>
          ) : task.completed_at && onViewDetails ? (
            <button
              type="button"
              onClick={() => onViewDetails(task)}
              aria-label={`${t('row.viewDetailsLabel', { title: task.title })}, ${dueLabel}, ${t(
                'row.statusDone'
              )}`}
              aria-describedby={metaRowId}
              className={`${titleClass} min-h-11 w-full text-left`}
            >
              {titleContent}
            </button>
          ) : (
            <span className={titleClass}>{titleContent}</span>
          )}
          {metaRow}
        </div>

        <div className={careCardActionsInline}>{renderAction('inline')}</div>
      </div>

      <div className={careCardActionsRow}>{renderAction('row')}</div>
    </li>
  );
}

export default TaskRow;
