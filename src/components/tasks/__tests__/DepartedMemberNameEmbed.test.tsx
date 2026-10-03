import { render, screen } from '@testing-library/react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';

/**
 * A MEMBER REMOVED FROM THE CIRCLE KEEPS THEIR NAME ON THE WORK THEY DID (W19).
 *
 * Root cause (proven 2026-10-01): the backend embeds assignee / completer /
 * feed actor through the user-scoped client, and `users` RLS hides anyone the
 * viewer no longer shares a circle with — so the embed came back NULL, the
 * roster no longer had them either, and web read "Unassigned", an
 * unattributed "Completed on", or "System". The backend now fills that null
 * embed with a NAME-ONLY object `{ id, first_name, last_name }` — NO email
 * (backend/src/utils/userDisplayNames.ts).
 *
 * Every fixture below uses exactly that shape, with the person ABSENT from the
 * roster, which is the real post-removal state.
 */

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/components/calendar/EventNotesPanel', () => ({ EventNotesPanel: () => null }));

const { TaskRow } = await import('../TaskRow');
const { EventDetailModal } = await import('@/components/calendar/EventDetailModal');
const { getActorName } = await import('@/components/activity/activityFormat');

const DEPARTED = {
  id: '11111111-1111-4111-8111-111111111111',
  first_name: 'Lisa',
  last_name: 'Departed',
} as CalendarEvent['assigned_to_user'];

const OWNER = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'owner@example.com',
  first_name: 'Olive',
  last_name: 'Owner',
  role: 'owner',
  is_care_recipient: false,
  is_medication_responsible: false,
  joined_at: '2026-01-01T00:00:00Z',
  timezone: null,
} as CircleMember;

const completedTask = {
  id: 'task-1',
  circle_id: 'circle-1',
  title: 'Pick up prescription',
  event_type: 'task',
  scheduled_date: '2026-09-20',
  scheduled_time: '12:00:00',
  assigned_to: DEPARTED!.id,
  assigned_to_user: DEPARTED,
  completed_at: '2026-09-21T15:00:00Z',
  completed_by: DEPARTED!.id,
  completed_by_user: DEPARTED,
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-21T15:00:00Z',
} as CalendarEvent;

describe('departed member, name-only embed (no email) — web', () => {
  it('Tasks page row names the assignee, not "Unassigned"', () => {
    render(
      <TaskRow
        task={completedTask}
        timezone="America/Denver"
        canEdit
        members={[OWNER]}
        onComplete={vi.fn()}
        onUndo={vi.fn()}
        onEdit={vi.fn()}
        isPendingComplete={false}
      />
    );
    expect(screen.getByText('Lisa Departed')).toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
  });

  it('task / calendar detail names BOTH the assignee and the completer', () => {
    render(
      <EventDetailModal
        event={completedTask}
        careRecipientTimezone="America/Chicago"
        onClose={vi.fn()}
        members={[OWNER]}
      />
    );
    expect(screen.getByText('Assigned to')).toBeInTheDocument();
    expect(screen.getByText('Lisa Departed')).toBeInTheDocument();
    expect(screen.getByText('Completed by')).toBeInTheDocument();
    expect(screen.getByText(/^Lisa Departed · /)).toBeInTheDocument();
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
    expect(screen.queryByText('Completed on')).not.toBeInTheDocument();
  });

  it('activity feed names the actor, not "System"', () => {
    const t = (k: string) => k;
    expect(getActorName(DEPARTED as never, t)).toBe('Lisa Departed');
    expect(getActorName(null, t)).toBe('system');
  });
});
