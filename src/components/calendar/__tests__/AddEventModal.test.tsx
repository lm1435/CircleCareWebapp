import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { neverSettles, submitFormTwice } from '@/test/doubleSubmit';
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
// The quiet-hours note reads the current user over React Query; these suites have no
// QueryClient and are not about it (see DoseQuietHoursNote.test.tsx).
vi.mock('../DoseQuietHoursNote', () => ({ DoseQuietHoursNote: () => null }));
vi.mock('@/api/drugs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/drugs')>();
  return { ...actual, searchDrugs: vi.fn().mockResolvedValue([]) };
});

vi.mock('@/hooks/useCalendarEvents', () => ({
  useCreateEvent: () => ({ mutateAsync: mutateCreate, isPending: false }),
  useUpdateEvent: () => ({ mutateAsync: mutateUpdate, isPending: false }),
  useCachedCircleEvents: () => cachedEventsMock,
}));

// Series-root resolution (hooks/useSeriesRoot) runs a React Query fetch, and
// this file mounts no QueryClient — so it is replaced by its contract: the
// event itself when it IS a root, and for an occurrence whatever
// `seriesRootOverride` says (`{ root: undefined }` = still resolving), else a
// root on the occurrence's own date (the pre-hook behavior, so every existing
// occurrence case below keeps its meaning). The real resolution order is
// pinned in hooks/__tests__/useSeriesRoot.test.tsx.
//
// STABLE IDENTITY per event, like the real hook's (a cached row or
// `query.data`): the form's hydration effects key on the root object, and a
// fresh object every render would re-hydrate forever.
let seriesRootOverride: { root: Partial<CalendarEvent> | null | undefined } | null = null;
const derivedRoots = new WeakMap<CalendarEvent, { root: CalendarEvent }>();
vi.mock('@/hooks/useSeriesRoot', () => ({
  useSeriesRoot: (_circleId: string, event: CalendarEvent | null | undefined) => {
    if (!event) return { root: null };
    if (!event.parent_event_id) return { root: event };
    if (seriesRootOverride) return seriesRootOverride;
    let derived = derivedRoots.get(event);
    if (!derived) {
      derived = { root: { ...event, id: event.parent_event_id, parent_event_id: null } };
      derivedRoots.set(event, derived);
    }
    return derived;
  },
}));

