import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { EventDetailActions } from '../EventDetailActions';

// WA6 — after reactivate-for-edit succeeds, this component's OWN edit-guard
// and Discontinue/Reactivate label must reflect the new state immediately,
// without waiting on the parent to refresh its (possibly stale) `event`
// snapshot. Before the fix, `isDiscontinued` was derived only from
// `event.discontinued_at`, so a successful reactivate left the guard
// re-prompting "reactivate to edit" and the toggle button still reading
// "Reactivate" until the detail modal was closed and reopened.

const completeMutateAsync = vi.fn();
const statusMutateAsync = vi.fn();

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCompleteEvent: () => ({ mutateAsync: completeMutateAsync, isPending: false }),
  useMedicationStatus: () => ({ mutateAsync: statusMutateAsync, isPending: false }),
}));

const showToast = vi.fn();
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, useToast: () => ({ showToast }) };
});

function makeMed(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'm-1',
    circle_id: 'circle-1',
    event_type: 'medication',
    title: 'Metformin',
    medication_name: 'Metformin',
    medication_dosage: '500mg',
    discontinued_at: null,
    parent_event_id: null,
    scheduled_date: '2026-07-29',
    scheduled_time: '08:00:00',
    completed_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  } as CalendarEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  statusMutateAsync.mockResolvedValue({});
  completeMutateAsync.mockResolvedValue({});
});

describe('EventDetailActions', () => {
  it('an inactive medication prompts to reactivate instead of opening the editor', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <EventDetailActions
        circleId="circle-1"
        event={inactive}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(
      screen.getByText('This medication is inactive. Reactivate it to make changes.')
    ).toBeInTheDocument();
  });

  it('WA6: after reactivate-for-edit succeeds, Edit opens the editor directly on the next click', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <EventDetailActions
        circleId="circle-1"
        event={inactive}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    // The confirm dialog's own "Reactivate" button, disambiguated from the
    // toggle button below (which ALSO reads "Reactivate" while inactive).
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() =>
      expect(statusMutateAsync).toHaveBeenCalledWith({ eventId: 'm-1', discontinued: false })
    );

    // Guard is gone; a second Edit click goes straight to the editor — no
    // second reactivate prompt for a medication that was JUST reactivated.
    expect(
      screen.queryByText('This medication is inactive. Reactivate it to make changes.')
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('WA6: the Discontinue/Reactivate toggle label flips to Discontinue immediately after reactivating', async () => {
    const user = userEvent.setup();
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <EventDetailActions
        circleId="circle-1"
        event={inactive}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(statusMutateAsync).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Discontinue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
  });

  it('WA6: calls the optional onReactivated callback so a parent can refresh its own stale snapshot', async () => {
    const user = userEvent.setup();
    const onReactivated = vi.fn();
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <EventDetailActions
        circleId="circle-1"
        event={inactive}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
        onReactivated={onReactivated}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(onReactivated).toHaveBeenCalledTimes(1));
  });

  // FOUNDER DIRECTIVE — once a task is completed it is no longer editable.
  // The Edit button disappears (same shape as Mark complete disappearing);
  // Delete is deliberately unchanged. Scoped to tasks only.
  it('a completed task offers no Edit button — Delete remains', () => {
    const completedTask = makeMed({
      id: 't-1',
      event_type: 'task',
      title: 'Pick up prescription',
      medication_name: null,
      medication_dosage: null,
      completed_at: '2026-07-29T15:00:00Z',
    });

    render(
      <EventDetailActions
        circleId="circle-1"
        event={completedTask}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('an open task keeps Edit and Mark complete', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const openTask = makeMed({
      id: 't-2',
      event_type: 'task',
      title: 'Pick up prescription',
      medication_name: null,
      medication_dosage: null,
      completed_at: null,
    });

    render(
      <EventDetailActions
        circleId="circle-1"
        event={openTask}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('a completed appointment still offers Edit — the lock is scoped to tasks', () => {
    const completedAppt = makeMed({
      id: 'a-1',
      event_type: 'appointment',
      title: 'Cardiology follow-up',
      medication_name: null,
      medication_dosage: null,
      completed_at: '2026-07-29T15:00:00Z',
    });

    render(
      <EventDetailActions
        circleId="circle-1"
        event={completedAppt}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Edit event' })).toBeInTheDocument();
  });

  it('an active medication opens the editor directly (no guard)', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const active = makeMed();

    render(
      <EventDetailActions
        circleId="circle-1"
        event={active}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Edit event' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
