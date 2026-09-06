import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { TaskSort, TaskStatus } from '@/api/tasks';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  MoreMenu,
  Skeleton,
  careCardListGap,
  careCardShell,
  type MoreMenuItem,
} from '@/components/ui';
import { PageMasthead } from '@/components/layout/PageMasthead';
import { CareTabs } from '@/components/layout/CareTabs';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { DeleteEventDialog } from '@/components/calendar/DeleteEventDialog';
import { EventDetailModal } from '@/components/calendar/EventDetailModal';
import { EventDetailActions } from '@/components/calendar/EventDetailActions';
import { TaskRow } from '@/components/tasks/TaskRow';
import { useTasks } from '@/hooks/useTasks';
import { useTaskCompletion } from '@/hooks/useTaskCompletion';
import { useCircle } from '@/hooks/useCircle';

// Tasks page (Wave 3, Task 16 — mobile-parity pass). PORT of
// mobile/src/screens/TasksScreen.tsx behavior: status filter
// (open | completed | all), sort (due_date | assignee | created_at), a complete
// action (reuses useCompleteEvent via useTaskCompletion — parity with mobile,
// which completes a task via completeEvent), assignee names, and TZ-correct
// due-date labels. A task IS a calendar event with event_type: 'task'; row
// press opens AddEventModal in edit mode for an open task, and "Add task"
// opens it in create mode defaulting to type=task.
//
// A COMPLETED task opens the calendar's EventDetailModal instead of a
// task-specific modal (mobile parity is one read-only record per event, not
// two divergent ones) — see the `viewingTask` block below.
//
// TIMEZONE: due-date labels use the care recipient's timezone (never
// device-local). scheduled_date/scheduled_time are naive local values in that
// timezone — formatted with getRelativeDateLabel / formatEventTimeCompact.

const SKELETON_ROWS = [0, 1, 2, 3];

// The 5s undo grace period and the row itself both live outside this page —
// see hooks/useTaskCompletion.ts and components/tasks/TaskRow.tsx — so the
// Overview "Open tasks" card renders the identical row with the identical
// behavior instead of a divergent copy.

const STATUS_OPTIONS: TaskStatus[] = ['open', 'completed', 'all'];
const SORT_OPTIONS: TaskSort[] = ['due_date', 'assignee', 'created_at'];

/**
 * Tasks page. Status filter + sort drive useTasks; rows show title, assignee,
 * TZ-correct due-date, and a complete action gated on canEdit. Rows open
 * AddEventModal (edit, type=task) when open, or the read-only EventDetailModal
 * when completed; "Add task" opens AddEventModal in create mode. Loading /
 * empty / error states mirror the other pages.
 */