const useCircleResult = {
  circle: undefined as { recipient_name?: string; is_self_care?: boolean } | undefined,
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
  // Reset between tests: a self-care circle set by one case must not leak into
  // the next, where the escalation copy would silently change under it.
  useCircleResult.circle = undefined;
  cachedEventsMock = [];
  seriesRootOverride = null;
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

    it('a TYPE switch never checks 15m — the task that used to arrive pre-armed', async () => {
      // The global Create menu opens with NO initialType, so eventType starts
      // 'medication'. Switching to Task used to re-apply a task-specific
      // default and tick "15 minutes before" on the user's behalf, on the
      // (since falsified) grounds that a task had no at-time push. It has one:
      // reminder_at_due is a real column and process_task_reminders() reads it
      // for task/appointment. So the entry speaks once, when it is due, and the
      // early push nobody asked for is gone.
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

      expect(screen.getByRole('checkbox', { name: '15 minutes before' })).toHaveAttribute(
        'aria-checked',
        'false'
      );

      await user.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));

      const payload = mutateCreate.mock.calls[0][0];
      expect(payload.event_type).toBe('task');
      expect(payload.notifications_enabled).toBe(true);
      expect(payload.reminder_15m).toBe(false);
      // Not silent: this is the flag that carries a task now.
      expect(payload.reminder_at_due).toBe(true);
    });

    it('does not re-apply the default over a choice the user made', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Pick up prescription');
      const timeField = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeField);
      await user.type(timeField, '09:00');

      // Explicitly turn 15m ON, then switch type and back. The switcher must not
      // reset it: `remindersTouched` records that the user has spoken.
      await user.click(screen.getByLabelText('15 minutes before'));
      await user.selectOptions(screen.getByLabelText('Type'), 'appointment');

      await user.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      expect(mutateCreate.mock.calls[0][0].reminder_15m).toBe(true);
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
          'Reminders are delivered to the CircleCare mobile app.'
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

    it('SAVES a span that crosses midnight, counted the way mobile counts it (PK21)', async () => {
      // Was a refusal while web compared clock minutes. Mobile reads an end at
      // or before the start as the NEXT day (`resolveEndTime`), so the two apps
      // now agree: 23:00 NY hydrates to 21:00 MT; +240 rolls to 01:00 = 240 min.
      const user = userEvent.setup();
      const stored = makeEvent({
        event_type: 'appointment',
        title: 'Night shift handover',
        scheduled_date: '2026-06-15',
        scheduled_time: '23:00:00',
        duration_minutes: 240,
      });

      render(<AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />);
      expect((screen.getByLabelText(/^End time/) as HTMLInputElement).value).toBe('01:00');

      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      expect(mutateUpdate.mock.calls[0][0].data.duration_minutes).toBe(240);
      expect(screen.getByLabelText(/^End time/)).not.toHaveAttribute('aria-invalid', 'true');
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

    /**
     * THE NOTICE'S Continue IS A SUBMIT, AND IT HAS TO BE GUARDED LIKE ONE.
     *
     * `ConfirmDialog` wraps `onConfirm` in `useGuardedSubmit` and AWAITS what
     * it returns — that is documented on the shell, and it is the only way the
     * guard can be held for longer than the tick the click happened in. This
     * call site returned nothing (`void persist(data)`), so the ref was
     * released on the very next microtask while the create was still in
     * flight, and the guard covered the synchronous window only. What gets
     * through that gap is the failure the form's own guard is commented for:
     * TWO medication series for one drug, each with its own reminder schedule
     * and its own dose-confirmation stream, doubling the denominator of the
     * adherence figure the clinician-facing report is built from.
     *
     * A microtask turn between the two clicks, not two synchronous dispatches:
     * the synchronous pair is blocked either way (nothing runs between them to
     * release the ref), so a test built that way passes over the defect. The
     * turn is what the awaited promise is supposed to survive.
     */
    it('creates ONE series when Continue is double-clicked mid-save', async () => {
      // Never settles: the request is still in flight when the second click
      // arrives, which is the only state in which holding the guard means
      // anything.
      mutateCreate.mockImplementation(() => neverSettles());
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await fillMedication('10:00');
      const confirm = screen.getByRole('button', { name: 'Continue' });

      await act(async () => {
        confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        confirm.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });

      expect(mutateCreate).toHaveBeenCalledTimes(1);
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
      // The anchor is the flag whose column default is TRUE and the one the old
      // zeroing actually changed here. It must be sent as an explicit `true`.
      expect(payload.reminder_at_due).toBe(true);
      // The four the user never opted into stay off — "preserve the selection"
      // is not "turn everything on", and `reminder_15m` is now one of them for
      // every type (its column default is TRUE, so the explicit false matters).
      expect(payload.reminder_15m).toBe(false);
      expect(payload.reminder_30m).toBe(false);
      expect(payload.reminder_1h).toBe(false);
      expect(payload.reminder_24h).toBe(false);
    });
  });

  // ── Reminder messaging (display only) ─────────────────────────────────────
  // Backend semantics are asymmetric: a medication notifies at the dose time and
  // escalates off notifications_enabled ALONE, while a task/appointment gets its
  // at-time alert from reminder_at_due and has no escalation chain. What both
  // now share is that they DO speak at the scheduled time — which is why no
  // earlier reminder is pre-selected for either.
  // These assert the UI says so, and that saying so changes nothing that saves.
  describe('reminder messaging', () => {
    /** Give a task a time so the reminders fieldset renders at all. */
    async function setTaskTime(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '14:00');
    }

    it('shows the at-time anchor as a real checkbox, on, + escalation for a medication', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      // It used to be a locked statement of fact ("Always on for medications.").
      // `reminder_at_due` makes that sentence false — it is a control now, and a
      // CHECKBOX rather than a switch: the one switch here is the master, and
      // everything under it picks WHICH alerts, exactly as mobile splits them.
      const anchor = screen.getByRole('checkbox', { name: 'At the scheduled time' });
      expect(anchor).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText("The main alert, sent when it's due.")).toBeInTheDocument();
      expect(screen.queryByText('Always on for medications.')).not.toBeInTheDocument();
      // The escalation chain hangs off notifications_enabled, and is medication-only.
      expect(
        screen.getByText(/we follow up: the care recipient after 15 minutes/)
      ).toBeInTheDocument();
    });

    it('names the reader, not "the care recipient", on a self-care circle', () => {
      // The one place in the webapp that was still blind to `is_self_care`.
      // Mobile has branched this line since the escalation chain shipped.
      useCircleResult.circle = { is_self_care: true };
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      expect(screen.getByText(/we follow up: you after 15 minutes/)).toBeInTheDocument();
      expect(
        screen.queryByText(/we follow up: the care recipient/)
      ).not.toBeInTheDocument();
    });

    it('keeps "the care recipient" when the circle is not self-care', () => {
      // FALSIFY BY: dropping the ternary and always rendering `escalationSelf`.
      useCircleResult.circle = { is_self_care: false };
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      expect(
        screen.getByText(/we follow up: the care recipient after 15 minutes/)
      ).toBeInTheDocument();
    });

    it('tells a medication with the anchor off and nothing earlier that the first alert is the LATE one', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      const anchor = screen.getByRole('checkbox', { name: 'At the scheduled time' });
      await user.click(anchor);

      // `atTimeOff` would point at "the earlier reminders you pick below" with
      // none picked. A medication never reaches `showNoneSelectedWarning`
      // (that is `!isMedication`, and correctly so — the escalation chain still
      // fires), so without this the state had no honest description at all.
      expect(anchor).toHaveAttribute('aria-checked', 'false');
      expect(
        screen.getByText(/the first alert would be the follow-up that it hasn't been marked yet/)
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/only the earlier reminders you pick below/)
      ).not.toBeInTheDocument();
      // Still inside the anchor's own description — not carried by color.
      const describedBy = anchor.getAttribute('aria-describedby');
      expect(document.getElementById(describedBy as string)).toContainElement(
        screen.getByText(/the first alert would be the follow-up that it hasn't been marked yet/)
      );
    });

    it('reverts to the ordinary off-notice once an earlier reminder is picked', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await user.click(screen.getByRole('checkbox', { name: 'At the scheduled time' }));
      await user.click(screen.getByRole('checkbox', { name: '1 hour before' }));

      expect(
        screen.getByText(/only the earlier reminders you pick below/)
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/the first alert would be the follow-up that it hasn't been marked yet/)
      ).not.toBeInTheDocument();
    });

    it('shows the same at-time anchor for a task, without the medication escalation', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      // A task DOES get an at-time alert now — that is the whole feature. What
      // stays medication-only is the missed-dose escalation chain.
      const anchor = screen.getByRole('checkbox', { name: 'At the scheduled time' });
      expect(anchor).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByText('Earlier reminders')).toBeInTheDocument();
      expect(screen.queryByText(/we follow up: the care recipient/)).not.toBeInTheDocument();
    });

    it('warns only once the at-due anchor is switched OFF — the genuinely silent state', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      const anchor = screen.getByRole('checkbox', { name: 'At the scheduled time' });
      expect(
        screen.queryByText(/Nothing will be sent at the scheduled time/)
      ).not.toBeInTheDocument();

      await user.click(anchor);

      expect(anchor).toHaveAttribute('aria-checked', 'false');
      // Inside the checkbox's own description, so the consequence is announced
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
        "No one will be notified when this dose is due, and no one will be alerted if it hasn't been marked."
      );
      // Not color-only: the consequence is inside the switch's own description.
      const describedBy = master.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)).toContainElement(warning);
      // Master off hides the earlier-reminders group entirely.
      expect(screen.queryByText('Earlier reminders')).not.toBeInTheDocument();
    });

    it('keeps the legend naming the fieldset, with the explainer trigger outside it', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      // FALSIFY BY: wrapping the `<legend>` in a flex row with the button. A
      // legend that is not the fieldset's first child stops naming the group,
      // and nesting the button inside it instead appends "How notifications
      // work" to the name every control in the fieldset inherits.
      expect(screen.getByRole('group', { name: 'Reminders' })).toBeInTheDocument();
      expect(
        screen.queryByRole('group', { name: /How notifications work/ })
      ).not.toBeInTheDocument();
    });

    it('opens the "How notifications work" explainer, escalation section included', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'How notifications work' }));

      const dialog = screen.getByRole('dialog', { name: 'How notifications work' });
      expect(dialog).toBeInTheDocument();
      // Reworded for web on purpose: mobile promises "You'll receive a
      // notification", which contradicts this section's own "the web app cannot
      // send them" a few lines above.
      expect(
        within(dialog).getByText('A notification is sent at the scheduled time, to the CircleCare mobile app.')
      ).toBeInTheDocument();
      expect(within(dialog).getByText('Escalation alerts')).toBeInTheDocument();
      expect(within(dialog).getByText('Early reminders')).toBeInTheDocument();
    });

    it('omits the escalation section of the explainer for a task', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      await user.click(screen.getByRole('button', { name: 'How notifications work' }));

      const dialog = screen.getByRole('dialog', { name: 'How notifications work' });
      // There is no missed-dose chain for a task, so there is nothing to explain.
      expect(within(dialog).queryByText('Escalation alerts')).not.toBeInTheDocument();
      expect(within(dialog).getByText('Scheduled reminders')).toBeInTheDocument();
    });

    it('carries the self-care wording into the explainer too', async () => {
      // One sentence, one place to keep true: the explainer reuses the inline
      // escalation string rather than holding a second copy of it, which is how
      // mobile's now-dead `escalationInfo` drifted to 15 min / 1 hr / 2 hrs.
      useCircleResult.circle = { is_self_care: true };
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'How notifications work' }));

      const dialog = screen.getByRole('dialog', { name: 'How notifications work' });
      expect(
        within(dialog).getByText(/we follow up: you after 15 minutes/)
      ).toBeInTheDocument();
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

    // ── One-way sync of the four boxes with the master toggle (task/appt only).
    // The boxes can take the master down (rule 2, and only into real silence);
    // the master never touches a box (rule 1 is gone). See
    // nextReminderControlState.

    it('rule 2 does NOT fire while the at-due anchor is armed', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      const master = screen.getByRole('switch', { name: 'Send reminders' });
      const fifteen = screen.getByRole('checkbox', { name: '15 minutes before' });
      expect(master).toHaveAttribute('aria-checked', 'true');
      // Nothing in "Earlier reminders" is pre-selected any more, so this test
      // has to ARM the box it is about to take away.
      expect(fifteen).toHaveAttribute('aria-checked', 'false');
      await user.click(fifteen);
      expect(fifteen).toHaveAttribute('aria-checked', 'true');

      await user.click(fifteen);

      // This used to take the master down with it, because "no earlier
      // reminders" meant "silent". It no longer does: the anchor still fires at
      // the scheduled time, and flipping the master would discard an alert the
      // user never asked to lose.
      expect(master).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('checkbox', { name: 'At the scheduled time' })).toHaveAttribute(
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
      // Arm 15m first — it is no longer pre-selected — then reach real silence:
      // the anchor off, and only then is "no earlier reminders" the same
      // statement as "master off".
      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));
      await user.click(screen.getByRole('checkbox', { name: 'At the scheduled time' }));
      expect(master).toHaveAttribute('aria-checked', 'true');

      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));

      expect(master).toHaveAttribute('aria-checked', 'false');
      // Master off collapses the group, so the honest-state copy is the off note.
      expect(screen.queryByRole('group', { name: 'Earlier reminders' })).not.toBeInTheDocument();
      expect(screen.getByText('No one will be reminded about this — not you, and not anyone else in the circle.')).toBeInTheDocument();
    });

    it('rule 2 does NOT fire while another earlier reminder is still checked', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      // Two boxes on, then one back off: the master must not follow it down
      // while another earlier reminder is still armed.
      await user.click(screen.getByRole('checkbox', { name: '24 hours before' }));
      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));
      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));

      expect(screen.getByRole('switch', { name: 'Send reminders' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('checkbox', { name: '24 hours before' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
    });

    it('rule 1 is GONE — the master back on with nothing selected checks NOTHING', async () => {
      // This used to re-check "15 minutes before" on the way back up, on the
      // grounds that a master reading "on" over an entry that cannot speak is a
      // lie. It is — but the fix is to SAY SO, not to tick a box the user never
      // tapped. `showNoneSelectedWarning` covers exactly this state, and it is
      // already the only thing standing behind the same state on the edit form,
      // which must not auto-correct a hydrated row.
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      // Reach real silence: 15m armed, the anchor off, THEN the only box
      // unchecked. Rule 2 takes the master down once nothing is left to fire.
      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));
      await user.click(screen.getByRole('checkbox', { name: 'At the scheduled time' }));
      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));
      const master = screen.getByRole('switch', { name: 'Send reminders' });
      expect(master).toHaveAttribute('aria-checked', 'false');

      await user.click(master);

      expect(master).toHaveAttribute('aria-checked', 'true');
      for (const name of [
        '24 hours before',
        '1 hour before',
        '30 minutes before',
        '15 minutes before',
      ]) {
        expect(screen.getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'false');
      }
      // The anchor is still off, so this state IS silent — and the user is told
      // rather than quietly corrected.
      expect(screen.getByRole('checkbox', { name: 'At the scheduled time' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
      expect(
        screen.getByText('Select at least one time, or no reminder will be sent.')
      ).toBeInTheDocument();
    });

    /**
     * THE MUTE BUTTON IS A MUTE BUTTON.
     *
     * "Anchor armed, all four earlier boxes off" is now the DEFAULT state of a
     * fresh task, and it is also the state rule 2 leaves behind when the last
     * earlier reminder is unchecked. An off→on cycle of the master used to
     * re-check "15 minutes before" from it — silently arming an early push on an
     * entry the user had only muted and unmuted.
     *
     * `reminderFlagsForSave` saves the selection verbatim, so that re-check went
     * straight to the wire: a toggle that is supposed to mean "mute / unmute"
     * shipped a 15-minute-early push nobody asked for.
     */
    it('a master off→on cycle invents nothing', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      await setTaskTime(user);

      // The fresh state, untouched: the anchor carries the task and no earlier
      // reminder is selected.
      const master = screen.getByRole('switch', { name: 'Send reminders' });
      expect(master).toHaveAttribute('aria-checked', 'true');

      await user.click(master);
      expect(master).toHaveAttribute('aria-checked', 'false');
      await user.click(master);
      expect(master).toHaveAttribute('aria-checked', 'true');

      // Nothing was invented: the anchor still carries the entry, and the box
      // the user unchecked stays unchecked.
      expect(screen.getByRole('checkbox', { name: 'At the scheduled time' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      for (const name of [
        '24 hours before',
        '1 hour before',
        '30 minutes before',
        '15 minutes before',
      ]) {
        expect(screen.getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'false');
      }
      // Not silent — the anchor fires — so no warning either.
      expect(
        screen.queryByText('Select at least one time, or no reminder will be sent.')
      ).not.toBeInTheDocument();
    });

    it('a master off→on cycle with the anchor armed saves the selection unchanged', async () => {
      // The wire half of the test above. `reminderFlagsForSave` is verbatim now,
      // so anything the sync rules invent is persisted.
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Refill the water jug');
      await setTaskTime(user);
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

      // The four values are never cleared and the master never writes to them,
      // so the user's 24h choice comes back exactly as it was.
      expect(screen.getByRole('checkbox', { name: '24 hours before' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('checkbox', { name: '15 minutes before' })).toHaveAttribute(
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
      // 15m is no longer on by default, so the user arms it here — it is what
      // keeps the master up while the anchor comes down (rule 2 needs REAL
      // silence), and it makes the anchor the only thing that changed.
      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));
      await user.click(screen.getByRole('checkbox', { name: 'At the scheduled time' }));
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
      // 15m on, anchor off, 15m back off — rule 2 then takes the master down.
      // (The box has to be armed first: nothing in the group starts selected.)
      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));
      await user.click(screen.getByRole('checkbox', { name: 'At the scheduled time' }));
      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));
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

      // 15m starts OFF for every type now — every event alerts at its scheduled
      // time on its own, so nothing earlier is pre-selected. Turn it ON first so
      // this still exercises what it is named for: unchecking the LAST earlier
      // reminder must not flip the master off.
      const fifteenMed = screen.getByRole('checkbox', { name: '15 minutes before' });
      expect(fifteenMed).toHaveAttribute('aria-checked', 'false');
      await user.click(fifteenMed);
      expect(fifteenMed).toHaveAttribute('aria-checked', 'true');

      await user.click(fifteenMed);

      expect(screen.getByRole('switch', { name: 'Send reminders' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('checkbox', { name: '15 minutes before' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
      // The dose-time push and escalation chain are unaffected.
      expect(screen.getByText('At the scheduled time')).toBeInTheDocument();
    });

    it('medication — turning the master on with nothing selected checks NOTHING', async () => {
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
        expect(screen.getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'false');
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

      expect(screen.getByRole('checkbox', { name: '1 hour before' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('checkbox', { name: '15 minutes before' })).toHaveAttribute(
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

      expect(screen.getByRole('checkbox', { name: 'At the scheduled time' })).toHaveAttribute(
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
      expect(screen.getByRole('checkbox', { name: 'At the scheduled time' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
      for (const name of [
        '24 hours before',
        '1 hour before',
        '30 minutes before',
        '15 minutes before',
      ]) {
        expect(screen.getByRole('checkbox', { name })).toHaveAttribute('aria-checked', 'false');
      }
    });

    it('never shows the none-selected warning for a medication (baseline still fires)', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      await user.click(screen.getByRole('checkbox', { name: '15 minutes before' }));

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
      // Pick 24h and nothing else — no box starts checked, so the master is
      // never taken down and the payload is purely the user's choice.
      await user.click(screen.getByRole('checkbox', { name: '24 hours before' }));
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

  // An independent care recipient with their own phone can OWN a task (e.g.
  // meal-time reminders): the backend accepts them as `assigned_to` and sends
  // the reminder only to the assignee. The picker used to filter them out —
  // every case below fails if `.filter((m) => !m.is_care_recipient)` returns.
  describe('assignee — the care recipient is assignable', () => {
    // Circle member order as useCircleMembers sorts it: owner, recipient,
    // caregivers. The picker must keep that order, recipient in place.
    // Real UUIDs: the form's Zod schema requires `assigned_to` to be one.
    const OWNER_ID = '11111111-1111-4111-8111-111111111111';
    const RECIPIENT_ID = '22222222-2222-4222-8222-222222222222';
    const CAREGIVER_ID = '33333333-3333-4333-8333-333333333333';
    const MEMBERS = [
      { id: OWNER_ID, first_name: 'Tess', email: 't@example.com', is_care_recipient: false },
      { id: RECIPIENT_ID, first_name: 'Ray', email: 'r@example.com', is_care_recipient: true },
      { id: CAREGIVER_ID, first_name: null, email: 'cara@example.com', is_care_recipient: false },
    ];

    function assigneeSelect(): HTMLSelectElement {
      return document.getElementById('assigned_to') as HTMLSelectElement;
    }

    function optionLabels(): string[] {
      return Array.from(assigneeSelect().options).map((o) => o.textContent ?? '');
    }

    afterEach(async () => {
      const { default: i18n } = await import('@/i18n');
      if (i18n.language !== 'en') await i18n.changeLanguage('en');
    });

    it('lists Anyone first, then every member in order with the recipient captioned (EN)', () => {
      useCircleResult.members = MEMBERS;
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      expect(optionLabels()).toEqual(['Anyone', 'Tess', 'Ray · Care recipient', 'cara']);
      expect(Array.from(assigneeSelect().options).map((o) => o.value)).toEqual([
        '',
        OWNER_ID,
        RECIPIENT_ID,
        CAREGIVER_ID,
      ]);
      // Default stays "Anyone" (unassigned).
      expect(assigneeSelect()).toHaveValue('');
    });

    it('captions the recipient in Spanish', async () => {
      const { default: i18n } = await import('@/i18n');
      await i18n.changeLanguage('es');
      useCircleResult.members = MEMBERS;
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      expect(optionLabels()).toContain('Ray · Receptor de cuidado');
      expect(optionLabels()).toContain('Tess');
    });

    it('creates a task assigned to the recipient (his user_id is sent as assigned_to)', async () => {
      const user = userEvent.setup();
      useCircleResult.members = MEMBERS;
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);

      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Lunch');
      const timeField = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeField);
      await user.type(timeField, '12:00');
      await user.selectOptions(screen.getByLabelText('Assigned to'), RECIPIENT_ID);
      expect(assigneeSelect()).toHaveValue(RECIPIENT_ID);

      await user.click(screen.getByRole('button', { name: 'Create' }));
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
      expect(mutateCreate.mock.calls[0][0].assigned_to).toBe(RECIPIENT_ID);
    });

    it('hydrates a recipient-assigned task on edit and keeps him (not reset to Anyone)', async () => {
      const user = userEvent.setup();
      useCircleResult.members = MEMBERS;
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeEvent({ event_type: 'task', assigned_to: RECIPIENT_ID, duration_minutes: 30 })}
          onClose={vi.fn()}
        />
      );

      // The validity effect drops an assignee missing from the options' source
      // list — a recipient must survive it.
      expect(assigneeSelect()).toHaveValue(RECIPIENT_ID);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      expect(mutateUpdate.mock.calls[0][0].data.assigned_to).toBe(RECIPIENT_ID);
    });

    it('reassigns an existing task from a caregiver to the recipient', async () => {
      const user = userEvent.setup();
      useCircleResult.members = MEMBERS;
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeEvent({ event_type: 'task', assigned_to: OWNER_ID, duration_minutes: 30 })}
          onClose={vi.fn()}
        />
      );

      await user.selectOptions(screen.getByLabelText('Assigned to'), RECIPIENT_ID);
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      expect(mutateUpdate.mock.calls[0][0].data.assigned_to).toBe(RECIPIENT_ID);
    });
  });
});

/**
 * The "15 minutes before" DEFAULT — OFF for EVERY type, matching mobile's
 * `defaultReminder15mFor`.
 *
 * Every event now alerts at its scheduled time on its own: a medication off
 * `notifications_enabled` (plus the escalation chain), a task or appointment off
 * `reminder_at_due`, which `process_task_reminders()` reads for exactly those
 * two types. Nothing in "Earlier reminders" is therefore pre-selected — an
 * earlier push is a second notification, and a second notification is a choice.
 *
 * THESE RENDER THE MODAL. An earlier version of this block re-implemented the
 * default as a local `defaultFor` arrow and asserted against that, which would
 * have stayed green through any change to the component whatsoever.
 */
describe('AddEventModal — the 15-minute default', () => {
  /** The reminders fieldset needs a time for anything but a medication. */
  async function openReminders(
    user: ReturnType<typeof userEvent.setup>,
    type: 'medication' | 'task' | 'appointment'
  ): Promise<void> {
    if (type === 'medication') return;
    const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
    await user.clear(timeInput);
    await user.type(timeInput, '14:00');
  }

  it.each(['medication', 'task', 'appointment'] as const)('is OFF for a new %s', async (type) => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType={type} onClose={vi.fn()} />);
    await openReminders(user, type);

    expect(screen.getByRole('checkbox', { name: '15 minutes before' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
    // Off is not silent: the anchor is what carries every fresh entry now.
    expect(screen.getByRole('checkbox', { name: 'At the scheduled time' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  /**
   * `??` not `||`, and hydration NEVER re-derives the default.
   *
   * A task created under the old task/appointment default really does hold
   * `reminder_15m = true` — that is what the cron will send — so the edit form
   * has to show it. Rewriting it to the new default on open would mutate a
   * notification the user never touched, and `reminderFlagsForSave` would write
   * the mutation back on the next save.
   */
  it('shows a stored TRUE on a task written under the old default', () => {
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={makeReminderEvent(
          { event_type: 'task', duration_minutes: 30 },
          { notifications_enabled: true, reminder_15m: true }
        )}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('checkbox', { name: '15 minutes before' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('shows a stored FALSE on a medication the user deliberately unticked', () => {
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={makeReminderEvent(
          { event_type: 'medication', medication_name: 'Lisinopril' },
          { notifications_enabled: true, reminder_15m: false }
        )}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('checkbox', { name: '15 minutes before' })).toHaveAttribute(
      'aria-checked',
      'false'
    );
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

  it('a name the directory does not know saves as typed with no warning (non-US brand names)', async () => {
    const { searchDrugs } = await import('@/api/drugs');
    vi.mocked(searchDrugs).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

    await user.type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Doliprane');
    await waitFor(() => expect(searchDrugs).toHaveBeenCalled());
    expect(screen.queryByText(/not found|not recogni[sz]ed|check (the )?spelling|couldn.t find/i)).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
    await user.clear(dateInput);
    await user.type(dateInput, '2099-01-01');
    const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
    await user.clear(timeInput);
    await user.type(timeInput, '09:00');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ medication_name: 'Doliprane' });
    expect(mutateCreate.mock.calls[0][0]).not.toHaveProperty('rxcui');
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
  // ──────────────────────────────────────────────────────────────────────────
  // DOUBLE SUBMIT — a duplicated MEDICATION SERIES is a care record, not a
  // cosmetic glitch: two series means two reminder schedules and two
  // dose-confirmation streams for one drug, which doubles the denominator of
  // the adherence figure a clinician reads.
  //
  // `if (!canEdit || isPending) return` cannot stop it. `isPending` is React
  // Query state, committed a render AFTER the event that started the request,
  // so a second submit dispatched in the SAME tick re-enters the handler with
  // the flag still false — and `disabled` on the button is not consulted at all
  // by implicit form submission (Enter in a field) or a synthetic
  // `requestSubmit()`. See `useGuardedSubmit`'s docstring, which was written
  // about exactly this shape.
  //
  // These use `submitFormTwice`, NOT two awaited `userEvent.click`s: userEvent
  // awaits between interactions, so React commits the first render and a
  // state-flag "fix" would pass while the real bug shipped.
  // ──────────────────────────────────────────────────────────────────────────
  describe('double submit', () => {
    async function fillFutureMedication(): Promise<HTMLFormElement> {
      const user = userEvent.setup();
      await user.type(screen.getByRole('combobox', { name: /^Medication name/ }), 'Metformin');
      const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
      await user.clear(dateInput);
      await user.type(dateInput, '2099-01-01');
      const timeInput = screen.getByLabelText(/^Time/) as HTMLInputElement;
      await user.clear(timeInput);
      await user.type(timeInput, '09:00');
      const form = document.getElementById('add-event-form');
      if (!(form instanceof HTMLFormElement)) throw new Error('add-event-form not found');
      return form;
    }

    it('creates ONE medication series when the form is submitted twice in one tick', async () => {
      // Never settles: the request is still in flight when the second submit
      // arrives, which is the only state in which the guard is under test. A
      // `vi.fn()` returning undefined would resolve on the next microtask and
      // legitimately free the guard.
      mutateCreate.mockImplementation(() => neverSettles());
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      const form = await fillFutureMedication();
      await submitFormTwice(form);

      expect(mutateCreate).toHaveBeenCalledTimes(1);
    });

    it('still saves on a genuine RESUBMIT after the first attempt failed', async () => {
      // The guard must be released on the rejection path too — otherwise a
      // failed save latches the form shut for the rest of its life.
      mutateCreate.mockRejectedValueOnce(new Error('500'));
      render(<AddEventModal circleId={CIRCLE_ID} initialType="medication" onClose={vi.fn()} />);

      const form = await fillFutureMedication();
      await submitFormTwice(form);
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));

      mutateCreate.mockResolvedValueOnce({ id: 'e-1' });
      await submitFormTwice(form);
      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(2));
    });

    it('a validation failure does not latch the form — the corrected submit goes through', async () => {
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);

      const form = document.getElementById('add-event-form');
      if (!(form instanceof HTMLFormElement)) throw new Error('add-event-form not found');

      // Empty title → the handler returns before any request.
      await submitFormTwice(form);
      expect(mutateCreate).not.toHaveBeenCalled();

      await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Eye exam');
      const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
      await user.clear(dateInput);
      await user.type(dateInput, '2099-01-01');
      await user.click(screen.getByRole('button', { name: 'Create' }));

      await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    });
  });
});

// ── Days of the week (docs/plans/weekly-days-of-week.md, Task 25) ────────────
//
// "Today" is frozen at 2026-06-15T18:00:00Z = Monday 14:00 in New York (the
// recipient's zone). Only Date is faked, so userEvent's timers stay real.
// Weekdays used below (0=Sun): 06-01 Mon, 06-15 Mon, 06-16 Tue, 06-17 Wed,
// 06-23 Tue, 06-25 Thu. Every case is an ALL-DAY task/appointment, so the
// viewer and recipient dates are the same string and nothing here depends on
// the zone conversion (which has its own suite above).
describe('AddEventModal — days of the week', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-15T18:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const chip = (name: string): HTMLElement => screen.getByRole('checkbox', { name });
  const repeatGroup = (): HTMLElement => screen.getByRole('group', { name: 'Repeat on' });

  /** A series ROOT, all-day, so no end-time validation gets in the way. */
  function makeSeries(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return makeEvent({
      id: 'root-1',
      event_type: 'task',
      title: 'Physio exercises',
      scheduled_time: null,
      recurrence_rule: 'weekly',
      ...overrides,
    });
  }

  async function createTaskOn(date: string): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Physio exercises');
    const dateInput = screen.getByLabelText(/^Date/) as HTMLInputElement;
    await user.clear(dateInput);
    await user.type(dateInput, date);
    return user;
  }

  it('offers "Days of the week" as the LAST repeat option, right after Cycle', () => {
    render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
    const options = within(screen.getByLabelText('Repeat')).getAllByRole('option');
    expect(options.map((o) => o.textContent).slice(-2)).toEqual([
      'Cycle (days on / off)',
      'Days of the week',
    ]);
    expect(options[options.length - 1]).toHaveValue('days_of_week');
    // Hidden until chosen, like the Cycle inputs.
    expect(screen.queryByRole('group', { name: 'Repeat on' })).not.toBeInTheDocument();
  });

  it('reveals the chips inline in week order and pre-selects the start date weekday', async () => {
    const user = await createTaskOn('2026-06-16'); // Tuesday
    await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');

    const names = within(repeatGroup())
      .getAllByRole('checkbox')
      .map((el) => el.getAttribute('aria-label'));
    // EN weeks start on Sunday; full names are the accessible names.
    expect(names).toEqual([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]);
    expect(chip('Tuesday')).toHaveAttribute('aria-checked', 'true');
    expect(chip('Monday')).toHaveAttribute('aria-checked', 'false');
    // Short visible names; the summary line under the chips.
    expect(chip('Tuesday')).toHaveTextContent('Tue');
    expect(within(repeatGroup().parentElement!.parentElement!).getByText('Tue', { selector: 'p' }))
      .toBeInTheDocument();
    // Nothing moves — the start day is selected — and nothing is locked on a create.
    expect(screen.queryByText(/^First time:/)).not.toBeInTheDocument();
    expect(chip('Tuesday')).not.toHaveAttribute('aria-disabled');
  });

  it('creates weekly + the chosen days and moves the start to the first selected day', async () => {
    const user = await createTaskOn('2026-06-16'); // Tuesday
    await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');
    await user.click(chip('Tuesday')); // off
    await user.click(chip('Friday'));
    await user.click(chip('Monday'));
    await user.click(chip('Wednesday'));

    expect(screen.getByText('Mon, Wed, Fri')).toBeInTheDocument();
    // Tuesday is not selected: the series cannot start there.
    expect(screen.getByText('First time: Wed, Jun 17')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0];
    expect(payload.recurrence_rule).toBe('weekly');
    expect(payload.recurrence_days).toEqual([1, 3, 5]);
    expect(payload.scheduled_date).toBe('2026-06-17');
  });

  it('a single day is weekly + [that day], with the start left where it is', async () => {
    const user = await createTaskOn('2026-06-16');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0];
    expect(payload.recurrence_rule).toBe('weekly');
    expect(payload.recurrence_days).toEqual([2]);
    expect(payload.scheduled_date).toBe('2026-06-16');
  });

  it('refuses to save with no day selected: inline error, focus on the chips, no request', async () => {
    const user = await createTaskOn('2026-06-16');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');
    await user.click(chip('Tuesday')); // now empty

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(mutateCreate).not.toHaveBeenCalled();
    const error = screen.getByText('Choose at least one day');
    // The error is among the descriptions (the PK23 zone note may follow it).
    expect(repeatGroup().getAttribute('aria-describedby')!.split(' ')).toContain(error.closest('p')!.id);
    expect(repeatGroup()).toHaveFocus();

    // Picking a day clears the error and the save goes through.
    await user.click(chip('Thursday'));
    expect(screen.queryByText('Choose at least one day')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
  });

  it('all seven days are saved as Daily, with no day list', async () => {
    const user = await createTaskOn('2026-06-16');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');
    for (const day of ['Sunday', 'Monday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      await user.click(chip(day));
    }

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    const payload = mutateCreate.mock.calls[0][0];
    expect(payload.recurrence_rule).toBe('daily');
    expect(payload).not.toHaveProperty('recurrence_days');
    expect(payload.scheduled_date).toBe('2026-06-16');
  });

  it('Space toggles a focused chip (keyboard parity with a click)', async () => {
    const user = await createTaskOn('2026-06-16');
    await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');
    chip('Thursday').focus();
    await user.keyboard(' ');
    expect(chip('Thursday')).toHaveAttribute('aria-checked', 'true');
  });

  describe('editing a series that has STARTED', () => {
    it('hydrates the stored days and locks the anchor weekday on with the note', async () => {
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeSeries({ scheduled_date: '2026-06-01', recurrence_days: [5, 1, 3] })}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByLabelText('Repeat')).toHaveValue('days_of_week');
      expect(chip('Monday')).toHaveAttribute('aria-checked', 'true');
      expect(chip('Wednesday')).toHaveAttribute('aria-checked', 'true');
      expect(chip('Friday')).toHaveAttribute('aria-checked', 'true');

      const note = screen.getByText(
        'Started on Monday. To remove Monday, end this series and add a new one.'
      );
      expect(chip('Monday')).toHaveAttribute('aria-disabled', 'true');
      expect(chip('Monday')).toHaveAttribute('aria-describedby', note.id);
      // Only the anchor is locked.
      expect(chip('Wednesday')).not.toHaveAttribute('aria-disabled');

      // Neither a click nor Space removes it.
      await user.click(chip('Monday'));
      chip('Monday').focus();
      await user.keyboard(' ');
      expect(chip('Monday')).toHaveAttribute('aria-checked', 'true');

      await user.click(chip('Wednesday')); // off
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const { eventId, data } = mutateUpdate.mock.calls[0][0];
      expect(eventId).toBe('root-1');
      expect(data.recurrence_rule).toBe('weekly');
      expect(data.recurrence_days).toEqual([1, 5]);
      // The anchor never moves on a started series.
      expect(data.scheduled_date).toBe('2026-06-01');
    });

    it('locks the ROOT anchor weekday, not the weekday of the occurrence that was opened', async () => {
      // The Calendar opens the form with a VIRTUAL occurrence (Wed 06-17): it
      // carries the rule but neither the root's date nor its days.
      seriesRootOverride = {
        root: {
          id: 'root-1',
          scheduled_date: '2026-06-01', // Monday
          scheduled_time: null,
          recurrence_rule: 'weekly',
          recurrence_days: [1, 3],
          recurrence_end_date: null,
        },
      };
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeSeries({
            id: 'root-1_2026-06-17',
            parent_event_id: 'root-1',
            is_virtual: true,
            scheduled_date: '2026-06-17',
          })}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByLabelText('Repeat')).toHaveValue('days_of_week');
      expect(chip('Monday')).toHaveAttribute('aria-disabled', 'true');
      expect(chip('Wednesday')).not.toHaveAttribute('aria-disabled');
      // The form edits the SERIES, so it shows the series' start date.
      expect(screen.getByLabelText(/^Date/)).toHaveValue('2026-06-01');

      await user.click(chip('Wednesday')); // off — allowed, it is not the anchor
      await user.click(chip('Thursday'));
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const { eventId, data } = mutateUpdate.mock.calls[0][0];
      expect(eventId).toBe('root-1');
      expect(data.recurrence_days).toEqual([1, 4]);
      // Never the occurrence's date written onto the root.
      expect(data.scheduled_date).toBe('2026-06-01');
    });

    it('refuses to save while the series root is still being resolved', async () => {
      seriesRootOverride = { root: undefined };
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeSeries({
            id: 'root-1_2026-06-17',
            parent_event_id: 'root-1',
            is_virtual: true,
            scheduled_date: '2026-06-17',
          })}
          onClose={vi.fn()}
        />
      );

      // HYDRATION GATE: no form at all while the root resolves — so neither
      // the occurrence's date nor its (possibly stale) title can be shown,
      // typed over, or saved onto the series.
      expect(screen.getByTestId('series-root-loading')).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Date/)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
      await user.keyboard('{Enter}');
      expect(mutateUpdate).not.toHaveBeenCalled();
    });
  });

  describe('leaving a days series', () => {
    it('switching back to plain Weekly sends recurrence_days: null (clears the set)', async () => {
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeSeries({ scheduled_date: '2026-06-01', recurrence_days: [1, 3, 5] })}
          onClose={vi.fn()}
        />
      );
      await user.selectOptions(screen.getByLabelText('Repeat'), 'weekly');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const { data } = mutateUpdate.mock.calls[0][0];
      expect(data.recurrence_rule).toBe('weekly');
      expect(data).toHaveProperty('recurrence_days', null);
    });

    it('switching to Daily also clears the set explicitly', async () => {
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeSeries({ scheduled_date: '2026-06-01', recurrence_days: [1, 3, 5] })}
          onClose={vi.fn()}
        />
      );
      await user.selectOptions(screen.getByLabelText('Repeat'), 'daily');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const { data } = mutateUpdate.mock.calls[0][0];
      expect(data.recurrence_rule).toBe('daily');
      expect(data).toHaveProperty('recurrence_days', null);
    });

    it('an untouched plain Weekly series never writes a day list, null or otherwise', async () => {
      const user = userEvent.setup();
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeSeries({ scheduled_date: '2026-06-01', recurrence_days: null })}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByLabelText('Repeat')).toHaveValue('weekly');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      expect(mutateUpdate.mock.calls[0][0].data).not.toHaveProperty('recurrence_days');
    });
  });

  it('a series that has NOT started moves its start to the first selected day, unlocked', async () => {
    const user = userEvent.setup();
    render(
      <AddEventModal
        circleId={CIRCLE_ID}
        event={makeSeries({ scheduled_date: '2026-06-23', recurrence_days: null })} // Tue, future
        onClose={vi.fn()}
      />
    );
    await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');
    expect(chip('Tuesday')).toHaveAttribute('aria-checked', 'true');
    expect(chip('Tuesday')).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByText(/^Started on/)).not.toBeInTheDocument();

    await user.click(chip('Tuesday')); // off — allowed before the series starts
    await user.click(chip('Thursday'));
    expect(screen.getByText('First time: Thu, Jun 25')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const { data } = mutateUpdate.mock.calls[0][0];
    expect(data.recurrence_days).toEqual([4]);
    expect(data.scheduled_date).toBe('2026-06-25');
  });
});

