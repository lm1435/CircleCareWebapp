import { render, screen } from '@testing-library/react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';

// Pinned so this test needs no QueryClientProvider (same as TaskRowZoneReference).
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => '12h',
}));

const { TaskRow } = await import('../TaskRow');

// A task may be assigned to the CARE RECIPIENT (an independent recipient with
// their own phone owning a meal-time task). The row resolves the assignee from
// the full circle member list, so it must show the recipient's name — never
// fall back to "Unassigned" as if the recipient were not a valid assignee.

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

const RECIPIENT = member({
  id: '22222222-2222-4222-8222-222222222222',
  first_name: 'Ray',
  last_name: 'Diaz',
  is_care_recipient: true,
});
const OWNER = member({ id: '11111111-1111-4111-8111-111111111111', first_name: 'Tess', role: 'owner' });

function makeTask(assigned_to: string | null): CalendarEvent {
  return {
    id: 'task-1',
    circle_id: 'circle-1',
    title: 'Lunch',
    event_type: 'task',
    scheduled_date: '2026-10-01',
    scheduled_time: '12:00:00',
    status: 'open',
    assigned_to,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as CalendarEvent;
}

it('shows the care recipient as the assignee of a recipient-assigned task', () => {
  render(
    <TaskRow
      task={makeTask(RECIPIENT.id)}
      timezone="America/Denver"
      canEdit
      members={[OWNER, RECIPIENT]}
      onComplete={vi.fn()}
      onUndo={vi.fn()}
      onEdit={vi.fn()}
      isPendingComplete={false}
    />
  );
  expect(screen.getByText('Ray Diaz')).toBeInTheDocument();
  expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
});
