import { render, screen } from '@testing-library/react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';

/**
 * TASK ASSIGNED TO A MEMBER WHO WAS THEN REMOVED — what the row shows (web).
 *
 * Test-gap audit 2026-09-29 §2 Tasks ⚠️ "Task assigned to a member who is then
 * removed: client rendering". Backend contract
 * (backend/src/routes/circles.ts `removeMemberFromCircle`, ~:997-1005): on
 * removal, INCOMPLETE events assigned to the removed user move to the circle
 * OWNER; COMPLETED tasks deliberately keep the original assignee "for
 * historical record". GET /tasks embeds the assignee as `assigned_to_user`
 * (backend/src/routes/tasks.ts:155) — the removed user's `users` row still
 * exists, so the embed still names them.
 *
 * CORRECTION (W19, 2026-10-01): the row existing is NOT enough. The embed is
 * read through the user-scoped client and `users` RLS hides a removed member
 * who shares no other circle with the viewer, so it came back null. The backend
 * now fills it name-only (backend/src/utils/userDisplayNames.ts); see
 * DepartedMemberNameEmbed.test.tsx for that wire shape.
 *
 * Mobile's TaskRow renders that embed (mobile TaskRowRemovedAssignee.test.tsx,
 * passing). Web's own EventDetailModal does too (embed first, roster second,
 * EventDetailModal.tsx:193-205). Web's TaskRow does NOT: it resolves the
 * assignee only from the CURRENT member roster (TaskRow.tsx:109-112), where a
 * removed member no longer appears.
 */

vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => '12h',
}));

const { TaskRow } = await import('../TaskRow');

function member(overrides: Partial<CircleMember>): CircleMember {
  return {
    id: 'x',
    email: 'x@example.com',
    first_name: null,
    last_name: null,
    role: 'member',
    is_care_recipient: false,
    is_medication_responsible: false,
    joined_at: '2026-01-01T00:00:00Z',
    timezone: null,
    ...overrides,
  };
}

const OWNER = member({ id: '11111111-1111-4111-8111-111111111111', first_name: 'Ana', last_name: 'Pérez', role: 'owner' });
const REMOVED_ID = '33333333-3333-4333-8333-333333333333';
const REMOVED_EMBED = { id: REMOVED_ID, first_name: 'Luis', last_name: 'Mesa', email: 'luis@example.com' };

function makeTask(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'task-1',
    circle_id: 'circle-1',
    title: 'Refill pill organizer',
    event_type: 'task',
    scheduled_date: '2026-10-01',
    scheduled_time: '12:00:00',
    status: 'open',
    assigned_to: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as CalendarEvent;
}

function renderRow(task: CalendarEvent) {
  return render(
    <TaskRow
      task={task}
      timezone="America/Denver"
      canEdit
      members={[OWNER]} // the removed member is no longer on the roster
      onComplete={vi.fn()}
      onUndo={vi.fn()}
      onEdit={vi.fn()}
      isPendingComplete={false}
    />
  );
}

const completedByRemoved = () =>
  makeTask({
    assigned_to: REMOVED_ID,
    assigned_to_user: REMOVED_EMBED as CalendarEvent['assigned_to_user'],
    completed_at: '2026-09-20T15:00:00Z',
    status: 'completed',
  } as Partial<CalendarEvent>);

describe('web TaskRow after the assignee was removed from the circle', () => {
  it('an OPEN task (reassigned server-side to the owner) shows the owner', () => {
    renderRow(
      makeTask({
        assigned_to: OWNER.id,
        assigned_to_user: { id: OWNER.id, first_name: 'Ana', last_name: 'Pérez', email: 'x@example.com' },
      } as Partial<CalendarEvent>)
    );
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument();
    expect(screen.queryByText('Luis Mesa')).not.toBeInTheDocument();
  });

  // FIXED 09-29: TaskRow resolves the assignee embed-first, roster-second
  // (EventDetailModal's order), so a COMPLETED task still names the removed
  // member instead of reading "Unassigned".
  it('a COMPLETED task keeps its historical assignee: the removed member is still named', () => {
    renderRow(completedByRemoved());
    expect(screen.getByText('Luis Mesa')).toBeInTheDocument();
  });
});
