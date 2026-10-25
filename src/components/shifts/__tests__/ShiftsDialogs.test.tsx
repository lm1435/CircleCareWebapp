import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { deleteEvent, getSeriesRoot, type CalendarEvent } from '@/api/calendarEvents';
import { assignShift, dropShift } from '@/api/shifts';
import { ToastProvider } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { useShiftsDialogs } from '../ShiftsDialogs';

vi.mock('@/api/calendarEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/calendarEvents')>()),
  deleteEvent: vi.fn(),
  getSeriesRoot: vi.fn(),
}));
vi.mock('@/api/shifts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/shifts')>()),
  dropShift: vi.fn(),
  assignShift: vi.fn(),
}));
vi.mock('@/hooks/useCircle', () => ({ useCircle: vi.fn() }));
vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    shiftDropped: vi.fn(),
    shiftAssigned: vi.fn(),
    shiftDeleted: vi.fn(),
    shiftTakeConflict: vi.fn(),
  },
}));
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const members = [
  { id: 'u-owner', first_name: 'Olivia', last_name: 'O', email: 'o@x.test', role: 'owner', is_care_recipient: false },
  { id: 'u-ana', first_name: 'Ana', last_name: 'R', email: 'a@x.test', role: 'member', is_care_recipient: false },
  { id: 'u-bo', first_name: 'Bo', last_name: 'R', email: 'b@x.test', role: 'member', is_care_recipient: false },
  { id: 'u-cy', first_name: 'Cy', last_name: 'R', email: 'c@x.test', role: 'member', is_care_recipient: false, view_only: true },
];

function circle(over: Record<string, unknown> = {}) {
  vi.mocked(useCircle).mockReturnValue({
    circle: { id: 'c', recipient_name: 'Rosa', owner_id: 'u-owner' },
    timezone: 'America/Chicago',
    members,
    canEdit: true,
    canManageMembers: true,
    viewerRole: 'owner',
    // Premium circle: shift writes are offered (a free circle is read-only for shifts).
    isPremiumCircle: true,
    isOwner: true,
    viewOnly: false,
    hasShifts: false,
    ...over,
  } as unknown as ReturnType<typeof useCircle>);
}

function shift(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'root_2026-10-21',
    parent_event_id: 'root',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Night',
    scheduled_date: '2026-10-21',
    scheduled_time: '20:00:00',
    duration_minutes: 720,
    recurrence_rule: 'daily',
    reminder_lead_minutes: 120,
    assigned_to: 'u-ana',
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function Harness({ s }: { s: CalendarEvent }) {
  const dialogs = useShiftsDialogs('c');
  return (
    <>
      <button type="button" onClick={() => dialogs.openDetail(s)}>
        open-detail
      </button>
      {dialogs.element}
    </>
  );
}

async function openDetail(s: CalendarEvent) {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <Harness s={s} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
  await user.click(screen.getByRole('button', { name: 'open-detail' }));
  const dialog = await screen.findByRole('dialog', { name: s.title });
  return { user, dialog };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: { id: 'u-ana', email: 'a@x.test', first_name: 'Ana', last_name: 'R' },
    isAuthenticated: true,
  } as never);
  circle();
  vi.mocked(dropShift).mockResolvedValue({ event: shift(), rootId: 'root' });
  vi.mocked(assignShift).mockResolvedValue({ event: shift(), rootId: 'root' });
  vi.mocked(deleteEvent).mockResolvedValue({ historyKept: false });
});

