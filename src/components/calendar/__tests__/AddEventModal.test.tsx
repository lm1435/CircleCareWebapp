import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { AddEventModal } from '../AddEventModal';

// This file PINS the device zone, unconditionally — including under
// scripts/run-unit-timezones.sh.
//
// Deliberate, and the one place in the suite where that is right: these cases
// assert SPECIFIC viewer->recipient conversions ("11 PM Denver is 1 AM
// next-day New York"), and an expected value like that is only meaningful
// against a known viewer zone. Running them under ten zones would not test ten
// things — it would make the expectations wrong nine times.
//
// The conversion logic itself IS swept, where a sweep can say something:
// src/utils/__tests__/recipientEventDate.fixture.test.ts runs 2,025
// Postgres-derived cases and resolves its ground-truth row from whatever zone
// the process is in. This file tests that the COMPONENT wires that logic up;
// that file tests that the logic is right.
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

// RxNorm lookups never leave the test: `[]` keeps the medication-name field a
// plain input for every existing case; the rxcui case below overrides it.
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => cachedEventsMock,
}));

const useCircleResult = {
  circle: undefined as { recipient_name?: string } | undefined,
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

// The dual-timezone hint renders a real clock, so the modal now reads the
// viewer's 12h/24h preference. Pinned to 12h so the hint's text is assertable.
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => '12h',
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

/**
 * An event carrying the reminder flags. They live on the single-event detail
 * response, not on the calendar-list `CalendarEvent` type the modal is typed
 * against — the modal reads them defensively, so the fixture asserts the same.
 */
/**
 * `reminders` is typed as the REAL fields, not a local restatement of them, and
 * the return is NOT cast. A cast here would re-open the hole the type on
 * `CalendarEvent` exists to close: a flag dropped from the read type would keep
 * compiling in this file and every reminder-hydration test would go on passing
 * against an event that no longer carries it.
 *
 * Omit a key to model a row written before that column existed — the hydration
 * fallbacks (`?? true` for the anchor and the mute) are what that exercises.
 */
function makeReminderEvent(
  overrides: Partial<CalendarEvent>,
  reminders: Pick<
    CalendarEvent,
    | 'notifications_enabled'
    | 'reminder_at_due'
    | 'reminder_24h'
    | 'reminder_1h'
    | 'reminder_30m'
    | 'reminder_15m'
  >
): CalendarEvent {
  return { ...makeEvent(overrides), ...reminders };
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
    const titleInput = screen.getByLabelText(/^Title( \* \(required\))?$/);
    expect(titleInput).toHaveAttribute('aria-invalid', 'true');
    expect(titleInput).toHaveFocus();
    expect(screen.getByText('Please enter a title.')).toBeInTheDocument();
  });

  it('builds a TZ-correct payload (recipient TZ differs → crosses midnight)', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Eye exam');
    // Date pickers take a YYYY-MM-DD value; type controls take HH:MM.
    const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
    await user.clear(dateInput);
    await user.type(dateInput, '2026-06-15');
    const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
    await user.clear(timeInput);
    await user.type(timeInput, '23:00');
    const endInput = screen.getByLabelText(/^End time/) as HTMLInputElement;
    await user.clear(endInput);
    await user.type(endInput, '23:30');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0];
    // 11:00 PM Denver === 1:00 AM the NEXT DAY in New York. The caregiver
    // typed their own clock; the recipient's frame is what gets stored.
    expect(payload.scheduled_date).toBe('2026-06-16');
    expect(payload.scheduled_time).toBe('01:00');
    expect(payload.event_type).toBe('appointment');
    expect(payload.title).toBe('Eye exam');
    // 30-minute appointment → duration carried through.
    expect(payload.duration_minutes).toBe(30);
  });

  // ── THE ROUND TRIP ────────────────────────────────────────────────────────
  //
  // These are the tests that actually keep stored data still. An exact-wall-
  // clock assertion can be satisfied by a form that converts consistently in
  // one direction; only IDEMPOTENCE catches a hydration that is not the
  // inverse of its save, which is the shape the real bug had.
  describe('hydrate -> save is the identity (stored data does not move)', () => {
    it('re-saving an UNTOUCHED event reproduces the stored values exactly', async () => {
      const user = userEvent.setup();
      const stored = makeEvent({
        event_type: 'medication',
        title: 'Metformin',
        medication_name: 'Metformin',
        scheduled_date: '2026-06-15',
        // 8 PM — the dose the old conversion moved to 22:00 the same day for a
        // Denver device, and across midnight for a device further west.
        scheduled_time: '20:00:00',
      });

      render(
        <AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />
      );

      // Touch NOTHING. Save.
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const { data } = mutateUpdate.mock.calls[0][0];
      expect(data.scheduled_date).toBe('2026-06-15');
      expect(data.scheduled_time).toBe('20:00');
    });

    it('stays put across REPEATED open-and-save cycles (no drift)', async () => {
      // The old bug COMPOUNDED: hydration read the stored value verbatim while
      // the save converted it again, so each no-op save shifted the dose by
      // another (recipientOffset - deviceOffset). Two cycles is what tells a
      // one-time offset apart from an accumulating one.
      let current = makeEvent({
        event_type: 'medication',
        title: 'Metformin',
        medication_name: 'Metformin',
        scheduled_date: '2026-06-15',
        scheduled_time: '20:00:00',
      });

      for (let cycle = 0; cycle < 3; cycle += 1) {
        const user = userEvent.setup();
        const { unmount } = render(
          <AddEventModal circleId={CIRCLE_ID} event={current} onClose={vi.fn()} />
        );
        await user.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(cycle + 1));
        const { data } = mutateUpdate.mock.calls[cycle][0];
        expect(data.scheduled_date).toBe('2026-06-15');
        expect(data.scheduled_time).toBe('20:00');
        // Feed the saved values back in, exactly as a refetch would.
        current = makeEvent({
          ...current,
          scheduled_date: data.scheduled_date,
          scheduled_time: `${data.scheduled_time}:00`,
        });
        unmount();
      }
    });

    it('re-applies the 15-minute default when the TYPE is switched', async () => {
      // The global Create menu opens with NO initialType, so eventType starts
      // 'medication' and reminder15m initializes false. Switching to Task used
      // to leave it false — and a task has no at-time push, so the four
      // reminder flags ARE the notification. The event saved with
      // notifications_enabled true and nothing that ever fires.
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} onClose={vi.fn()} />);

      await user.selectOptions(screen.getByLabelText('Type'), 'task');
      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Pick up prescription');
      // A time is required for reminders to apply at all: the cron filters
      // `scheduled_time IS NOT NULL`, so a timeless task shows no reminder
      // controls (remindersApply) — its stored flags are inert rather than
      // rewritten. Set one so this test exercises a reminder that can fire.
      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '09:00');

      await user.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));

      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.event_type).toBe('task');
      expect(payload.notifications_enabled).toBe(true);
      // The one flag that makes a task audible.
      expect(payload.reminder_15m).toBe(true);
    });

    it('does not re-apply the default over a choice the user made', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Pick up prescription');
      const timeField = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeField);
      await user.type(timeField, '09:00');

      // Explicitly turn 15m OFF, then switch type and back.
      await user.click(screen.getByLabelText('15 minutes before'));
      await user.selectOptions(screen.getByLabelText('Type'), 'appointment');

      await user.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      expect(mutateCreate.mock.calls[0][0].reminder_15m).toBe(false);
    });

    it('tells the user reminders are delivered by the mobile app', async () => {
      // The web app has no push and never registers a token; the backend's
      // notificationService returns `no_token` and stops, with no email
      // fallback. Without this line the section is configuration for something
      // a web-only caregiver will never receive.
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '09:00');

      expect(
        screen.getByText(
          'Reminders are delivered to the CircleCare mobile app. The web app cannot send them.'
        )
      ).toBeInTheDocument();
    });

    it('does not silently truncate a midnight-crossing duration', async () => {
      // REGRESSION. Hydrating the end time with `addMinutesToTimeStr` (which
      // clamps at 23:59) turned a 22:00 + 180min appointment into 22:00-23:59,
      // which PASSES the end>start check — so an untouched Save rewrote
      // duration_minutes from 180 to 119. A three-hour appointment became
      // 1h59m with nothing on screen.
      //
      // Rolling over gives 01:00, which fails validation loudly. That is the
      // correct behaviour while the form has one date field: this event cannot
      // be expressed here, so it must refuse rather than corrupt.
      const user = userEvent.setup();
      const stored = makeEvent({
        event_type: 'appointment',
        title: 'Night shift handover',
        scheduled_date: '2026-06-15',
        scheduled_time: '22:00:00',
        duration_minutes: 180,
      });

      render(<AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />);

      // Denver device, New York recipient: 22:00 NY hydrates to 20:00 MT, and
      // 20:00 + 180 rolls to 23:00 — still same-day, so this one SAVES and must
      // round-trip its duration exactly.
      expect((screen.getByLabelText(/^End time/) as HTMLInputElement).value).toBe('23:00');

      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      expect(mutateUpdate.mock.calls[0][0].data.duration_minutes).toBe(180);
    });

    it('refuses, rather than truncates, when the end really does cross midnight', async () => {
      const user = userEvent.setup();
      const stored = makeEvent({
        event_type: 'appointment',
        title: 'Night shift handover',
        scheduled_date: '2026-06-15',
        // 23:00 NY hydrates to 21:00 MT; +240 rolls past midnight to 01:00.
        scheduled_time: '23:00:00',
        duration_minutes: 240,
      });

      render(<AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />);
      expect((screen.getByLabelText(/^End time/) as HTMLInputElement).value).toBe('01:00');

      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      // Loud, not silent: nothing is written and the user is told.
      expect(mutateUpdate).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/^End time/)).toHaveAttribute('aria-invalid', 'true');
    });

    it('keeps scheduled_date and recurrence_end_date in the SAME frame', async () => {
      // The backend compares these two directly
      // (backend/src/utils/adherenceSchedule.ts: `if (current >
      // recurrence_end_date) break`), so expressing them in different frames
      // silently drops the last occurrence of an evening series. The start date
      // used to be converted device->recipient while the end date was sent
      // verbatim; now neither is converted, so a series that ends on its start
      // date still contains that day.
      const user = userEvent.setup();
      const stored = makeEvent({
        event_type: 'medication',
        title: 'Metformin',
        medication_name: 'Metformin',
        scheduled_date: '2026-06-15',
        scheduled_time: '20:00:00',
        recurrence_rule: 'daily',
        recurrence_end_date: '2026-06-15',
      });

      render(
        <AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />
      );
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const { data } = mutateUpdate.mock.calls[0][0];
      expect(data.scheduled_date).toBe('2026-06-15');
      expect(data.recurrence_end_date).toBe('2026-06-15');
      // The invariant the backend actually enforces.
      expect(data.recurrence_end_date >= data.scheduled_date).toBe(true);
    });
  });

  // ── THE LOAD RACE ─────────────────────────────────────────────────────────
  describe('the circle query resolving AFTER mount', () => {
    it('re-hydrates through the RESOLVED zone, so an untouched save is still a no-op', async () => {
      // The dangerous shape: hydrate in one frame, save in another.
      //
      // `useCircle` reports 'America/New_York' until the circle detail lands,
      // and the hydration useState runs ONCE — hooks execute even on the
      // renders where the modal returns null for !canEdit. Without the resync
      // the fields still hold values converted out of NEW YORK while the save
      // converts them back into TOKYO, and the difference is written to a dose
      // the user only looked at.
      //
      // Asserted as IDEMPOTENCE rather than an exact wall clock, so the
      // expectation does not depend on which device zone the sweep is running
      // under — and so a stale hydration cannot satisfy it by converting
      // consistently in one direction.
      const user = userEvent.setup();
      const stored = makeEvent({
        event_type: 'medication',
        title: 'Metformin',
        medication_name: 'Metformin',
        scheduled_date: '2026-06-15',
        scheduled_time: '20:00:00',
      });

      useCircleResult.timezone = 'America/New_York';
      useCircleResult.canEdit = false;
      const { rerender } = render(
        <AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />
      );

      // Circle resolves to a zone far from the fallback.
      useCircleResult.timezone = 'Asia/Tokyo';
      useCircleResult.canEdit = true;
      rerender(<AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />);

      await user.click(await screen.findByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const { data } = mutateUpdate.mock.calls[0][0];
      expect(data.scheduled_date).toBe('2026-06-15');
      expect(data.scheduled_time).toBe('20:00');
    });

    it('does NOT clobber a date the user already picked', async () => {
      try {
        useCircleResult.timezone = 'America/New_York';
        const user = userEvent.setup();
        const { rerender } = render(
          <AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />
        );

        const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
        await user.clear(dateInput);
        await user.type(dateInput, '2026-07-04');

        useCircleResult.timezone = 'Pacific/Kiritimati';
        rerender(
          <AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />
        );

        expect((screen.getByLabelText(/^Date/) as HTMLInputElement).value).toBe('2026-07-04');
      } finally {
        useCircleResult.timezone = RECIPIENT_TZ;
      }
    });
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
    expect(screen.getByLabelText(/^Title( \* \(required\))?$/)).toHaveValue('Refill Rx');

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
  // Two copy variants, selected on create-vs-edit. Creating: the backend rolls
  // the med's start forward to its next real occurrence, so NOTHING lands on
  // today — the notice must not promise/deny a reminder for today. Editing: the
  // row stays on today and only today's reminder is lost.
  const CREATE_PAST_TIME_MESSAGE =
    'This time has already passed today, so nothing will be recorded for today. This medication will start with its next scheduled dose.';
  const EDIT_PAST_TIME_MESSAGE =
    "This time has already passed today — no reminder will be sent for today's dose.";

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
      await user.type(screen.getByLabelText(/^Medication name/), 'Metformin');
      const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
      await user.clear(dateInput);
      await user.type(dateInput, '2026-06-15');
      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
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
      // CREATE copy: the backend does not record the med for today at all, so
      // the notice must not talk about reminders.
      expect(screen.getByText(CREATE_PAST_TIME_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText(EDIT_PAST_TIME_MESSAGE)).not.toBeInTheDocument();

      // Non-blocking: Continue proceeds with the save.
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.event_type).toBe('medication');
      expect(payload.scheduled_date).toBe('2026-06-15');
      // 10:00 Denver === 12:00 New York.
      expect(payload.scheduled_time).toBe('12:00');
    });

    it('cancelling the notice keeps the form open without saving', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await fillMedication('10:00');
      // Two Cancel buttons exist (form footer + notice) — scope to the notice.
      const notice = screen.getByRole('dialog', { name: 'Starts with the next dose' });
      await user.click(within(notice).getByRole('button', { name: 'Cancel' }));

      expect(mutateCreate).not.toHaveBeenCalled();
      // Form still open with the entered value.
      expect(screen.getByLabelText(/^Medication name/)).toHaveValue('Metformin');
    });

    it('EDITING a med onto a passed time keeps the reminder-focused copy', async () => {
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeEvent({
            id: 'med-3',
            event_type: 'medication',
            title: 'Metformin',
            medication_name: 'Metformin',
            scheduled_date: '2026-06-15',
            scheduled_time: '20:00:00',
          })}
          onClose={vi.fn()}
        />
      );

      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '10:00'); // 12:00 New York — already past.
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      // No roll on the edit path: the row stays on today, only the reminder is
      // lost — so the ORIGINAL copy, not the create-path "next dose" copy.
      expect(mutateUpdate).not.toHaveBeenCalled();
      expect(screen.getByText(EDIT_PAST_TIME_MESSAGE)).toBeInTheDocument();
      expect(screen.queryByText(CREATE_PAST_TIME_MESSAGE)).not.toBeInTheDocument();
      expect(
        screen.getByRole('dialog', { name: 'Time already passed' })
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      // The client never rolls the date — it sends what the user picked.
      expect(mutateUpdate.mock.calls[0][0].data.scheduled_date).toBe('2026-06-15');
      expect(mutateUpdate.mock.calls[0][0].data.scheduled_time).toBe('12:00');
    });

    it('saves a still-upcoming med time directly, with no notice', async () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await fillMedication('20:00'); // 22:00 New York — still upcoming there.

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(CREATE_PAST_TIME_MESSAGE)).not.toBeInTheDocument();
    });
  });

  describe('quick-pick chips (Round 3)', () => {
    it('appointment title chip fills the title, shows selected, and untaps to clear', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

      await user.click(screen.getByRole('radio', { name: 'Doctor visit' }));

      expect(screen.getByLabelText(/^Title( \* \(required\))?$/)).toHaveValue('Doctor visit');
      // Row stays visible with the matching chip checked (accidental-tap undo).
      const chip = screen.getByRole('radio', { name: 'Doctor visit' });
      expect(chip).toBeChecked();

      await user.click(chip);
      expect(screen.getByLabelText(/^Title( \* \(required\))?$/)).toHaveValue('');
      expect(screen.getByRole('radio', { name: 'Doctor visit' })).not.toBeChecked();
    });

    it('title chips surface the circle history (cached events) ahead of generics', () => {
      cachedEventsMock = [
        makeEvent({ id: 'h1', title: 'Cardiology follow-up', scheduled_date: '2026-06-10' }),
        makeEvent({ id: 'h2', title: 'cardiology follow-up', scheduled_date: '2026-06-20' }),
      ];
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

      const group = screen.getByRole('radiogroup', { name: 'Title suggestions' });
      const chips = within(group).getAllByRole('radio');
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
      expect(screen.getByLabelText(/^Title( \* \(required\))?$/)).toHaveValue('Grocery run');
      // The matching suggestion chip reads as selected (exact match).
      expect(screen.getByRole('radio', { name: 'Grocery run' })).toBeChecked();
    });

    it('scopes the chip rows: presets are medication-only, title chips are appt/task-only', () => {
      const { unmount } = render(
        <AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />
      );
      expect(
        screen.queryByRole('radiogroup', { name: 'Title suggestions' })
      ).not.toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'Common schedules' })).toBeInTheDocument();
      unmount();

      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
      expect(screen.queryByRole('radiogroup', { name: 'Common schedules' })).not.toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'Title suggestions' })).toBeInTheDocument();
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

      const group = screen.getByRole('radiogroup', { name: 'Common schedules' });
      const chip = within(group).getByRole('radio', { name: MORNING_CHIP });
      expect(chip).not.toBeChecked();

      await user.click(chip);

      expect(screen.getByLabelText(/^Time/)).toHaveValue('08:00');
      expect(screen.getByLabelText('Repeat')).toHaveValue('daily');
      expect(within(group).getByRole('radio', { name: MORNING_CHIP })).toBeChecked();
    });

    it('the evening preset sets 20:00 + daily; switching chips swaps the time', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      const group = screen.getByRole('radiogroup', { name: 'Common schedules' });

      await user.click(within(group).getByRole('radio', { name: 'Every evening (8:00 PM)' }));
      expect(screen.getByLabelText(/^Time/)).toHaveValue('20:00');
      expect(screen.getByLabelText('Repeat')).toHaveValue('daily');
      expect(within(group).getByRole('radio', { name: EVENING_CHIP })).toBeChecked();
      expect(within(group).getByRole('radio', { name: MORNING_CHIP })).not.toBeChecked();

      // Switching to the morning chip moves the whole schedule.
      await user.click(within(group).getByRole('radio', { name: MORNING_CHIP }));
      expect(screen.getByLabelText(/^Time/)).toHaveValue('08:00');
      expect(screen.getByLabelText('Repeat')).toHaveValue('daily');
      expect(within(group).getByRole('radio', { name: EVENING_CHIP })).not.toBeChecked();
    });

    it('untapping the selected preset returns time and recurrence to unset', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      const group = screen.getByRole('radiogroup', { name: 'Common schedules' });

      await user.click(within(group).getByRole('radio', { name: MORNING_CHIP }));
      expect(screen.getByLabelText(/^Time/)).toHaveValue('08:00');

      await user.click(within(group).getByRole('radio', { name: MORNING_CHIP }));

      expect(screen.getByLabelText(/^Time/)).toHaveValue('');
      expect(screen.getByLabelText('Repeat')).toHaveValue('none');
      expect(within(group).getByRole('radio', { name: MORNING_CHIP })).not.toBeChecked();
    });

    it('selected state requires the EXACT time + recurrence pair', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      const group = screen.getByRole('radiogroup', { name: 'Common schedules' });

      // 08:00 typed alone (no recurrence) is NOT the schedule preset.
      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '08:00');
      expect(within(group).getByRole('radio', { name: MORNING_CHIP })).not.toBeChecked();

      // Adding daily recurrence completes the exact match.
      await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
      expect(within(group).getByRole('radio', { name: MORNING_CHIP })).toBeChecked();
    });

    it('is prefill-only: the saved payload carries the preset time + daily rule', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText(/^Medication name/), 'Metformin');
      // A future date so the past-time notice can't interpose.
      const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
      await user.clear(dateInput);
      await user.type(dateInput, '2027-01-05');
      const group = screen.getByRole('radiogroup', { name: 'Common schedules' });
      await user.click(within(group).getByRole('radio', { name: MORNING_CHIP }));

      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.recurrence_rule).toBe('daily');
      // The "8:00 AM" preset means 8 AM on the CAREGIVER's clock — the same
      // frame every other time on this form is in — so it stores 10:00 for a
      // New York recipient. The live conversion hint is what shows the user
      // that, rather than leaving them to work it out.
      expect(payload.scheduled_time).toBe('10:00');
      expect(payload.scheduled_date).toBe('2027-01-05');
    });

    it('only renders for medications', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      expect(screen.queryByRole('radiogroup', { name: 'Common schedules' })).not.toBeInTheDocument();
    });

    it('the old "Common times" strip is gone — one chip strip in the med flow', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      expect(screen.queryByRole('radiogroup', { name: 'Common times' })).not.toBeInTheDocument();
      expect(screen.getByRole('radiogroup', { name: 'Common schedules' })).toBeInTheDocument();
      // And that consolidated strip carries both complete-schedule chips.
      const group = screen.getByRole('radiogroup', { name: 'Common schedules' });
      expect(within(group).getAllByRole('radio')).toHaveLength(2);
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

      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '14:00');

      expect(screen.getByText('Send reminders')).toBeInTheDocument();
    });

    it('always shows reminders for a medication', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      expect(screen.getByText('Send reminders')).toBeInTheDocument();
    });

    it('persists the task defaults on a timeless task — inert, not zeroed', async () => {
      // A timeless task's flags CANNOT fire: every reminder function filters
      // `scheduled_time IS NOT NULL`. This used to zero them anyway, which wrote
      // `reminder_at_due = false` onto the row — so a caregiver who later added a
      // time got a completely silent task, with no control on screen showing why.
      // Persisting the type's own defaults instead means adding a time later
      // behaves exactly like creating the task with one.
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Refill this week');
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.scheduled_time).toBeUndefined();
      // The two flags whose column default is TRUE, and the two the old zeroing
      // actually changed here.
      expect(payload.reminder_15m).toBe(true);
      expect(payload.reminder_at_due).toBe(true);
      // The three the user never opted into stay off — "preserve the selection"
      // is not "turn everything on".
      expect(payload.reminder_30m).toBe(false);
      expect(payload.reminder_1h).toBe(false);
      expect(payload.reminder_24h).toBe(false);
    });
  });

  // ── Reminder messaging (display only) ─────────────────────────────────────
  // Backend semantics are asymmetric: a medication notifies at the dose time
  // and escalates off notifications_enabled ALONE, while a task/appointment has
  // NO at-time push — its four reminder_* flags are the only notifications.
  // These assert the UI says so, and that saying so changes nothing that saves.
  describe('reminder messaging', () => {
    /** Give a task a time so the reminders fieldset renders at all. */
    async function setTaskTime(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '14:00');
    }

    it('shows the at-time anchor as a real switch, on, + escalation for a medication', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      // It used to be a locked statement of fact ("Always on for medications.").
      // `reminder_at_due` makes that sentence false — it is a control now.
      const anchor = screen.getByRole('switch', { name: 'At the scheduled time' });
      expect(anchor).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText("The main alert, sent when it's due.")).toBeInTheDocument();
      expect(screen.queryByText('Always on for medications.')).not.toBeInTheDocument();
      // The escalation chain hangs off notifications_enabled, and is medication-only.
      expect(
        screen.getByText(/we follow up: the care recipient after 15 minutes/)
      ).toBeInTheDocument();
    });

    it('shows the same at-time anchor for a task, without the medication escalation', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      // A task DOES get an at-time alert now — that is the whole feature. What
      // stays medication-only is the missed-dose escalation chain.
      const anchor = screen.getByRole('switch', { name: 'At the scheduled time' });
      expect(anchor).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('Earlier reminders')).toBeInTheDocument();
      expect(screen.queryByText(/we follow up: the care recipient/)).not.toBeInTheDocument();
    });

    it('warns only once the at-due anchor is switched OFF — the genuinely silent state', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      const anchor = screen.getByRole('switch', { name: 'At the scheduled time' });
      expect(
        screen.queryByText(/Nothing will be sent at the scheduled time/)
      ).not.toBeInTheDocument();

      await user.click(anchor);

      expect(anchor).toHaveAttribute('aria-checked', 'false');
      // Inside the switch's own description, so the consequence is announced
      // with the control rather than carried by color alone.
      const describedBy = anchor.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)).toContainElement(
        screen.getByText(/Nothing will be sent at the scheduled time/)
      );
      // Turning the anchor off must NOT drag the master down with it — the four
      // earlier reminders are still armed (15m is on for a fresh task).
      expect(screen.getByRole('switch', { name: 'Send reminders' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
    });

    it('warns about the missed-dose alert when a medication has reminders off', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      const master = screen.getByRole('switch', { name: 'Send reminders' });
      await user.click(master);

      const warning = screen.getByText(
        "No one will be notified when this dose is due, and no one will be alerted if it's missed."
      );
      // Not color-only: the consequence is inside the switch's own description.
      const describedBy = master.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)).toContainElement(warning);
      // Master off hides the earlier-reminders group entirely.
      expect(screen.queryByText('Earlier reminders')).not.toBeInTheDocument();
    });

    it('shows the neutral off note for a task with reminders off', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      await user.click(screen.getByRole('switch', { name: 'Send reminders' }));

      expect(screen.getByText('No one will be reminded about this — not you, and not anyone else in the circle.')).toBeInTheDocument();
      expect(
        screen.queryByText(/No one will be notified when this dose is due/)
      ).not.toBeInTheDocument();
    });

    // ── Two-way sync of the master toggle with the four boxes (task/appt only).
    // "Master on + all four off" is a lie for these types: they have no at-time
    // notification, so nothing would ever fire. See nextReminderControlState.

    it('rule 2 does NOT fire while the at-due anchor is armed', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      const master = screen.getByRole('switch', { name: 'Send reminders' });
      const fifteen = screen.getByRole('switch', { name: '15 minutes before' });
      expect(master).toHaveAttribute('aria-checked', 'true');
      expect(fifteen).toHaveAttribute('aria-checked', 'true');

      await user.click(fifteen);

      // This used to take the master down with it, because "no earlier
      // reminders" meant "silent". It no longer does: the anchor still fires at
      // the scheduled time, and flipping the master would discard an alert the
      // user never asked to lose.
      expect(master).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('switch', { name: 'At the scheduled time' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('group', { name: 'Earlier reminders' })).toBeInTheDocument();
      // Not silent, so no warning.
      expect(
        screen.queryByText('Select at least one time, or no reminder will be sent.')
      ).not.toBeInTheDocument();
    });

    it('rule 2 — unchecking the LAST earlier reminder with the anchor OFF switches the master off', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      const master = screen.getByRole('switch', { name: 'Send reminders' });
      // Real silence needs the anchor off FIRST; only then is "no earlier
      // reminders" the same statement as "master off".
      await user.click(screen.getByRole('switch', { name: 'At the scheduled time' }));
      expect(master).toHaveAttribute('aria-checked', 'true');

      await user.click(screen.getByRole('switch', { name: '15 minutes before' }));

      expect(master).toHaveAttribute('aria-checked', 'false');
      // Master off collapses the group, so the honest-state copy is the off note.
      expect(screen.queryByRole('group', { name: 'Earlier reminders' })).not.toBeInTheDocument();
      expect(screen.getByText('No one will be reminded about this — not you, and not anyone else in the circle.')).toBeInTheDocument();
    });

    it('rule 2 does NOT fire while another earlier reminder is still checked', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      await user.click(screen.getByRole('switch', { name: '24 hours before' }));
      await user.click(screen.getByRole('switch', { name: '15 minutes before' }));

      expect(screen.getByRole('switch', { name: 'Send reminders' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('switch', { name: '24 hours before' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
    });

    it('rule 1 — turning the master back on with nothing selected restores the 15m default', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      // Reach real silence: the anchor off, THEN the only box unchecked. Rule 2
      // takes the master down only once nothing is left to fire.
      await user.click(screen.getByRole('switch', { name: 'At the scheduled time' }));
      await user.click(screen.getByRole('switch', { name: '15 minutes before' }));
      const master = screen.getByRole('switch', { name: 'Send reminders' });
      expect(master).toHaveAttribute('aria-checked', 'false');

      await user.click(master);

      // 15m is the fresh-event default, so this restores it rather than
      // inventing a reminder time the user never picked.
      expect(master).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('switch', { name: '15 minutes before' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(
        screen.queryByText('Select at least one time, or no reminder will be sent.')
      ).not.toBeInTheDocument();
    });

    /**
     * RULE 1 IS GATED ON THE ANCHOR, exactly as rule 2 is.
     *
     * The two rules share ONE premise — "no earlier reminders" means "nothing
     * fires" — and `reminder_at_due` falsified it for both. Gating only rule 2
     * left the master toggle able to INVENT a reminder on the way back up: the
     * state below (anchor armed, all four earlier boxes off) is the state rule 2
     * now deliberately produces, and an off→on cycle of the master used to
     * re-check "15 minutes before" from it — silently restoring the very box the
     * user had unchecked two clicks earlier.
     *
     * `reminderFlagsForSave` saves the selection verbatim, so that re-check goes
     * straight to the wire: an off→on cycle of a toggle that is supposed to mean
     * "mute / unmute" would ship a 15-minute-early push nobody asked for.
     */
    it('rule 1 does NOT fire while the at-due anchor is armed', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      // Reach "anchor on, all four earlier off" — the state rule 2 now leaves
      // behind when the last earlier reminder is unchecked.
      await user.click(screen.getByRole('switch', { name: '15 minutes before' }));
      const master = screen.getByRole('switch', { name: 'Send reminders' });
      expect(master).toHaveAttribute('aria-checked', 'true');

      await user.click(master);
      expect(master).toHaveAttribute('aria-checked', 'false');
      await user.click(master);
      expect(master).toHaveAttribute('aria-checked', 'true');

      // Nothing was invented: the anchor still carries the entry, and the box
      // the user unchecked stays unchecked.
      expect(screen.getByRole('switch', { name: 'At the scheduled time' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      for (const name of [
        '24 hours before',
        '1 hour before',
        '30 minutes before',
        '15 minutes before',
      ]) {
        expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
      }
      // Not silent — the anchor fires — so no warning either.
      expect(
        screen.queryByText('Select at least one time, or no reminder will be sent.')
      ).not.toBeInTheDocument();
    });

    it('a master off→on cycle with the anchor armed saves the selection unchanged', async () => {
      // The wire half of the test above. `reminderFlagsForSave` is verbatim now,
      // so anything rule 1 invents is persisted.
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Refill the water jug');
      await setTaskTime(user);
      await user.click(screen.getByRole('switch', { name: '15 minutes before' }));
      const master = screen.getByRole('switch', { name: 'Send reminders' });
      await user.click(master);
      await user.click(master);
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.notifications_enabled).toBe(true);
      expect(payload.reminder_at_due).toBe(true);
      expect(payload.reminder_15m).toBe(false);
      expect(payload.reminder_30m).toBe(false);
      expect(payload.reminder_1h).toBe(false);
      expect(payload.reminder_24h).toBe(false);
    });

    it('rule 3 — a manual off then on restores the previous selection, not the default', async () => {
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeReminderEvent(
            { event_type: 'task', duration_minutes: 30 },
            { notifications_enabled: true, reminder_24h: true, reminder_15m: false }
          )}
          onClose={vi.fn()}
        />
      );

      const master = screen.getByRole('switch', { name: 'Send reminders' });
      await user.click(master);
      expect(master).toHaveAttribute('aria-checked', 'false');

      await user.click(master);

      // The four values were never cleared, so rule 1 cannot fire and the
      // user's 24h choice comes back exactly as it was.
      expect(screen.getByRole('switch', { name: '24 hours before' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('switch', { name: '15 minutes before' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
    });

    it('sends the at-due anchor ON for an ordinary timed task nobody touched', async () => {
      // The default path, and the one an omitted key would break QUIETLY: the
      // column default is TRUE, so a payload missing `reminder_at_due` still
      // produces the right row on CREATE and silently keeps the old value on a
      // partial-patch UPDATE. Only an explicit `true` proves the control is
      // actually wired through to the API.
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Pick up prescription');
      await setTaskTime(user);
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.reminder_at_due).toBe(true);
      expect(payload.notifications_enabled).toBe(true);
    });

    /**
     * THE ANCHOR OFF WHILE EVERYTHING ELSE STAYS ON — the one state that proves
     * the switch reaches the wire.
     *
     * `reminderFlagsForSave` no longer rewrites anything, so the ONLY way a
     * `reminder_at_due: false` reaches a payload is a control the user touched.
     * That was not always so: it used to zero the whole set on master-off or a
     * missing scheduled_time, and every other `false` in this file came from
     * there — none of them could tell "the user switched the anchor off" apart
     * from "the anchor was never sent", and hardwiring the payload field to a
     * literal `true` left the entire suite green.
     *
     * Here the master stays ON and 15m stays checked — rule 2 deliberately does
     * not fire for the anchor itself — so the only thing that can make this
     * `false` is the control the user actually touched. Silently re-arming it
     * would send a push at the exact moment the user asked for silence.
     */
    it('saves the anchor OFF while the rest of the entry stays on', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Call the pharmacy');
      await setTaskTime(user);
      await user.click(screen.getByRole('switch', { name: 'At the scheduled time' }));
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.reminder_at_due).toBe(false);
      // The state that makes the assertion above meaningful: nothing else was
      // switched off, so nothing else could have zeroed the set.
      expect(payload.notifications_enabled).toBe(true);
      expect(payload.reminder_15m).toBe(true);
    });

    it('a task turned fully off saves nothing on — the sync never re-arms a flag', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Water the plants');
      await setTaskTime(user);
      // Anchor off first, then the last box — rule 2 then takes the master down.
      await user.click(screen.getByRole('switch', { name: 'At the scheduled time' }));
      await user.click(screen.getByRole('switch', { name: '15 minutes before' }));
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.notifications_enabled).toBe(false);
      // `reminder_at_due` is NOT NULL DEFAULT TRUE — omitting it would have the
      // row come back with the one alert the user just switched off.
      expect(payload.reminder_at_due).toBe(false);
      expect(payload.reminder_15m).toBe(false);
      expect(payload.reminder_30m).toBe(false);
      expect(payload.reminder_1h).toBe(false);
      expect(payload.reminder_24h).toBe(false);
    });

    // ── Medication is NEVER coupled: notifications_enabled alone drives the
    // at-dose-time push and the escalation chain, so the four boxes are genuinely
    // optional extras and linking them would either invent a pre-reminder or
    // silence the missed-dose alerts.

    it('medication — unchecking the last earlier reminder leaves the master ON (rule 2 skipped)', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      // 15m now starts OFF for medications — the at-time push and escalation
      // chain already cover them, so pre-selecting it only doubled the pushes.
      // Turn it ON first so this still exercises what it is named for:
      // unchecking the LAST earlier reminder must not flip the master off.
      const fifteenMed = screen.getByRole('switch', { name: '15 minutes before' });
      expect(fifteenMed).toHaveAttribute('aria-checked', 'false');
      await user.click(fifteenMed);
      expect(fifteenMed).toHaveAttribute('aria-checked', 'true');

      await user.click(fifteenMed);

      expect(screen.getByRole('switch', { name: 'Send reminders' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('switch', { name: '15 minutes before' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
      // The dose-time push and escalation chain are unaffected.
      expect(screen.getByText('At the scheduled time')).toBeInTheDocument();
    });

    it('medication — turning the master on with nothing selected checks NOTHING (rule 1 skipped)', async () => {
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeReminderEvent(
            { event_type: 'medication', medication_name: 'Lisinopril' },
            { notifications_enabled: false, reminder_15m: false }
          )}
          onClose={vi.fn()}
        />
      );

      await user.click(screen.getByRole('switch', { name: 'Send reminders' }));

      for (const name of [
        '24 hours before',
        '1 hour before',
        '30 minutes before',
        '15 minutes before',
      ]) {
        expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
      }
    });

    it('medication — a manual off then on leaves the four flags exactly as they were (rule 3 parity)', async () => {
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeReminderEvent(
            { event_type: 'medication', medication_name: 'Lisinopril' },
            { notifications_enabled: true, reminder_1h: true, reminder_15m: false }
          )}
          onClose={vi.fn()}
        />
      );

      const master = screen.getByRole('switch', { name: 'Send reminders' });
      await user.click(master);
      await user.click(master);

      expect(screen.getByRole('switch', { name: '1 hour before' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('switch', { name: '15 minutes before' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
    });

    it('a LEGACY task with all four flags off is NOT silent — the anchor hydrates ON', async () => {
      // This row was written before `reminder_at_due` existed, so the response
      // simply omits the key. The column is NOT NULL DEFAULT TRUE, so the server
      // WILL send the at-time alert: hydrating the switch to off would show a
      // state the backend disagrees with, and an untouched Save would then write
      // that disagreement back as fact.
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeReminderEvent(
            { event_type: 'task', duration_minutes: 30 },
            {
              notifications_enabled: true,
              reminder_24h: false,
              reminder_1h: false,
              reminder_30m: false,
              reminder_15m: false,
            }
          )}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByRole('switch', { name: 'At the scheduled time' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      // The old "you have selected nothing, this will be silent" warning would
      // now be crying wolf — the entry alerts at its scheduled time.
      expect(
        screen.queryByText('Select at least one time, or no reminder will be sent.')
      ).not.toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'Earlier reminders' })).not.toHaveAttribute(
        'aria-describedby'
      );
    });

    it('an explicit at-due opt-out with nothing else on hydrates into the warning, NOT auto-corrected', async () => {
      // The companion state: the user deliberately turned the anchor off and has
      // no earlier reminders either. That IS silence, and it is the only way to
      // reach it. Auto-fixing on hydrate would silently mutate an entry the user
      // never touched, so the warning is the safety net.
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeReminderEvent(
            { event_type: 'task', duration_minutes: 30 },
            {
              notifications_enabled: true,
              reminder_at_due: false,
              reminder_24h: false,
              reminder_1h: false,
              reminder_30m: false,
              reminder_15m: false,
            }
          )}
          onClose={vi.fn()}
        />
      );

      const warning = screen.getByText('Select at least one time, or no reminder will be sent.');
      const group = screen.getByRole('group', { name: 'Earlier reminders' });
      expect(group).toHaveAttribute('aria-describedby', warning.id);
      // Nothing was flipped for the user: the state is reported, not repaired.
      expect(screen.getByRole('switch', { name: 'Send reminders' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('switch', { name: 'At the scheduled time' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
      for (const name of [
        '24 hours before',
        '1 hour before',
        '30 minutes before',
        '15 minutes before',
      ]) {
        expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false');
      }
    });

    it('never shows the none-selected warning for a medication (baseline still fires)', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await user.click(screen.getByRole('switch', { name: '15 minutes before' }));

      expect(
        screen.queryByText('Select at least one time, or no reminder will be sent.')
      ).not.toBeInTheDocument();
      expect(screen.getByText('At the scheduled time')).toBeInTheDocument();
    });

    it('saves exactly the chosen flags — the messaging changes no payload', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Water the plants');
      await setTaskTime(user);
      // Swap the default 15m for 24h — one box stays checked throughout, so the
      // master is never taken down and the payload is purely the user's choice.
      await user.click(screen.getByRole('switch', { name: '24 hours before' }));
      await user.click(screen.getByRole('switch', { name: '15 minutes before' }));
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.notifications_enabled).toBe(true);
      expect(payload.reminder_24h).toBe(true);
      expect(payload.reminder_15m).toBe(false);
      expect(payload.reminder_30m).toBe(false);
      expect(payload.reminder_1h).toBe(false);
    });
  });

  describe('duration presets', () => {
    it('prefills a 30-minute end time when a start time is picked', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '14:00');

      expect(screen.getByLabelText(/^End time/)).toHaveValue('14:30');
    });

    it('a duration chip sets the end time', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '14:00');

      const group = screen.getByRole('radiogroup', { name: 'Duration' });
      await user.click(within(group).getByRole('radio', { name: '2 hrs' }));

      expect(screen.getByLabelText(/^End time/)).toHaveValue('16:00');
    });

    it('offers no duration chips before a start time exists', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
      expect(screen.queryByRole('radiogroup', { name: 'Duration' })).not.toBeInTheDocument();
    });

    it('offers no duration chips for medications', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);
      expect(screen.queryByRole('radiogroup', { name: 'Duration' })).not.toBeInTheDocument();
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

/**
 * The "15 minutes before" DEFAULT is medication-asymmetric, matching mobile.
 *
 * A medication with notifications_enabled already fires at the dose time AND
 * runs the escalation chain — verified in the SQL, which references
 * notifications_enabled and never the four reminder_* flags. Pre-selecting 15m
 * there doubles the pushes for a reminder the baseline already covers. A
 * task/appointment has NO at-time notification, so those four ARE the
 * notifications and defaulting off would ship a silent event.
 */
describe('AddEventModal — the 15-minute default', () => {
  const defaultFor = (eventType: string, stored?: boolean): boolean =>
    stored ?? eventType !== 'medication';

  it('is OFF for a new medication', () => {
    expect(defaultFor('medication')).toBe(false);
  });

  it.each(['appointment', 'task'])('is ON for a new %s', (type) => {
    expect(defaultFor(type)).toBe(true);
  });

  /**
   * `?? ` not `||`. A medication the user deliberately ticked, or a task they
   * deliberately unticked, must survive hydration — coalescing on falsiness
   * would silently re-enable every stored `false`.
   */
  it('respects an explicitly stored value over the default, in both directions', () => {
    expect(defaultFor('medication', true)).toBe(true);
    expect(defaultFor('appointment', false)).toBe(false);
  });

  // ── The zone NAMES on the dual-timezone strip ─────────────────────────────
  //
  // Both the field label and the live conversion line used to name a zone with
  // a hand-written abbreviation ("MT", "ET"). Those strings could not be
  // sourced for anywhere outside the US — the table fell through to Intl's
  // short name, which is an OFFSET for most of the world ("GMT+2" for Berlin) —
  // so a zone is now named by its city, the way Apple's Clock and Settings name
  // it. The viewer is America/Denver and the recipient America/New_York here.

  describe('zone names on the dual-timezone strip', () => {
    it('labels the time field with the recipient’s CITY', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      expect(screen.getByText(/Your time \/ .*New York/)).toBeInTheDocument();
    });

    it('names both cities in the live conversion line', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '20:00');

      // 8 PM in Denver is 10 PM in New York, same day.
      expect(await screen.findByText('8:00 PM Denver = 10:00 PM New York')).toBeInTheDocument();
    });

    it('never shows an abbreviation or a GMT offset', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '20:00');

      const line = await screen.findByText(/=/);
      expect(line.textContent).not.toMatch(/\bMT\b|\bET\b|GMT/);
    });
  });

});

describe('AddEventModal RxNorm lookup (mobile parity)', () => {
  it('sends the picked drug\'s rxcui, and drops it once the name is hand-edited', async () => {
    const { searchDrugs } = await import('@/api/drugs');
    vi.mocked(searchDrugs).mockResolvedValue([
      { rxcui: '6809', name: 'Metformin', strength: null, dosageForm: null },
    ]);
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

    const name = screen.getByRole('combobox', { name: /^Medication name/ });
    await user.type(name, 'metf');
    await user.click(await screen.findByRole('option', { name: 'Metformin' }));
    expect(name).toHaveValue('Metformin');

    // A far-future date, so the past-time confirm never intervenes.
    const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
    await user.clear(dateInput);
    await user.type(dateInput, '2099-01-01');
    const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
    await user.clear(timeInput);
    await user.type(timeInput, '09:00');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ medication_name: 'Metformin', rxcui: '6809' });
  });

  it('sends no rxcui for a typed name', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

    await user.type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
    const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
    await user.clear(dateInput);
    await user.type(dateInput, '2099-01-01');
    const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
    await user.clear(timeInput);
    await user.type(timeInput, '09:00');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).not.toHaveProperty('rxcui');
  });
});
