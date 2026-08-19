import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { Avatar, Button, careCardSurface, careCardActions } from '@/components/ui';
import { useHourCycle } from '@/hooks/useHourCycle';
import { UNDO_DELAY_MS } from '@/hooks/useTaskCompletion';
import { formatEventTimeCompact, getRelativeDateLabel } from '@/utils/timezone';

// The ONE task row. Rendered by the full Tasks page and by the Overview
// "Open tasks" card, the same way mobile shares mobile/src/components/tasks/
// TaskRow.tsx between its Tasks tab and its home-screen OpenTasks card (and the
// same way MedicationRow is shared across every medication surface here).
//
// TIMEZONE: due-date labels use the care recipient's timezone (never
// device-local). scheduled_date/scheduled_time are naive local values in that
// timezone — formatted with getRelativeDateLabel / formatEventTimeCompact.

function memberDisplayName(member: CircleMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return name || member.email;
}

function CheckIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export interface TaskRowProps {
  task: CalendarEvent;
  timezone: string;
  canEdit: boolean;
  members: CircleMember[];
  onComplete: (task: CalendarEvent) => void;
  onUndo: (taskId: string) => void;
  onEdit: (task: CalendarEvent) => void;
  /** True while this row is in the 5s undo window (committed but not yet sent). */
  isPendingComplete: boolean;
}

export function TaskRow({
  task,
  timezone,
  canEdit,
  members,
  onComplete,
  onUndo,
  onEdit,
  isPendingComplete,
}: TaskRowProps): ReactElement {
  const { t, i18n } = useTranslation('tasks');
  // Viewer's 12h/24h clock — every rendered time goes through it.
  const hourCycle = useHourCycle();

  // Persisted completion (from the server) OR an in-flight optimistic one.
  const isDone = Boolean(task.completed_at) || isPendingComplete;

  const assignee = useMemo(
    () => (task.assigned_to ? members.find((m) => m.id === task.assigned_to) : undefined),
    [members, task.assigned_to]
  );

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
      ? formatEventTimeCompact(task.scheduled_time, timezone, hourCycle)
      : t('row.allDay');
    return `${dayLabel} · ${timeLabel}`;
    // hourCycle MUST be a dep — the label is memoized, and the hook's value
    // flips once the currentUser query resolves.
  }, [task.scheduled_date, task.scheduled_time, timezone, t, hourCycle, i18n.language]);

  return (
    <li className={careCardSurface}>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Complete checkbox — gated on canEdit. While pending, the same control
            is the undo target (mirrors mobile's TaskRow.handleCheckboxPress). A
            persisted completion (already on the server) is not re-toggleable. */}
        {/* Status indicator, NOT a control. The action is the labelled Done
            button below — a task is finished the same way a dose is taken and a
            calendar item is completed. Hiding the only completion affordance
            inside a 24px circle made it the one care action in the app you had
            to discover. */}
        <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full border ${
              isDone ? 'border-moss-deep bg-moss-deep text-cream' : 'border-line text-ink-3'
            }`}
          >
            {isDone ? <CheckIcon /> : null}
          </span>
        </span>

        {/* Title + due-date. While the undo window is open we cannot nest the
            real Undo button inside the edit button, so the body becomes static
            text and shows the "Completing… Undo" affordance instead of the
            edit affordance (mirrors mobile's TaskRow swapping the meta row for
            an UndoBadge).

            COMPLETED TASKS ARE LOCKED (founder directive): once a completion
            has persisted (task.completed_at), the row body renders as static
            text — no edit affordance — same as the !canEdit branch. The gate
            keys on completed_at alone, so a task that were ever re-opened
            (completed_at cleared) becomes editable again. */}
        {/* WB3: completion was conveyed to sighted users only via
            strikethrough — add matching sr-only status text (mirrors
            GettingStartedChecklist's statusDone/statusPending pattern). */}
        {canEdit && isPendingComplete ? (
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm font-medium text-ink-3 line-through">{task.title}</p>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-xs font-medium text-moss-deep">{t('row.completing')}</span>
              <button
                type="button"
                onClick={() => onUndo(task.id)}
                aria-label={t('row.undoAction', { title: task.title })}
                className="rounded-full px-2 py-0.5 text-xs font-semibold text-moss underline underline-offset-2 transition-colors hover:text-moss-deep"
              >
                {t('row.undo')}
              </button>
            </div>
            {/* Draining countdown bar — decorative; commit timer runs in JS. */}
            <div
              aria-hidden="true"
              className="mt-1 h-0.5 w-full overflow-hidden rounded-full bg-moss-soft"
            >
              <div
                className="h-full origin-left bg-moss"
                style={{ animation: `cc-countdown ${UNDO_DELAY_MS}ms linear forwards` }}
              />
            </div>
            {/* Politely announce the pending completion for screen readers. */}
            <span className="sr-only" role="status" aria-live="polite">
              {t('row.pendingAnnounce', { title: task.title })}
            </span>
          </div>
        ) : canEdit && !task.completed_at ? (
          <button
            type="button"
            onClick={() => onEdit(task)}
            aria-label={t('row.editLabel', { title: task.title })}
            className="min-w-0 flex-1 text-left"
          >
            <p
              className={`m-0 truncate text-sm font-medium ${
                isDone ? 'text-ink-3 line-through' : 'text-ink'
              }`}
            >
              {task.title}
              <span className="sr-only">
                {' '}
                {isDone ? t('row.statusDone') : t('row.statusPending')}
              </span>
            </p>
            <p className="m-0 mt-0.5 truncate text-xs text-ink-3">{dueLabel}</p>
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <p
              className={`m-0 truncate text-sm font-medium ${
                isDone ? 'text-ink-3 line-through' : 'text-ink'
              }`}
            >
              {task.title}
              <span className="sr-only">
                {' '}
                {isDone ? t('row.statusDone') : t('row.statusPending')}
              </span>
            </p>
            <p className="m-0 mt-0.5 truncate text-xs text-ink-3">{dueLabel}</p>
          </div>
        )}

        {/* Assignee avatar */}
        <span
          className="shrink-0"
          title={assignee ? memberDisplayName(assignee) : t('row.unassigned')}
        >
          {assignee ? (
            <>
              <Avatar size="sm" name={memberDisplayName(assignee)} />
              <span className="sr-only">{memberDisplayName(assignee)}</span>
            </>
          ) : (
            <span className="sr-only">{t('row.unassigned')}</span>
          )}
        </span>
      </div>

      {/* Action area — the same position and shell as the medication card's
          Skip/Take and the calendar card's Done. Hidden once the task is
          actually completed, and replaced by the undo affordance above while
          the grace period is open. */}
      {canEdit && !isPendingComplete && !task.completed_at && (
        <div className={`${careCardActions} px-4 pb-3`}>
          <Button
            onClick={() => onComplete(task)}
            aria-label={t('row.completeLabel', { title: task.title })}
            className="min-h-11 px-4 text-xs"
          >
            {t('row.done')}
          </Button>
        </div>
      )}
    </li>
  );
}

export default TaskRow;
