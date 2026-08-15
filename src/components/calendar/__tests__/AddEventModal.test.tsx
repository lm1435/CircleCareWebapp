import { render, screen, waitFor, within } from '@testing-library/react';
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
// Cached-events snapshot feeding the title quick-fill chips (QP6) — tests
// assign fixtures; the factory reads it lazily.
let cachedEventsMock: CalendarEvent[] = [];

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => cachedEventsMock,
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
  cachedEventsMock = [];
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

  // ── Past-time notice (mobile GAP #4 parity) ───────────────────────────────
  // Only Date is faked (timers stay real so userEvent works). Frozen instant:
  // 2026-06-15T18:00:00Z → 14:00 in New York (recipient), 12:00 in Denver
  // (device). A 10:00 Denver pick = 12:00 New York = already past there.
  describe('past-time notice for today\'s medications', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-06-15T18:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function fillMedication(time: string): Promise<void> {
      const user = userEvent.setup();
      await user.type(screen.getByLabelText('Medication name'), 'Metformin');
      const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
      await user.clear(dateInput);
      await user.type(dateInput, '2026-06-15');
      const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, time);
      await user.click(screen.getByRole('button', { name: 'Create' }));
    }

    it('warns before saving a med whose time already passed today, then saves on Continue', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await fillMedication('10:00'); // 12:00 New York — 2h in the past there.

      // Notice shown, save deferred.
      expect(mutateCreate).not.toHaveBeenCalled();
      expect(
        screen.getByText(
          "This time has already passed today — no reminder will be sent for today's dose."
        )
      ).toBeInTheDocument();

      // Non-blocking: Continue proceeds with the save.
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.event_type).toBe('medication');
      expect(payload.scheduled_date).toBe('2026-06-15');
      expect(payload.scheduled_time).toBe('12:00');
    });

    it('cancelling the notice keeps the form open without saving', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await fillMedication('10:00');
      // Two Cancel buttons exist (form footer + notice) — scope to the notice.
      const notice = screen.getByRole('dialog', { name: 'Time already passed' });
      await user.click(within(notice).getByRole('button', { name: 'Cancel' }));

      expect(mutateCreate).not.toHaveBeenCalled();
      // Form still open with the entered value.
      expect(screen.getByLabelText('Medication name')).toHaveValue('Metformin');
    });

    it('saves a still-upcoming med time directly, with no notice', async () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await fillMedication('20:00'); // 22:00 New York — still upcoming there.

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      expect(
        screen.queryByText(
          "This time has already passed today — no reminder will be sent for today's dose."
        )
      ).not.toBeInTheDocument();
    });
  });

  describe('quick-pick chips (Round 3)', () => {
    it('appointment title chip fills the title, shows selected, and untaps to clear', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Doctor visit' }));

      expect(screen.getByLabelText('Title')).toHaveValue('Doctor visit');
      // Row stays visible with the matching chip pressed (accidental-tap undo).
      const chip = screen.getByRole('button', { name: 'Doctor visit' });
      expect(chip).toHaveAttribute('aria-pressed', 'true');

      await user.click(chip);
      expect(screen.getByLabelText('Title')).toHaveValue('');
      expect(screen.getByRole('button', { name: 'Doctor visit' })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('title chips surface the circle history (cached events) ahead of generics', () => {
      cachedEventsMock = [
        makeEvent({ id: 'h1', title: 'Cardiology follow-up', scheduled_date: '2026-06-10' }),
        makeEvent({ id: 'h2', title: 'cardiology follow-up', scheduled_date: '2026-06-20' }),
      ];
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

      const group = screen.getByRole('group', { name: 'Title suggestions' });
      const chips = within(group).getAllByRole('button');
      // History first (deduped case-insensitively, most recent casing), then
      // generics padding to 6.
      expect(chips[0]).toHaveTextContent('cardiology follow-up');
      expect(chips).toHaveLength(6);
    });

    it('title chip prefill via initialTitle (R4-3 starter chips) fills the field', () => {
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          initialType="task"
          initialTitle="Grocery run"
          onClose={vi.fn()}
        />
      );
      expect(screen.getByLabelText('Title')).toHaveValue('Grocery run');
      // The matching suggestion chip reads as selected (exact match).
      expect(screen.getByRole('button', { name: 'Grocery run' })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    it('scopes the chip rows: presets are medication-only, title chips are appt/task-only', () => {
      const { unmount } = render(
        <AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />
      );
      expect(screen.queryByRole('group', { name: 'Title suggestions' })).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Common schedules' })).toBeInTheDocument();
      unmount();

      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
      expect(screen.queryByRole('group', { name: 'Common schedules' })).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Title suggestions' })).toBeInTheDocument();
    });
  });

  // ── Round 6 (R6-2): consolidated medication schedule presets ──────────────
  // ONE chip strip for the med flow; every chip sets a COMPLETE daily schedule
  // (time + daily recurrence) in one tap; untap returns both to unset. Web
  // subset: single time field → everyMorning + everyEvening only.
  describe('schedule presets (R6-2)', () => {
    const MORNING_CHIP = 'Every morning (8:00 AM)';
    const EVENING_CHIP = 'Every evening (8:00 PM)';

    it('tapping a preset sets the time AND daily recurrence in one gesture', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      const group = screen.getByRole('group', { name: 'Common schedules' });
      const chip = within(group).getByRole('button', { name: MORNING_CHIP });
      expect(chip).toHaveAttribute('aria-pressed', 'false');

      await user.click(chip);

      expect(screen.getByLabelText('Time')).toHaveValue('08:00');
      expect(screen.getByLabelText('Repeat')).toHaveValue('daily');
      expect(within(group).getByRole('button', { name: MORNING_CHIP })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    it('the evening preset sets 20:00 + daily; switching chips swaps the time', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      const group = screen.getByRole('group', { name: 'Common schedules' });

      await user.click(within(group).getByRole('button', { name: 'Every evening (8:00 PM)' }));
      expect(screen.getByLabelText('Time')).toHaveValue('20:00');
      expect(screen.getByLabelText('Repeat')).toHaveValue('daily');
      expect(within(group).getByRole('button', { name: EVENING_CHIP })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(within(group).getByRole('button', { name: MORNING_CHIP })).toHaveAttribute(
        'aria-pressed',
        'false'
      );

      // Switching to the morning chip moves the whole schedule.
      await user.click(within(group).getByRole('button', { name: MORNING_CHIP }));
      expect(screen.getByLabelText('Time')).toHaveValue('08:00');
      expect(screen.getByLabelText('Repeat')).toHaveValue('daily');
      expect(within(group).getByRole('button', { name: EVENING_CHIP })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('untapping the selected preset returns time and recurrence to unset', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      const group = screen.getByRole('group', { name: 'Common schedules' });

      await user.click(within(group).getByRole('button', { name: MORNING_CHIP }));
      expect(screen.getByLabelText('Time')).toHaveValue('08:00');

      await user.click(within(group).getByRole('button', { name: MORNING_CHIP }));

      expect(screen.getByLabelText('Time')).toHaveValue('');
      expect(screen.getByLabelText('Repeat')).toHaveValue('none');
      expect(within(group).getByRole('button', { name: MORNING_CHIP })).toHaveAttribute(
        'aria-pressed',
        'false'
      );
    });

    it('selected state requires the EXACT time + recurrence pair', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      const group = screen.getByRole('group', { name: 'Common schedules' });

      // 08:00 typed alone (no recurrence) is NOT the schedule preset.
      const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '08:00');
      expect(within(group).getByRole('button', { name: MORNING_CHIP })).toHaveAttribute(
        'aria-pressed',
        'false'
      );

      // Adding daily recurrence completes the exact match.
      await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
      expect(within(group).getByRole('button', { name: MORNING_CHIP })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    it('is prefill-only: the saved payload carries the preset time + daily rule', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText('Medication name'), 'Metformin');
      // A future date so the past-time notice can't interpose.
      const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
      await user.clear(dateInput);
      await user.type(dateInput, '2027-01-05');
      const group = screen.getByRole('group', { name: 'Common schedules' });
      await user.click(within(group).getByRole('button', { name: MORNING_CHIP }));

      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.recurrence_rule).toBe('daily');
      // 08:00 device-local (Denver) reads as 10:00 in the recipient TZ (NY) —
      // the same TZ conversion every manual time pick goes through.
      expect(payload.scheduled_time).toBe('10:00');
      expect(payload.scheduled_date).toBe('2027-01-05');
    });

    it('only renders for medications', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      expect(screen.queryByRole('group', { name: 'Common schedules' })).not.toBeInTheDocument();
    });

    it('the old "Common times" strip is gone — one chip strip in the med flow', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      expect(screen.queryByRole('group', { name: 'Common times' })).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Common schedules' })).toBeInTheDocument();
      // And that consolidated strip carries both complete-schedule chips.
      const group = screen.getByRole('group', { name: 'Common schedules' });
      expect(within(group).getAllByRole('button')).toHaveLength(2);
    });
  });

  // ── Reminder gating + duration presets + assignee clearing ────────────────

  describe('reminders', () => {
    it('hides the reminders section for a task with no time', async () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      // Nothing to fire against: the cron filters scheduled_time IS NOT NULL.
      expect(screen.queryByText('Send reminders')).not.toBeInTheDocument();
    });

    it('shows the reminders section once a time is set', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '14:00');

      expect(screen.getByText('Send reminders')).toBeInTheDocument();
    });

    it('always shows reminders for a medication', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      expect(screen.getByText('Send reminders')).toBeInTheDocument();
    });

    it('never persists reminder flags on a timeless task', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText('Title'), 'Refill this week');
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.scheduled_time).toBeUndefined();
      // reminder_15m defaults to true in state — it must not reach the payload.
      expect(payload.reminder_15m).toBe(false);
      expect(payload.reminder_30m).toBe(false);
      expect(payload.reminder_1h).toBe(false);
      expect(payload.reminder_24h).toBe(false);
    });
  });

  describe('duration presets', () => {
    it('prefills a 30-minute end time when a start time is picked', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

      const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '14:00');

      expect(screen.getByLabelText('End time')).toHaveValue('14:30');
    });

    it('a duration chip sets the end time', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

      const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '14:00');

      const group = screen.getByRole('group', { name: 'Duration' });
      await user.click(within(group).getByRole('button', { name: '2 hrs' }));

      expect(screen.getByLabelText('End time')).toHaveValue('16:00');
    });

    it('offers no duration chips before a start time exists', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
      expect(screen.queryByRole('group', { name: 'Duration' })).not.toBeInTheDocument();
    });

    it('offers no duration chips for medications', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      expect(screen.queryByRole('group', { name: 'Duration' })).not.toBeInTheDocument();
    });
  });

  describe('assignee', () => {
    it('sends an explicit null when an assigned task is set back to Anyone', async () => {
      const user = userEvent.setup();
      useCircleResult.members = [
        { id: 'user-2', first_name: 'Tess', email: 't@example.com', is_care_recipient: false },
      ];

      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          // duration_minutes so the end-time field prefills — without it the
          // form blocks on the pre-existing "end time required" rule.
          event={makeEvent({
            event_type: 'task',
            assigned_to: 'user-2',
            duration_minutes: 30,
          })}
          onClose={vi.fn()}
        />
      );

      // Clear the assignee — this used to be dropped from the payload, so the
      // previous assignee survived the save.
      await user.selectOptions(screen.getByLabelText('Assigned to'), '');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const args = mutateUpdate.mock.calls[0][0];
      expect(args.data.assigned_to).toBeNull();
    });
  });
});
