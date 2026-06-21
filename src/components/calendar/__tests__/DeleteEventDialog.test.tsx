import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { DeleteEventDialog } from '../DeleteEventDialog';

const CIRCLE_ID = 'circle-1';

const mutateDelete = vi.fn();
vi.mock('@/hooks/useCalendarEvents', () => ({
  useDeleteEvent: () => ({ mutateAsync: mutateDelete, isPending: false }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ev-1',
    circle_id: CIRCLE_ID,
    event_type: 'medication',
    title: 'Metformin',
    medication_name: 'Metformin',
    scheduled_date: '2026-06-15',
    scheduled_time: '08:00:00',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateDelete.mockResolvedValue(undefined);
});

describe('DeleteEventDialog', () => {
  it('non-recurring: simple confirm → delete with NO scope params', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DeleteEventDialog circleId={CIRCLE_ID} event={makeEvent()} onClose={onClose} />);

    // No 3-way scope choice for a one-off event.
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));
    expect(mutateDelete).toHaveBeenCalledWith({ eventId: 'ev-1' });
    expect(onClose).toHaveBeenCalled();
  });

  it('recurring: 3-way scope → "this & future" sends deleteScope=future + scheduledDate', async () => {
    const user = userEvent.setup();
    render(
      <DeleteEventDialog
        circleId={CIRCLE_ID}
        event={makeEvent({
          id: 'instance-9',
          parent_event_id: 'parent-7',
          recurrence_rule: 'daily',
          scheduled_date: '2026-06-20',
        })}
        onClose={vi.fn()}
      />
    );

    // 3-way choice present; default is "this event only".
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    await user.click(screen.getByLabelText('This and all future events'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));
    // Scoped delete targets the PARENT series + passes the instance date.
    expect(mutateDelete).toHaveBeenCalledWith({
      eventId: 'parent-7',
      deleteScope: 'future',
      scheduledDate: '2026-06-20',
    });
  });

  it('recurring: default scope is "single" (this event only)', async () => {
    const user = userEvent.setup();
    render(
      <DeleteEventDialog
        circleId={CIRCLE_ID}
        event={makeEvent({
          parent_event_id: 'parent-7',
          recurrence_rule: 'weekly',
          scheduled_date: '2026-06-20',
        })}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));
    expect(mutateDelete).toHaveBeenCalledWith({
      eventId: 'parent-7',
      deleteScope: 'single',
      scheduledDate: '2026-06-20',
    });
  });
});
