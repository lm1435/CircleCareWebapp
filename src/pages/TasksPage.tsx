import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { TaskSort, TaskStatus } from '@/api/tasks';
import { Avatar, Button, Card, EmptyState, Select, Skeleton } from '@/components/ui';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { useTasks } from '@/hooks/useTasks';
import { useCompleteEvent } from '@/hooks/useCalendarEvents';
import { useCircle } from '@/hooks/useCircle';
import type { CircleMember } from '@/api/circleMembers';
import { formatEventTimeCompact, getRelativeDateLabel } from '@/utils/timezone';

// Stage 2, Task 2.3 — tasks list page.
//
// PORT of mobile/src/screens/TasksScreen.tsx behavior: status filter
// (open | completed | all), sort (due_date | assignee | created_at), a complete
// checkbox (reuses useCompleteEvent — parity with mobile, which completes a task
// via completeEvent), assignee avatars, and TZ-correct due-date labels. A task
// IS a calendar event with event_type: 'task'; row click opens AddEventModal in
// edit mode and "Add task" opens it in create mode defaulting to type=task.
//
// TIMEZONE: due-date labels use the care recipient's timezone (never
// device-local). scheduled_date/scheduled_time are naive local values in that
// timezone — formatted with getRelativeDateLabel / formatEventTimeCompact.

const SKELETON_ROWS = [0, 1, 2, 3];

// Grace period before a completed task is actually committed. Mirrors mobile's
// 5s undo window (mobile/src/components/tasks/OpenTasks.tsx UNDO_DELAY_MS): the
// checkbox flips to checked, the row shows a draining "Completing… Undo"
// affordance, and the complete mutation only fires once this elapses. Undo
// before then cancels with nothing committed.
const UNDO_DELAY_MS = 5000;

const STATUS_OPTIONS: TaskStatus[] = ['open', 'completed', 'all'];
const SORT_OPTIONS: TaskSort[] = ['due_date', 'assignee', 'created_at'];

function memberDisplayName(member: CircleMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return name || member.email;
}

/** Checklist glyph for the empty state tile (decorative). */
function TasksEmptyIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 11l2 2 4-4" />
      <rect x="3" y="4" width="18" height="16" rx="2" />
    </svg>
  );
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

