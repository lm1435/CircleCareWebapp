import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Skeleton, SectionHeader, careCardListGap } from '@/components/ui';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { TaskRow } from '@/components/tasks/TaskRow';
import { useCircle } from '@/hooks/useCircle';
import { useTasks } from '@/hooks/useTasks';
import { useTaskCompletion } from '@/hooks/useTaskCompletion';

// Web counterpart of mobile/src/components/tasks/OpenTasks.tsx — the Overview
// "Open tasks" card. It used to render bare, non-interactive <li> text while the
// full Tasks page had the complete row (status circle, labelled Done, 5s undo
// grace period). Both surfaces now render the SAME TaskRow and drive it with the
// SAME useTaskCompletion hook, exactly as mobile shares its TaskRow between the
// Tasks tab and the home screen.
//
// Self-contained like TodaysMeds: it owns its heading, its queries, and its
// action flow; OverviewPage just drops it inside a <Card>.

const DEFAULT_LIMIT = 3;

export interface OpenTasksCardProps {
  circleId: string;
  /** How many open tasks to show before the "+N more" line. */
  limit?: number;
}

export function OpenTasksCard({
  circleId,
  limit = DEFAULT_LIMIT,
}: OpenTasksCardProps): ReactElement {
  const { t } = useTranslation(['overview', 'common']);
  const [editingTask, setEditingTask] = useState<CalendarEvent | null>(null);

  const { canEdit, members } = useCircle(circleId);
  const tasksQuery = useTasks(circleId, { status: 'open' });
  const openTasks = tasksQuery.data?.tasks ?? [];
  // The resolved care-recipient timezone comes back on the tasks response.
  const timezone = tasksQuery.data?.timezone ?? 'America/New_York';

  // Presence-only probe: has this circle EVER had a task (open or completed)?
  // Without it, a first-run circle gets "You're all caught up" — celebration
  // copy for something the user has never done. `limit: 1` keeps it to a single
  // row; it's a separate query key from the open-tasks list above, so it isn't
  // refetching the same data.
  const everTasksQuery = useTasks(circleId, { status: 'all', limit: 1 });
  const hasEverHadTask = (everTasksQuery.data?.tasks.length ?? 0) > 0;
  // Wait for both so the empty copy never flips from "all caught up" to first-run.
  const tasksLoading = tasksQuery.isLoading || everTasksQuery.isLoading;

  const { pendingIds, handleComplete, handleUndo } = useTaskCompletion(circleId);

  const visibleTasks = openTasks.slice(0, limit);
  const overflowCount = openTasks.length - visibleTasks.length;

  let body: ReactElement;
  if (tasksLoading) {
    body = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span role="status" className="sr-only">
          {t('common:loading')}
        </span>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  } else if (openTasks.length === 0) {
    body = (
      <p className="m-0 text-sm text-ink-2">
        {hasEverHadTask ? t('tasks.empty') : t('tasks.emptyFirstRun')}
      </p>
    );
  } else {
    body = (
      <>
        <ul className={`m-0 list-none p-0 ${careCardListGap}`}>
          {visibleTasks.map((task) => (
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
        {/* The remainder is a DESTINATION, not a caption. This stated the count
            in inert grey text directly under the list, so the one place a
            caregiver looks when the list runs short was the one place that did
            not respond — the route was only in the header, above the rows.
            Mobile's matching line is tappable; this now is too. Spec §6.3.6:
            the row is a full-width, centred 44-tall dusk line ("Show all N"),
            matching mobile's `showAllRow` rather than an underlined link. */}
        {overflowCount > 0 ? (
          <Link
            to={`/circles/${circleId}/tasks`}
            className="flex w-full min-h-[44px] items-center justify-center gap-1 py-3 text-md font-medium text-dusk"
          >
            {t('tasks.showAll', { count: openTasks.length })}
          </Link>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="open-tasks-heading">
      <SectionHeader
        id="open-tasks-heading"
        title={t('tasks.title')}
        tone="moss"
        to={`/circles/${circleId}/tasks`}
        linkLabel={t('tasks.viewAll')}
      />
      {body}

      {/* Row body opens the edit flow — parity with mobile's OpenTasks, whose
          handleTaskPress navigates to AddEvent for that task, and with the
          Tasks page, which wires `editingTask` into the same modal. */}
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

export default OpenTasksCard;