describe('Shift detail', () => {
  it('shows the facts: date, overnight time with "next day", repeat, who, reminder', async () => {
    const { dialog } = await openDetail(shift());
    expect(within(dialog).getByTestId('shift-detail-date')).toHaveTextContent('Wednesday, October 21');
    expect(within(dialog).getByTestId('shift-detail-time')).toHaveTextContent('8:00 PM – 8:00 AM (next day)');
    expect(within(dialog).getByTestId('shift-detail-repeat')).toHaveTextContent('Daily');
    expect(within(dialog).getByTestId('shift-detail-who')).toHaveTextContent('You');
    expect(within(dialog).getByTestId('shift-detail-reminder')).toHaveTextContent('2 hours before');
  });

  it('a child row (no rule of its own) reads the series root: "Weekly on ..."; "Repeats" while loading / on error', async () => {
    vi.mocked(getSeriesRoot).mockResolvedValue({
      id: 'root',
      scheduled_date: '2026-10-19',
      scheduled_time: '20:00:00',
      duration_minutes: 720,
      recurrence_rule: 'weekly',
      recurrence_days: [1, 3],
      recurrence_end_date: null,
    });
    const { dialog } = await openDetail(shift({ recurrence_rule: null, recurrence_days: null }));
    // Until the root arrives the row says "Repeats" (never "Never").
    expect(within(dialog).getByTestId('shift-detail-repeat')).toHaveTextContent(/^(Repeats|Weekly on Mon, Wed)$/);
    await waitFor(() =>
      expect(within(dialog).getByTestId('shift-detail-repeat')).toHaveTextContent('Weekly on Mon, Wed')
    );
    expect(getSeriesRoot).toHaveBeenCalledWith('c', 'root');
  });

  it('a child row whose root fails to load keeps "Repeats"', async () => {
    vi.mocked(getSeriesRoot).mockRejectedValue(new Error('boom'));
    const { dialog } = await openDetail(shift({ recurrence_rule: null, recurrence_days: null }));
    await waitFor(() => expect(getSeriesRoot).toHaveBeenCalled());
    expect(within(dialog).getByTestId('shift-detail-repeat')).toHaveTextContent('Repeats');
  });

  it('a one-off says "Never"', async () => {
    const { dialog } = await openDetail(shift({ id: 'one', parent_event_id: null, recurrence_rule: null }));
    expect(within(dialog).getByTestId('shift-detail-repeat')).toHaveTextContent('Never');
  });

  it('actions read Take, Drop, Edit, Assign, Delete (mobile order)', async () => {
    const { dialog } = await openDetail(shift());
    const names = within(dialog)
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((n) => ['Take', 'Drop shift', 'Edit', 'Assign', 'Delete'].includes(n ?? ''));
    expect(names).toEqual(['Drop shift', 'Edit', 'Assign', 'Delete']);
  });

  it('Edit / Assign / Delete are 44px buttons; Delete is the destructive (danger) variant', async () => {
    const { dialog } = await openDetail(shift());
    for (const name of ['Edit', 'Assign', 'Delete']) {
      const b = within(dialog).getByRole('button', { name });
      expect(b.tagName).toBe('BUTTON');
      expect(b.className).toContain('min-h-[44px]');
    }
    expect(within(dialog).getByRole('button', { name: 'Delete' }).className).toContain(
      'text-terracotta-deep'
    );
    expect(within(dialog).getByRole('button', { name: 'Edit' }).className).not.toContain(
      'text-terracotta-deep'
    );
  });

  it('an open shift: Take, Edit, Assign, Delete', async () => {
    const open = await openDetail(shift({ id: 'o2', assigned_to: null }));
    const order = within(open.dialog)
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((n) => ['Take', 'Drop shift', 'Edit', 'Assign', 'Delete'].includes(n ?? ''));
    expect(order).toEqual(['Take', 'Edit', 'Assign', 'Delete']);
  });

  it('an open shift offers Take; a plain member cannot assign or drop someone else', async () => {
    circle({ canManageMembers: false, viewerRole: 'member' });
    const { dialog } = await openDetail(shift({ assigned_to: null }));
    expect(within(dialog).getByRole('button', { name: 'Take' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Drop shift' })).not.toBeInTheDocument();
  });

  it('the assignee may drop their own shift; a member may not drop somebody else\'s', async () => {
    circle({ canManageMembers: false, viewerRole: 'member' });
    const own = await openDetail(shift({ assigned_to: 'u-ana' }));
    expect(within(own.dialog).getByRole('button', { name: 'Drop shift' })).toBeInTheDocument();
  });

  it('no actions without edit rights', async () => {
    circle({ canEdit: false });
    const { dialog } = await openDetail(shift({ assigned_to: null }));
    expect(within(dialog).queryByRole('button', { name: 'Take' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});

describe('Shift detail on a lapsed circle (readonly)', () => {
  it('shows the facts but offers NO action, even with edit rights and manage rights', async () => {
    circle({ isPremiumCircle: false, hasShifts: true, canEdit: true, canManageMembers: true });
    const { dialog } = await openDetail(shift({ assigned_to: null }));
    expect(within(dialog).getByTestId('shift-detail-who')).toBeInTheDocument();
    for (const name of ['Take', 'Drop shift', 'Edit', 'Assign', 'Delete']) {
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});

describe('Drop', () => {
  it('a repeating shift asks the scope; "This and future shifts" sends scope future with the occurrence date and its (virtual) id', async () => {
    const { user, dialog } = await openDetail(shift());
    await user.click(within(dialog).getByRole('button', { name: 'Drop shift' }));
    const confirm = await screen.findByRole('dialog', { name: 'Drop this shift?' });
    expect(within(confirm).getByRole('radio', { name: 'This shift' })).toBeChecked();
    await user.click(within(confirm).getByRole('radio', { name: 'This and future shifts' }));
    await user.click(within(confirm).getByRole('button', { name: 'Drop shift' }));
    await waitFor(() =>
      expect(dropShift).toHaveBeenCalledWith('c', 'root_2026-10-21', {
        scope: 'future',
        scheduledDate: '2026-10-21',
      })
    );
    expect(Analytics.shiftDropped).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'future', byRole: 'self' })
    );
    expect(await screen.findByText('You dropped "Night". It\'s open again.')).toBeInTheDocument();
  });

  it('409 SHIFT_NOT_ASSIGNED on a drop reads "already open"; any other failure names the action', async () => {
    vi.mocked(dropShift).mockRejectedValueOnce({ success: false, error: { code: 'SHIFT_NOT_ASSIGNED', message: 'x' } });
    const first = await openDetail(shift({ id: 'one', parent_event_id: null, recurrence_rule: null }));
    await first.user.click(within(first.dialog).getByRole('button', { name: 'Drop shift' }));
    const confirm = await screen.findByRole('dialog', { name: 'Drop this shift?' });
    await first.user.click(within(confirm).getByRole('button', { name: 'Drop shift' }));
    expect(await screen.findByText('This shift is already open.')).toBeInTheDocument();
  });

  it('an unknown failure on a drop says "We couldn\'t drop the shift."', async () => {
    vi.mocked(dropShift).mockRejectedValueOnce({ success: false, error: { code: 'INTERNAL', message: 'x' } });
    const { user, dialog } = await openDetail(shift({ id: 'one', parent_event_id: null, recurrence_rule: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Drop shift' }));
    const confirm = await screen.findByRole('dialog', { name: 'Drop this shift?' });
    await user.click(within(confirm).getByRole('button', { name: 'Drop shift' }));
    expect(await screen.findByText("We couldn't drop the shift. Try again.")).toBeInTheDocument();
  });

  it('took "Just this one" (series default open): "this day only" and a plain confirm with no scope', async () => {
    vi.mocked(getSeriesRoot).mockResolvedValue({ id: 'root', recurrence_rule: 'daily', assigned_to: null } as never);
    const { user, dialog } = await openDetail(shift({ id: 'phys1', recurrence_rule: null, is_virtual: false }));
    expect(await within(dialog).findByText('You · this day only')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Drop shift' }));
    const confirm = await screen.findByRole('dialog', { name: 'Drop this shift?' });
    expect(within(confirm).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Drop shift' }));
    await waitFor(() =>
      expect(dropShift).toHaveBeenCalledWith('c', 'phys1', { scope: 'occurrence', scheduledDate: '2026-10-21' })
    );
  });

  it('holding the series too (root is theirs): plain "You" and the scope question stays', async () => {
    vi.mocked(getSeriesRoot).mockResolvedValue({ id: 'root', recurrence_rule: 'daily', assigned_to: 'u-ana' } as never);
    const { user, dialog } = await openDetail(shift({ id: 'phys1', recurrence_rule: null, is_virtual: false }));
    await waitFor(() => expect(getSeriesRoot).toHaveBeenCalled());
    expect(within(dialog).queryByText('You · this day only')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Drop shift' }));
    const confirm = await screen.findByRole('dialog', { name: 'Drop this shift?' });
    expect(within(confirm).getByRole('radio', { name: 'This and future shifts' })).toBeInTheDocument();
  });

  it('a one-off is a plain confirm with no scope', async () => {
    const { user, dialog } = await openDetail(shift({ id: 'one', parent_event_id: null, recurrence_rule: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Drop shift' }));
    const confirm = await screen.findByRole('dialog', { name: 'Drop this shift?' });
    expect(within(confirm).queryByRole('radio')).not.toBeInTheDocument();
    await user.click(within(confirm).getByRole('button', { name: 'Drop shift' }));
    await waitFor(() =>
      expect(dropShift).toHaveBeenCalledWith('c', 'one', { scope: 'occurrence', scheduledDate: '2026-10-21' })
    );
  });

  it('403 SHIFT_DROP_FORBIDDEN explains who may drop', async () => {
    vi.mocked(dropShift).mockRejectedValue({ success: false, error: { code: 'SHIFT_DROP_FORBIDDEN', message: 'x' } });
    const { user, dialog } = await openDetail(shift({ id: 'one', parent_event_id: null, recurrence_rule: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Drop shift' }));
    const confirm = await screen.findByRole('dialog', { name: 'Drop this shift?' });
    await user.click(within(confirm).getByRole('button', { name: 'Drop shift' }));
    expect(
      await screen.findByText('Only the person on a shift, the owner or a manager can drop it.')
    ).toBeInTheDocument();
  });
});

describe('Assign', () => {
  it('owner picks a member and a scope; sends userId; non-view-only members only', async () => {
    const { user, dialog } = await openDetail(shift({ assigned_to: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    const confirm = await screen.findByRole('dialog', { name: 'Assign shift' });
    const assign = within(confirm).getByRole('button', { name: 'Assign' });
    expect(assign).toBeDisabled();
    // A list (no extra message line), nobody preselected, view-only members left out.
    expect(within(confirm).queryByText(/Choose who covers/)).not.toBeInTheDocument();
    expect(within(confirm).getAllByRole('radio', { name: /^(Olivia|Me|Bo)/ })).toHaveLength(3);
    await user.click(within(confirm).getByRole('radio', { name: 'Bo' }));
    await user.click(within(confirm).getByRole('radio', { name: 'This and future shifts' }));
    await user.click(assign);
    await waitFor(() =>
      expect(assignShift).toHaveBeenCalledWith('c', 'root_2026-10-21', {
        scope: 'future',
        scheduledDate: '2026-10-21',
        userId: 'u-bo',
      })
    );
    expect(Analytics.shiftAssigned).toHaveBeenCalledWith({ scope: 'future', byRole: 'owner' });
    expect(await screen.findByText('Bo is on the shift.')).toBeInTheDocument();
  });

  it('a failed assign keeps the dialog open with the inline error (shift-inline-error)', async () => {
    vi.mocked(assignShift).mockRejectedValueOnce({ success: false, error: { code: 'INTERNAL', message: 'x' } });
    const { user, dialog } = await openDetail(shift({ assigned_to: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    const confirm = await screen.findByRole('dialog', { name: 'Assign shift' });
    await user.click(within(confirm).getByRole('radio', { name: 'Bo' }));
    await user.click(within(confirm).getByRole('button', { name: 'Assign' }));
    const inline = await within(confirm).findByTestId('shift-inline-error');
    expect(inline).toHaveTextContent("We couldn't assign the shift. Try again.");
    expect(screen.getByRole('dialog', { name: 'Assign shift' })).toBeInTheDocument();
    expect(Analytics.shiftAssigned).not.toHaveBeenCalled();
  });

  it('the toast names the first name, else "Someone" (never an email local part)', async () => {
    circle({
      members: [...members, { id: 'u-no', first_name: null, last_name: null, email: 'secret.person@x.test', role: 'member', is_care_recipient: false }],
    });
    const { user, dialog } = await openDetail(shift({ assigned_to: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    const confirm = await screen.findByRole('dialog', { name: 'Assign shift' });
    await user.click(within(confirm).getByRole('radio', { name: /secret\.person/ }));
    await user.click(within(confirm).getByRole('button', { name: 'Assign' }));
    expect(await screen.findByText('Someone is on the shift.')).toBeInTheDocument();
    expect(screen.queryByText(/secret\.person is on/)).not.toBeInTheDocument();
  });

  it('marks whoever holds the shift now', async () => {
    const { user, dialog } = await openDetail(shift({ assigned_to: 'u-ana' }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    const confirm = await screen.findByRole('dialog', { name: 'Assign shift' });
    // Exactly one row carries the mark: the holder's (the signed-in Ana, "Me").
    const marks = within(confirm).getAllByText('on it now');
    expect(marks).toHaveLength(1);
    expect(marks[0].closest('label')).toBe(within(confirm).getByRole('radio', { name: /^Me/ }).closest('label'));
    expect(within(confirm).getByRole('radio', { name: 'Bo' })).toBeInTheDocument();
  });
});

describe('Delete', () => {
  it('this shift only -> DELETE the ROOT with deleteScope single + the occurrence date', async () => {
    const { user, dialog } = await openDetail(shift());
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete shift' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(deleteEvent).toHaveBeenCalledWith('c', 'root', {
        deleteScope: 'single',
        scheduledDate: '2026-10-21',
      })
    );
    expect(Analytics.shiftDeleted).toHaveBeenCalledWith({ scope: 'occurrence' });
  });

  it('this and future -> deleteScope future', async () => {
    const { user, dialog } = await openDetail(shift());
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete shift' });
    await user.click(within(confirm).getByRole('radio', { name: 'This and future shifts' }));
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(deleteEvent).toHaveBeenCalledWith('c', 'root', {
        deleteScope: 'future',
        scheduledDate: '2026-10-21',
      })
    );
  });

  it('a one-off deletes by its own id with no scope', async () => {
    const { user, dialog } = await openDetail(shift({ id: 'one', parent_event_id: null, recurrence_rule: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete shift' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteEvent).toHaveBeenCalledWith('c', 'one'));
  });

  it('a lapsed circle answers SUBSCRIPTION_REQUIRED: the owner-aware gate, never "couldn\'t update"', async () => {
    vi.mocked(deleteEvent).mockRejectedValue({
      success: false,
      error: { code: 'SUBSCRIPTION_REQUIRED', message: 'x' },
    });
    const { user, dialog } = await openDetail(shift({ id: 'one', parent_event_id: null, recurrence_rule: null }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete shift' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteEvent).toHaveBeenCalled());
    expect(screen.queryByText('Couldn’t update the shift. Please try again.')).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't update the shift. Please try again.")).not.toBeInTheDocument();
  });
});