interface TaskRowProps {
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

function TaskRow({
  task,
  timezone,
  canEdit,
  members,
  onComplete,
  onUndo,
  onEdit,
  isPendingComplete,
}: TaskRowProps): ReactElement {
  const { t } = useTranslation('tasks');

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
      dayLabel = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${task.scheduled_date}T12:00:00Z`));
    }
    const timeLabel = task.scheduled_time
      ? formatEventTimeCompact(task.scheduled_time, timezone)
      : t('row.allDay');
    return `${dayLabel} · ${timeLabel}`;
  }, [task.scheduled_date, task.scheduled_time, timezone, t]);

  return (
    <li className="rounded-2xl border border-line bg-cream">
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Complete checkbox — gated on canEdit. While pending, the same control
            is the undo target (mirrors mobile's TaskRow.handleCheckboxPress). A
            persisted completion (already on the server) is not re-toggleable. */}
        {canEdit ? (
          <button
            type="button"
            onClick={() =>
              isPendingComplete ? onUndo(task.id) : task.completed_at ? undefined : onComplete(task)
            }
            disabled={Boolean(task.completed_at)}
            role="checkbox"
            aria-checked={isDone}
            aria-label={
              isPendingComplete
                ? t('row.undoAction', { title: task.title })
                : isDone
                  ? t('row.undoLabel', { title: task.title })
                  : t('row.completeLabel', { title: task.title })
            }
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors disabled:cursor-default ${
              isDone
                ? 'border-moss-deep bg-moss-deep text-cream'
                : 'border-line text-ink-3 hover:border-ink-3 hover:text-ink'
            }`}
          >
            {isDone ? <CheckIcon /> : null}
          </button>
        ) : (
          <span
            aria-hidden="true"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${
              isDone ? 'border-moss-deep bg-moss-deep text-cream' : 'border-line text-ink-3'
            }`}
          >
            {isDone ? <CheckIcon /> : null}
          </span>
        )}

        {/* Title + due-date. While the undo window is open we cannot nest the
            real Undo button inside the edit button, so the body becomes static
            text and shows the "Completing… Undo" affordance instead of the
            edit affordance (mirrors mobile's TaskRow swapping the meta row for
            an UndoBadge). */}
        {canEdit && isPendingComplete ? (
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm font-medium text-ink-3 line-through">
              {task.title}
            </p>
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
        ) : canEdit ? (
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
    </li>
  );
}

/**
 * Tasks page (Stage 2, Task 2.3). Status filter + sort drive useTasks; rows show
 * title, assignee avatar, TZ-correct due-date, and a complete checkbox gated on
 * canEdit. Rows open AddEventModal (edit, type=task); "Add task" opens it in
 * create mode. Loading / empty / error states mirror the other pages.
 */
export default function TasksPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t } = useTranslation(['tasks', 'common']);

  const [status, setStatus] = useState<TaskStatus>('open');
  const [sort, setSort] = useState<TaskSort>('due_date');
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<CalendarEvent | null>(null);

  const { canEdit, members } = useCircle(circleId);
  const tasksQuery = useTasks(circleId, { status, sort });
  const completeMutation = useCompleteEvent(circleId);

  // ── Undo grace period (mirrors mobile OpenTasks) ──────────────────────────
  // Tasks the user checked but that haven't committed yet. Each maps to the
  // pending commit timer so undo can cancel it. Keep a ref alongside the state
  // so the unmount cleanup sees the latest timers without re-subscribing.
  const [pendingIds, setPendingIds] = useState<Set<string>>(() => new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const completeMutationRef = useRef(completeMutation);
  completeMutationRef.current = completeMutation;

  // On unmount, flush any still-pending completions (commit them) and clear
  // their timers — no leaked setTimeout, and no silently-dropped completion.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timerId, eventId) => {
        clearTimeout(timerId);
        completeMutationRef.current.mutate(eventId);
      });
      timers.clear();
    };
  }, []);

  const tasks = tasksQuery.data?.tasks ?? [];
  // The resolved care-recipient timezone comes back on the tasks response.
  const timezone = tasksQuery.data?.timezone ?? 'America/New_York';

  const statusOptions = useMemo(
    () => STATUS_OPTIONS.map((value) => ({ value, label: t(`filter.status.${value}`) })),
    [t]
  );
  const sortOptions = useMemo(
    () => SORT_OPTIONS.map((value) => ({ value, label: t(`filter.sort.${value}`) })),
    [t]
  );

  // Start the undo window: flip the row to checked and schedule the real
  // commit for UNDO_DELAY_MS later. The commit clears its own pending entry so
  // a fresh fetch (post-invalidation) can take over.
  const handleComplete = useCallback(
    (task: CalendarEvent): void => {
      const eventId = task.id;
      const existing = timersRef.current.get(eventId);
      if (existing) clearTimeout(existing);

      const timerId = setTimeout(() => {
        timersRef.current.delete(eventId);
        completeMutationRef.current.mutate(eventId, {
          onSettled: () => {
            setPendingIds((prev) => {
              if (!prev.has(eventId)) return prev;
              const next = new Set(prev);
              next.delete(eventId);
              return next;
            });
          },
        });
      }, UNDO_DELAY_MS);

      timersRef.current.set(eventId, timerId);
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.add(eventId);
        return next;
      });
    },
    []
  );

  // Cancel the pending completion — nothing is committed.
  const handleUndo = useCallback((eventId: string): void => {
    const timerId = timersRef.current.get(eventId);
    if (timerId) clearTimeout(timerId);
    timersRef.current.delete(eventId);
    setPendingIds((prev) => {
      if (!prev.has(eventId)) return prev;
      const next = new Set(prev);
      next.delete(eventId);
      return next;
    });
  }, []);

  // Switching filters (status/sort) tears the list down — flush any in-flight
  // pending completions immediately so they aren't stranded off-screen.
  useEffect(() => {
    const timers = timersRef.current;
    if (timers.size === 0) return;
    timers.forEach((timerId, eventId) => {
      clearTimeout(timerId);
      completeMutationRef.current.mutate(eventId);
    });
    timers.clear();
    setPendingIds(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sort]);

  let body: ReactElement;
  if (tasksQuery.isLoading) {
    body = (
      <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-busy="true">
        <li className="sr-only">{t('loading')}</li>
        {SKELETON_ROWS.map((row) => (
          <li key={row} className="rounded-2xl border border-line bg-cream px-4 py-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-2/3 max-w-64" />
                <Skeleton className="mt-2 h-3 w-1/3 max-w-40" />
              </div>
              <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
            </div>
          </li>
        ))}
      </ul>
    );
  } else if (tasksQuery.isError) {
    body = (
      <Card className="text-center">
        <p className="m-0 font-medium text-ink">{t('errorTitle')}</p>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('errorHint')}</p>
        <Button variant="ghost" className="mt-4" onClick={() => void tasksQuery.refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (tasks.length === 0) {
    body = (
      <Card className="p-8">
        <EmptyState
          tone="moss"
          icon={<TasksEmptyIcon />}
          title={t(`empty.${status}`)}
          description={t(`empty.${status}Hint`)}
        >
          {canEdit && <Button onClick={() => setShowCreate(true)}>{t('empty.cta')}</Button>}
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            timezone={timezone}
            canEdit={canEdit}
            members={members}
            onComplete={handleComplete}
            onUndo={handleUndo}
            onEdit={setEditingTask}
            isPendingComplete={pendingIds.has(task.id)}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className="mx-auto max-w-5xl p-6 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="serif m-0 text-xl text-ink">{t('title')}</h1>
          <p className="m-0 mt-1 text-sm text-ink-3">{t('subtitle')}</p>
        </div>
        {canEdit && <Button onClick={() => setShowCreate(true)}>{t('addTask')}</Button>}
      </header>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          id="tasks-status-filter"
          label={t('filter.statusLabel')}
          value={status}
          onChange={(e) => setStatus(e.target.value as TaskStatus)}
          options={statusOptions}
        />
        <Select
          id="tasks-sort"
          label={t('filter.sortLabel')}
          value={sort}
          onChange={(e) => setSort(e.target.value as TaskSort)}
          options={sortOptions}
        />
      </div>

      <div className="mt-6">{body}</div>

      {showCreate && (
        <AddEventModal
          circleId={circleId}
          initialType="task"
          onClose={() => setShowCreate(false)}
        />
      )}

      {editingTask && (
        <AddEventModal
          circleId={circleId}
          event={editingTask}
          onClose={() => setEditingTask(null)}
        />
      )}
    </section>
  );
}