export default function TasksPage(): ReactElement {
  const { circleId = '' } = useParams<{ circleId: string }>();
  const { t } = useTranslation(['tasks', 'calendar', 'common']);

  const [status, setStatus] = useState<TaskStatus>('open');
  const [sort, setSort] = useState<TaskSort>('due_date');
  const [showCreate, setShowCreate] = useState(false);
  const [editingTask, setEditingTask] = useState<CalendarEvent | null>(null);
  // A COMPLETED task opens the read-only detail instead — never the editor.
  // `deletingTask` is owned here (not by the detail modal) so the destructive
  // confirm replaces the detail rather than stacking on top of it, exactly as
  // CalendarPage does with EventDetailModal / DeleteEventDialog.
  const [viewingTask, setViewingTask] = useState<CalendarEvent | null>(null);
  const [deletingTask, setDeletingTask] = useState<CalendarEvent | null>(null);

  const { canEdit, members } = useCircle(circleId);
  const tasksQuery = useTasks(circleId, { status, sort });

  // ── Undo grace period (mirrors mobile OpenTasks) ──────────────────────────
  // Shared with the Overview "Open tasks" card via useTaskCompletion rather than
  // kept as a second copy: the hook owns the pending ids, their commit timers,
  // and the unmount / pagehide / visibilitychange flushes.
  const { pendingIds, handleComplete, handleUndo, flushPending } = useTaskCompletion(circleId);

  const tasks = tasksQuery.data?.tasks ?? [];
  // The resolved care-recipient timezone + "today" come back on the response.
  const timezone = tasksQuery.data?.timezone ?? 'America/New_York';
  const today = tasksQuery.data?.today;

  const statusItems: MoreMenuItem[] = useMemo(
    () =>
      STATUS_OPTIONS.map((value) => ({
        id: value,
        label: t(`filter.status.${value}`),
        onSelect: () => setStatus(value),
      })),
    [t]
  );
  const sortItems: MoreMenuItem[] = useMemo(
    () =>
      SORT_OPTIONS.map((value) => ({
        id: value,
        label: t(`filter.sort.${value}`),
        onSelect: () => setSort(value),
      })),
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
      <ul className={`${careCardListGap} m-0 list-none p-0 px-5`} aria-busy="true">
        <li className="sr-only">{t('loading')}</li>
        {SKELETON_ROWS.map((row) => (
          <li key={row} className={`${careCardShell}`}>
            <div className="flex items-center gap-3">
              <Skeleton className="h-[22px] w-[22px] shrink-0 rounded-full" />
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
      <Card className="mx-5 text-center">
        <p className="m-0 font-medium text-ink">{t('errorTitle')}</p>
        <p className="m-0 mt-1 text-sm text-ink-3">{t('errorHint')}</p>
        <Button variant="ghost" className="mt-4" onClick={() => void tasksQuery.refetch()}>
          {t('common:retry')}
        </Button>
      </Card>
    );
  } else if (tasks.length === 0) {
    body = (
      <div className="px-5">
        <EmptyState
          tone="moss"
          icon="checkbox-outline"
          title={t(`empty.${status}`)}
          description={t(`empty.${status}Hint`)}
          actions={
            canEdit && (
              <Button onClick={() => setShowCreate(true)}>{t('empty.cta')}</Button>
            )
          }
        />
      </div>
    );
  } else {
    body = (
      <ul className={`${careCardListGap} m-0 list-none p-0 px-5`}>
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            timezone={timezone}
            today={today}
            canEdit={canEdit}
            members={members}
            onComplete={handleComplete}
            onUndo={handleUndo}
            onEdit={setEditingTask}
            onViewDetails={setViewingTask}
            isPendingComplete={pendingIds.has(task.id)}
          />
        ))}
      </ul>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl pb-8">
      <PageMasthead
        section={t('common:nav.tasks')}
        tone="moss"
        title={t('title')}
        subtitle={t('subtitle')}
        rightAction={
          canEdit ? { name: 'add-outline', label: t('addTask'), onClick: () => setShowCreate(true) } : undefined
        }
      >
        <CareTabs />
      </PageMasthead>

      {/* Filters — labelled pills (spec §6.4), each a MoreMenu with a custom
          trigger so the current selection is always named rather than hidden
          behind a bare icon. */}
      <div className="flex gap-2 px-5 pb-4">
        <MoreMenu
          items={statusItems}
          align="left"
          renderTrigger={(p) => (
            <button
              {...p}
              type="button"
              // card-shell-ok: a MoreMenu trigger pill (rounded-full filter chip), not a card.
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-cream px-4 text-sm text-ink`}
            >
              {t('filter.statusPillLabel', { value: t(`filter.status.${status}`) })}
              <Icon name="chevron-down" size="inline" />
            </button>
          )}
        />
        <MoreMenu
          items={sortItems}
          align="left"
          renderTrigger={(p) => (
            <button
              {...p}
              type="button"
              // card-shell-ok: a MoreMenu trigger pill (rounded-full filter chip),
              // not a card — same reasoning as the status pill above.
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-line bg-cream px-4 text-sm text-ink`}
            >
              {t('filter.sortPillLabel', { value: t(`filter.sort.${sort}`) })}
              <Icon name="chevron-down" size="inline" />
            </button>
          )}
        />
      </div>

      {body}

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

      {/* Read-only detail for a completed task — the SAME calendar detail
          modal a completed event opens from the Calendar page (mobile parity:
          one read-only record per event, not a task-specific twin of it). A
          view-only member gets it too — it writes nothing — just without
          Delete (EventDetailModal's footer falls back to the download-app CTA
          when !canEdit) and without the note composer (EventNotesPanel gates
          its own composer on canEdit). */}
      {viewingTask && (
        <EventDetailModal
          event={viewingTask}
          careRecipientTimezone={timezone}
          circleId={circleId}
          canEdit={canEdit}
          // Attributes "Completed by <name>" when the tasks response's
          // `completed_by_user` embed is absent — same fallback chain
          // CalendarPage wires in, and the two must agree (mirrors mobile).
          members={members}
          editActions={
            <EventDetailActions
              circleId={circleId}
              event={viewingTask}
              careRecipientTimezone={timezone}
              // COMPLETED TASKS ARE LOCKED (founder directive) — EventDetailActions
              // itself hides Edit once `event.completed_at` is set, so this is
              // never actually reachable; it exists only to satisfy the prop.
              onEdit={() => {}}
              onDelete={() => {
                setDeletingTask(viewingTask);
                setViewingTask(null);
              }}
              // Neither applies to a task (event_type !== 'medication'):
              // EventDetailActions only calls these from its medication-only
              // branches, which a task never reaches.
              onDiscontinue={() => {}}
              onConfirmDose={() => {}}
            />
          }
          onClose={() => setViewingTask(null)}
        />
      )}

      {deletingTask && (
        <DeleteEventDialog
          circleId={circleId}
          event={deletingTask}
          // Analytics surface. `medication_deleted` is emitted for medications
          // only and a task is never one, so there is nothing to attribute.
          surface={null}
          onClose={() => setDeletingTask(null)}
        />
      )}
    </section>
  );
}
