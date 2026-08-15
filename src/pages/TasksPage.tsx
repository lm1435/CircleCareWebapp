import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { TaskSort, TaskStatus } from '@/api/tasks';
import { Button, Card, EmptyState, Select, Skeleton, careCardSurface } from '@/components/ui';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { TaskRow } from '@/components/tasks/TaskRow';
import { useTasks } from '@/hooks/useTasks';
import { useTaskCompletion } from '@/hooks/useTaskCompletion';
import { useCircle } from '@/hooks/useCircle';

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

// The 5s undo grace period and the row itself both live outside this page now —
// see hooks/useTaskCompletion.ts and components/tasks/TaskRow.tsx — so the
// Overview "Open tasks" card renders the identical row with the identical
// behavior instead of a divergent copy.

const STATUS_OPTIONS: TaskStatus[] = ['open', 'completed', 'all'];
const SORT_OPTIONS: TaskSort[] = ['due_date', 'assignee', 'created_at'];

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

/**
 * Tasks page (Stage 2, Task 2.3). Status filter + sort drive useTasks; rows show
 * title, assignee avatar, TZ-correct due-date, and a complete checkbox gated on
 * canEdit. Rows open AddEventModal (edit, type=task); "Add task" opens it in
 * create mode. Loading / empty / error states mirror the other pages.
 */
export default function TasksPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t } = useTranslation(['tasks', 'calendar', 'common']);

  const [status, setStatus] = useState<TaskStatus>('open');
  const [sort, setSort] = useState<TaskSort>('due_date');
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<CalendarEvent | null>(null);

  const { canEdit, members } = useCircle(circleId);
  const tasksQuery = useTasks(circleId, { status, sort });

  // ── Undo grace period (mirrors mobile OpenTasks) ──────────────────────────
  // Shared with the Overview "Open tasks" card via useTaskCompletion rather than
  // kept as a second copy: the hook owns the pending ids, their commit timers,
  // and the unmount / pagehide / visibilitychange flushes.
  const { pendingIds, handleComplete, handleUndo, flushPending } = useTaskCompletion(circleId);

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

  // Switching filters (status/sort) tears the list down — flush any in-flight
  // pending completions immediately so they aren't stranded off-screen.
  useEffect(() => {
    flushPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, sort]);

  let body: ReactElement;
  if (tasksQuery.isLoading) {
    body = (
      <ul className="m-0 flex list-none flex-col gap-3 p-0" aria-busy="true">
        <li className="sr-only">{t('loading')}</li>
        {SKELETON_ROWS.map((row) => (
          <li key={row} className={`${careCardSurface} px-4 py-3`}>
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center">
                <Skeleton className="h-6 w-6 rounded-full" />
              </span>
              <div className="flex-1">
                <Skeleton className="h-4 w-2/3 max-w-64" />
                <Skeleton className="mt-2 h-3 w-1/3 max-w-40" />
              </div>
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
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
          {canEdit && (
            <div className="flex flex-col items-center gap-4">
              <Button onClick={() => setShowCreate(true)}>{t('empty.cta')}</Button>
            </div>
          )}
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