// ── B9b: PK21 start/end + PK23 zone note ─────────────────────────────────────
describe('PK21: moving the start moves the end', () => {
  const timeInput = () => screen.getByLabelText(/^Time/) as HTMLInputElement;
  const endInput = () => screen.getByLabelText(/^End time/) as HTMLInputElement;

  it('keeps the duration when the start changes (edit: 14:00 NY = 12:00 MT, 60 min)', async () => {
    const user = userEvent.setup();
    const stored = makeEvent({ scheduled_time: '14:00:00', duration_minutes: 60 });
    render(<AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />);
    expect(timeInput().value).toBe('12:00');
    expect(endInput().value).toBe('13:00');

    fireEvent.change(timeInput(), { target: { value: '15:30' } });
    expect(endInput().value).toBe('16:30');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect(mutateUpdate.mock.calls[0][0].data.duration_minutes).toBe(60);
  });

  it('wraps past midnight instead of clamping at 23:59 (22:00-23:00 moved to 23:30 ends 00:30)', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Late visit');
    fireEvent.change(timeInput(), { target: { value: '22:00' } });
    fireEvent.change(endInput(), { target: { value: '23:00' } });
    fireEvent.change(timeInput(), { target: { value: '23:30' } });
    expect(endInput().value).toBe('00:30');

    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0].duration_minutes).toBe(60);
  });

  it('a hand-typed midnight-crossing end saves as the next-day span (23:45 -> 00:15 = 30)', async () => {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Title( \* \(required\))?$/), 'Night call');
    fireEvent.change(timeInput(), { target: { value: '23:45' } });
    fireEvent.change(endInput(), { target: { value: '00:15' } });
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalledTimes(1));
    expect(mutateCreate.mock.calls[0][0].duration_minutes).toBe(30);
  });

  it('a NEW entry still gets the 30-minute default end', async () => {
    render(<AddEventModal circleId={CIRCLE_ID} initialType="appointment" onClose={vi.fn()} />);
    fireEvent.change(timeInput(), { target: { value: '09:00' } });
    expect(endInput().value).toBe('09:30');
  });
});

