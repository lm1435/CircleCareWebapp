import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { AddEventModal } from '../AddEventModal';

// The TZ-correct payload is built by combining the picked date + time into a
// device-LOCAL instant, then reading that instant AS SEEN IN the care
// recipient's timezone. To make that deterministic regardless of the machine
// running the test, pin the process timezone to America/Denver here. Node's
// Date honors a runtime process.env.TZ change (tzset). The RECIPIENT timezone
// is America/New_York (+2h), chosen to differ from the device TZ so a late
// evening time crosses midnight into the next calendar day.
const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'America/Denver';
});
afterAll(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const RECIPIENT_TZ = 'America/New_York';
const CIRCLE_ID = 'circle-1';

// ── Hook mocks ──────────────────────────────────────────────────────────────
const mutateCreate = vi.fn();
const mutateUpdate = vi.fn();

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
}));

const useCircleResult = {
  circle: undefined,
  circleSummary: undefined,
  timezone: RECIPIENT_TZ,
  members: [] as Array<{
    id: string;
    email: string;
    first_name: string | null;
    is_care_recipient: boolean;
  }>,
  canEdit: true,
  accessLevel: 'full' as const,
  viewOnly: false,
  readOnly: false,
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('@/hooks/useCircle', () => ({
  useCircle: () => useCircleResult,
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
    event_type: 'appointment',
    title: 'Checkup',
    scheduled_date: '2026-06-15',
    scheduled_time: '14:00:00',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useCircleResult.canEdit = true;
  useCircleResult.members = [];
  mutateCreate.mockResolvedValue(makeEvent());
  mutateUpdate.mockResolvedValue(makeEvent());
});

describe('AddEventModal', () => {
  it('blocks submit and shows + focuses the title error when title is empty', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(mutateCreate).not.toHaveBeenCalled();
    const titleInput = screen.getByLabelText('Title');
    expect(titleInput).toHaveAttribute('aria-invalid', 'true');
    expect(titleInput).toHaveFocus();
    expect(screen.getByText('Please enter a title.')).toBeInTheDocument();
  });

  it('builds a TZ-correct payload (recipient TZ differs → crosses midnight)', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

    await user.type(screen.getByLabelText('Title'), 'Eye exam');
    // Date pickers take a YYYY-MM-DD value; type controls take HH:MM.
    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    await user.clear(dateInput);
    await user.type(dateInput, '2026-06-15');
    const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
    await user.clear(timeInput);
    await user.type(timeInput, '23:00');
    const endInput = screen.getByLabelText('End time') as HTMLInputElement;
    await user.clear(endInput);
    await user.type(endInput, '23:30');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0];
    // 11:00 PM Denver === 1:00 AM the NEXT DAY in New York.
    expect(payload.scheduled_date).toBe('2026-06-16');
    expect(payload.scheduled_time).toBe('01:00');
    expect(payload.event_type).toBe('appointment');
    expect(payload.title).toBe('Eye exam');
    // 30-minute appointment → duration carried through.
    expect(payload.duration_minutes).toBe(30);
  });

  it('edit mode targets the PARENT series id and prefills', async () => {
    const user = userEvent.setup();
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={makeEvent({
          id: 'instance-9',
          parent_event_id: 'parent-7',
          event_type: 'task',
          title: 'Refill Rx',
          scheduled_time: null,
        })}
        onClose={vi.fn()}
      />
    );

    // Prefilled title from the instance.
    expect(screen.getByLabelText('Title')).toHaveValue('Refill Rx');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const args = mutateUpdate.mock.calls[0][0];
    // Edits ALWAYS target parent_event_id || id — never the instance id.
    expect(args.eventId).toBe('parent-7');
    expect(args.data.title).toBe('Refill Rx');
    expect(mutateCreate).not.toHaveBeenCalled();
  });

  it('renders nothing when the user cannot edit', () => {
    useCircleResult.canEdit = false;
    const { container } = render(
      <AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