describe('PK21: editing a row stored without a duration', () => {
  it('opens with no end, does not require one, and saves without duration_minutes', async () => {
    const user = userEvent.setup();
    const stored = makeEvent({ scheduled_time: '14:00:00' }); // no duration_minutes
    render(<AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />);
    const end = screen.getByLabelText(/^End time/) as HTMLInputElement;
    expect(end.value).toBe('');
    expect(end).not.toBeRequired();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    expect(mutateUpdate.mock.calls[0][0].data.duration_minutes).toBeUndefined();
    expect(end).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('moving its start does not invent an end', async () => {
    const stored = makeEvent({ scheduled_time: '14:00:00' });
    render(<AddEventModal circleId={CIRCLE_ID} event={stored} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/^Time/), { target: { value: '16:00' } });
    expect((screen.getByLabelText(/^End time/) as HTMLInputElement).value).toBe('');
  });
});

describe('PK23: the weekday chips name the recipient zone only when it differs', () => {
  afterEach(() => {
    useCircleResult.timezone = RECIPIENT_TZ;
  });

  async function openDays() {
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText('Repeat'), 'days_of_week');
    return screen.getByRole('group', { name: 'Repeat on' });
  }

  it('viewer (Denver) vs recipient (New York): the note shows and describes the group', async () => {
    useCircleResult.circle = { recipient_name: 'Rosa' };
    const group = await openDays();
    const note = screen.getByText(/^Days are in Rosa's time zone/);
    expect(note).toBeInTheDocument();
    expect(group.getAttribute('aria-describedby')).toContain(note.id);
  });

  it('no recipient name: the generic note', async () => {
    await openDays();
    expect(screen.getByText(/^Days are in their time zone/)).toBeInTheDocument();
  });

  it('same zone: no note at all', async () => {
    useCircleResult.timezone = 'America/Denver';
    useCircleResult.circle = { recipient_name: 'Rosa' };
    const group = await openDays();
    expect(screen.queryByText(/^Days are in /)).not.toBeInTheDocument();
    expect(group.getAttribute('aria-describedby')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OWNER DECISION 2026-10-10 — a recurring task is editable from EVERY
// occurrence, completed and past ones included, and the edit is always to the
// SERIES. The backend freezes a completed/past occurrence into its own row that
// KEEPS that day's title/time, so the form must hydrate from the ROOT: an
// occurrence snapshot saved back would push the day's stale values onto the
// whole series. What the client controls is asserted here: the PATCH targets
// the root id (never the occurrence), carries the root's values, and never
// carries completion state.
// ─────────────────────────────────────────────────────────────────────────────
describe('AddEventModal — editing a recurring TASK series from any occurrence', () => {
  // The series as it stands NOW (renamed and re-timed after day one).
  const ROOT = {
    id: 'root-1',
    circle_id: CIRCLE_ID,
    event_type: 'task' as const,
    title: 'Water the plants',
    description: 'Both balconies',
    location: 'Home',
    assigned_to: null,
    notifications_enabled: true,
    reminder_at_due: true,
    reminder_24h: false,
    reminder_1h: true,
    reminder_30m: false,
    reminder_15m: false,
    scheduled_date: '2026-06-15',
    scheduled_time: '09:00:00',
    duration_minutes: null,
    recurrence_rule: 'daily',
    recurrence_days: null,
    recurrence_end_date: null,
  };

  // Day one, COMPLETED, frozen with the values it had then.
  const completedOccurrence = makeEvent({
    id: 'child-0615',
    parent_event_id: 'root-1',
    event_type: 'task',
    title: 'Old title',
    description: 'Old notes',
    location: 'Old place',
    scheduled_date: '2026-06-15',
    scheduled_time: '07:00:00',
    recurrence_rule: null,
    reminder_1h: false,
    completed_at: '2026-06-15T12:00:00Z',
    completed_by: 'u-1',
  });

  // Tomorrow, NOT completed — a virtual occurrence of the current series.
  const upcomingOccurrence = makeEvent({
    id: 'root-1_2026-06-16',
    parent_event_id: 'root-1',
    is_virtual: true,
    event_type: 'task',
    title: 'Water the plants',
    description: 'Both balconies',
    location: 'Home',
    scheduled_date: '2026-06-16',
    scheduled_time: '09:00:00',
    recurrence_rule: 'daily',
    completed_at: null,
  });

  const titleInput = (): HTMLInputElement =>
    screen.getByLabelText(/^Title( \* \(required\))?$/) as HTMLInputElement;

  describe.each([
    ['A — from an UPCOMING (not completed) occurrence', upcomingOccurrence],
    ['B — from a COMPLETED occurrence', completedOccurrence],
  ] as const)('Scenario %s', (_label, occurrence) => {
    it('hydrates from the ROOT, shows the series note, and saves the edit to the ROOT', async () => {
      seriesRootOverride = { root: ROOT };
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} event={occurrence} onClose={vi.fn()} />);

      // The SERIES' values, never the occurrence's snapshot.
      expect(titleInput()).toHaveValue('Water the plants');
      expect(screen.getByLabelText(/^Date/)).toHaveValue('2026-06-15');
      const note = screen.getByTestId('series-edit-note');
      expect(note).toHaveTextContent(
        'Changes apply to upcoming tasks. Completed and past ones stay as they were.'
      );
      expect(document.getElementById('add-event-form')).toHaveAttribute(
        'aria-describedby',
        note.id
      );

      await user.clear(titleInput());
      await user.type(titleInput(), 'Water the garden');
      await user.click(screen.getByRole('button', { name: 'Save changes' }));

      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const { eventId, data } = mutateUpdate.mock.calls[0][0];
      expect(eventId).toBe('root-1');
      expect(eventId).not.toBe(occurrence.id);
      expect(data.title).toBe('Water the garden');
      // Untouched fields are the ROOT's, round-tripped unchanged.
      expect(data.description).toBe('Both balconies');
      expect(data.location).toBe('Home');
      expect(data.scheduled_date).toBe('2026-06-15');
      expect(data.scheduled_time).toBe('09:00');
      expect(data.recurrence_rule).toBe('daily');
      expect(data.reminder_1h).toBe(true);
      // An edit never writes completion state.
      expect(data).not.toHaveProperty('completed_at');
      expect(data).not.toHaveProperty('completed_by');
      expect(showToast).toHaveBeenCalledWith('Series updated', 'success');
    });

    it('an UNTOUCHED save writes the root back as it is — never the occurrence values', async () => {
      seriesRootOverride = { root: ROOT };
      const user = userEvent.setup();
      render(<AddEventModal circleId={CIRCLE_ID} event={occurrence} onClose={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
      const { eventId, data } = mutateUpdate.mock.calls[0][0];
      expect(eventId).toBe('root-1');
      expect(data.title).toBe('Water the plants');
      expect(data.title).not.toBe('Old title');
      expect(data.description).toBe('Both balconies');
      expect(data.scheduled_time).toBe('09:00');
    });
  });

  it('a completed ROOT (day one IS the root) is edited as the series itself', async () => {
    const completedRoot = makeEvent({ ...ROOT, completed_at: '2026-06-15T12:00:00Z' });
    const user = userEvent.setup();
    render(<AddEventModal circleId={CIRCLE_ID} event={completedRoot} onClose={vi.fn()} />);

    expect(screen.getByTestId('series-edit-note')).toBeInTheDocument();
    await user.clear(titleInput());
    await user.type(titleInput(), 'Water the garden');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mutateUpdate).toHaveBeenCalledTimes(1));
    const { eventId, data } = mutateUpdate.mock.calls[0][0];
    expect(eventId).toBe('root-1');
    expect(data.title).toBe('Water the garden');
    expect(data).not.toHaveProperty('completed_at');
  });

  it('a failed root fetch falls back to the occurrence (never locks the user out)', () => {
    // The real hook resolves a failed fetch to the occurrence itself.
    seriesRootOverride = { root: upcomingOccurrence };
    render(<AddEventModal circleId={CIRCLE_ID} event={upcomingOccurrence} onClose={vi.fn()} />);
    expect(titleInput()).toHaveValue('Water the plants');
  });

  describe('the series note is for recurring TASK edits only', () => {
    it('absent on a one-off task edit', () => {
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeEvent({ event_type: 'task', title: 'Call pharmacy' })}
          onClose={vi.fn()}
        />
      );
      expect(titleInput()).toHaveValue('Call pharmacy');
      expect(screen.queryByTestId('series-edit-note')).toBeNull();
      expect(document.getElementById('add-event-form')).not.toHaveAttribute('aria-describedby');
    });

    it('absent on a recurring APPOINTMENT edit', () => {
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeEvent({ event_type: 'appointment', recurrence_rule: 'weekly' })}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByLabelText(/^Date/)).toBeInTheDocument();
      expect(screen.queryByTestId('series-edit-note')).toBeNull();
    });

    it('absent on a recurring MEDICATION edit', () => {
      render(
        <AddEventModal
          circleId={CIRCLE_ID}
          event={makeEvent({
            event_type: 'medication',
            title: 'Metformin',
            medication_name: 'Metformin',
            recurrence_rule: 'daily',
          })}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByLabelText(/^Date/)).toBeInTheDocument();
      expect(screen.queryByTestId('series-edit-note')).toBeNull();
    });

    it('absent when creating a task', () => {
      render(<AddEventModal circleId={CIRCLE_ID} initialType="task" onClose={vi.fn()} />);
      expect(titleInput()).toBeInTheDocument();
      expect(screen.queryByTestId('series-edit-note')).toBeNull();
    });
  });
});
