import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
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

const medicationReactivated = vi.fn();
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    medicationReactivated: (...args: unknown[]) => medicationReactivated(...args),
    errorOccurred: vi.fn(),
  },
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
  // The medication-status mutation resolves the backend envelope's `data`, so
  // `series_count` (how many series roots the SERVER actually mutated) is what
  // the component reads for analytics — never a client-side count.
  statusMutateAsync.mockResolvedValue({ discontinued: false, affected_count: 1, series_count: 1 });
  completeMutateAsync.mockResolvedValue({});
});

// The i18next instance is shared across this file — a language switch must not
// leak into the English assertions above it.
afterEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});

// M2 — a medication's secondary actions (Edit, Discontinue/Reactivate,
// Delete) always overflow into the `MoreMenu` (3 items, never 1), so every
// test that reaches one of those clicks it as a `menuitem` after opening the
// trigger. A task/appointment overflows into the menu too UNLESS Edit is
// hidden (a completed task, leaving only Delete) — the single-item case that
// renders inline instead, exercised separately below.
async function openMore(user: ReturnType<typeof userEvent.setup>, name = 'More'): Promise<void> {
  await user.click(screen.getByRole('button', { name }));
}

describe('EventDetailActions', () => {
  it('an inactive medication prompts to reactivate instead of opening the editor', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <EventDetailActions
        circleId="circle-1"
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={inactive}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
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
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={inactive}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    // The confirm dialog's own "Reactivate" button, disambiguated from the
    // toggle item in the overflow menu (which ALSO reads "Reactivate" while
    // inactive).
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() =>
      expect(statusMutateAsync).toHaveBeenCalledWith({
        eventId: 'm-1',
        discontinued: false,
        scope: 'medication',
      })
    );

    // Guard is gone; a second Edit click goes straight to the editor — no
    // second reactivate prompt for a medication that was JUST reactivated.
    expect(
      screen.queryByText('This medication is inactive. Reactivate it to make changes.')
    ).not.toBeInTheDocument();
    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('WA6: the Discontinue/Reactivate toggle label flips to Discontinue immediately after reactivating', async () => {
    const user = userEvent.setup();
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <EventDetailActions
        circleId="circle-1"
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={inactive}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user);
    expect(screen.getByRole('menuitem', { name: 'Reactivate' })).toBeInTheDocument();

    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(statusMutateAsync).toHaveBeenCalledTimes(1));
    await openMore(user);
    expect(await screen.findByRole('menuitem', { name: 'Discontinue' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Reactivate' })).not.toBeInTheDocument();
  });

  it('WA6: calls the optional onReactivated callback so a parent can refresh its own stale snapshot', async () => {
    const user = userEvent.setup();
    const onReactivated = vi.fn();
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <EventDetailActions
        circleId="circle-1"
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={inactive}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
        onReactivated={onReactivated}
      />
    );

    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(onReactivated).toHaveBeenCalledTimes(1));
  });

  // WHOLE-MEDICATION reactivate from the CALENDAR, resolved by the SERVER.
  // Discontinue stops EVERY series sharing name + dosage, so the reactivate
  // that answers Edit-on-inactive must bring all of them back. The client used
  // to enumerate those roots from the loaded calendar window and fire one PATCH
  // each — a series scheduled outside the window was silently left inactive
  // under a success toast. Now it is ONE request with `scope: 'medication'`;
  // the window is irrelevant and the component never counts roots itself.
  it('reactivate-for-edit sends ONE PATCH with scope medication — never one per series', async () => {
    const user = userEvent.setup();
    // The tapped dose is a CHILD instance of the 08:00 series: the mutation
    // must target its parent root, never the instance id.
    const morningDose = makeMed({
      id: 'morning-child',
      parent_event_id: 'root-morning',
      discontinued_at: '2026-07-01T12:00:00Z',
    });
    // The server reports TWO roots mutated (an 08:00 and a 20:00 series of the
    // same drug at the same dose) — a fact the client could not have known.
    statusMutateAsync.mockResolvedValue({
      discontinued: false,
      affected_count: 9,
      series_count: 2,
    });

    render(
      <EventDetailActions
        circleId="circle-1"
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={morningDose}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(statusMutateAsync).toHaveBeenCalledTimes(1));
    expect(statusMutateAsync).toHaveBeenCalledWith({
      eventId: 'root-morning',
      discontinued: false,
      scope: 'medication',
    });

    // ONE analytics event for the whole action, and `series_count` comes from
    // the RESPONSE — not from anything the client counted.
    expect(medicationReactivated).toHaveBeenCalledTimes(1);
    expect(medicationReactivated).toHaveBeenCalledWith('circle-1', {
      surface: 'calendar',
      seriesCount: 2,
    });

    // The toast no longer hedges about schedules outside the date range: the
    // server saw every series, so the whole medication really is back.
    expect(showToast).toHaveBeenCalledWith('Medication reactivated', 'success');
  });

  it('the single-series case (the common one) reports the server series_count of 1', async () => {
    const user = userEvent.setup();
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });
    render(
      <EventDetailActions
        circleId="circle-1"
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={inactive}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(statusMutateAsync).toHaveBeenCalledTimes(1));
    expect(statusMutateAsync).toHaveBeenCalledWith({
      eventId: 'm-1',
      discontinued: false,
      scope: 'medication',
    });
    expect(medicationReactivated).toHaveBeenCalledTimes(1);
    expect(medicationReactivated).toHaveBeenCalledWith('circle-1', {
      surface: 'calendar',
      seriesCount: 1,
    });
    expect(showToast).toHaveBeenCalledWith('Medication reactivated', 'success');
  });

  it('targets the parent series root when a CHILD instance was tapped', async () => {
    const user = userEvent.setup();
    const inactiveChild = makeMed({
      id: 'child-1',
      parent_event_id: 'root-1',
      discontinued_at: '2026-07-01T12:00:00Z',
    });

    render(
      <EventDetailActions
        circleId="circle-1"
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={inactiveChild}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(statusMutateAsync).toHaveBeenCalledTimes(1));
    expect(statusMutateAsync).toHaveBeenCalledWith({
      eventId: 'root-1',
      discontinued: false,
      scope: 'medication',
    });
  });

  // The plural count copy is gone with the client-side fan-out, but the toast
  // that replaced it still has to exist in Spanish — a missing translation
  // renders the raw key, which a key-parity JSON diff cannot see.
  it('ES: the reactivate toast renders in Spanish', async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage('es');
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <EventDetailActions
        circleId="circle-1"
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={inactive}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user, 'Más');
    await user.click(screen.getByRole('menuitem', { name: 'Editar evento' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivar' }));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Medicamento reactivado', 'success')
    );
  });

  it('a FAILED PATCH reports no success — no analytics event and no toast', async () => {
    const user = userEvent.setup();
    statusMutateAsync.mockRejectedValue(new Error('403'));
    const inactive = makeMed({ discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <EventDetailActions
        circleId="circle-1"
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={inactive}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(statusMutateAsync).toHaveBeenCalledTimes(1));
    expect(medicationReactivated).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
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
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={completedTask}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    // Edit is the only OTHER secondary action a task has, and it's hidden —
    // so Delete is the sole overflow item and renders inline, with no
    // one-item menu to hide it behind.
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit event' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  it('an open task keeps Edit (in the overflow menu) and Mark complete', async () => {
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
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={openTask}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
    // Two overflow items (Edit, Delete) → a real menu, not the inline solo case.
    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('a completed appointment still offers Edit (in the overflow menu) — the lock is scoped to tasks', async () => {
    const user = userEvent.setup();
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
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={completedAppt}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user);
    expect(screen.getByRole('menuitem', { name: 'Edit event' })).toBeInTheDocument();
  });

  it('an active medication opens the editor directly (no guard)', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const active = makeMed();

    render(
      <EventDetailActions
        circleId="circle-1"
        careRecipientTimezone="America/New_York"
        onConfirmDose={vi.fn()}
        event={active}
        onEdit={onEdit}
        onDelete={vi.fn()}
        onDiscontinue={vi.fn()}
      />
    );

    await openMore(user);
    await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
  // ==========================================================================
  // DOSE CONFIRMATION FROM A CALENDAR SURFACE — the reversal
  // --------------------------------------------------------------------------
  // This modal used to render no mark-taken control at all, on the theory that
  // a confirm on an inactive medication could only ever 409. The cost was worse
  // than the 409: a dose really GIVEN but not yet logged when the medication
  // was stopped could never be logged, so it stays scheduled-and-missed in the
  // clinician-facing adherence report forever.
  //
  // The predicate is about what the SURFACE fetched, not about the medication's
  // state: the calendar fetches WITHOUT `includeDiscontinued` and the backend
  // has already filtered it to due-only occurrences, so a dose that is VISIBLE
  // here is confirmable — `discontinued_at` is not consulted. (The Medications
  // roster does pass the flag and can hold not-due occurrences; it renders no
  // dose-confirmation control at all — see MedicationsPage.)
  // ==========================================================================
  describe('dose confirmation', () => {
    // A day that has definitively arrived in any timezone, so the assertions
    // never depend on the runner's clock.
    const PAST_DOSE = { scheduled_date: '2020-01-02', scheduled_time: '08:00:00' };

    it('an INACTIVE medication dose still offers Mark taken and Skip dose', async () => {
      const user = userEvent.setup();
      const onConfirmDose = vi.fn();
      const inactiveDose = makeMed({
        ...PAST_DOSE,
        discontinued_at: '2026-07-01T12:00:00Z',
        confirmation: null,
      });

      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={onConfirmDose}
          event={inactiveDose}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Mark taken' }));
      expect(onConfirmDose).toHaveBeenCalledWith('taken');

      await user.click(screen.getByRole('button', { name: 'Skip dose' }));
      expect(onConfirmDose).toHaveBeenCalledWith('skipped');
      expect(onConfirmDose).toHaveBeenCalledTimes(2);
    });

    it('the inactive dose keeps the reactivate-to-edit guard AND the full action set', async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();
      const inactiveDose = makeMed({
        ...PAST_DOSE,
        discontinued_at: '2026-07-01T12:00:00Z',
      });

      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={inactiveDose}
          onEdit={onEdit}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      // Only ACTIONABILITY of the dose changed — the medication is still
      // inactive, and every other action behaves exactly as before (now
      // behind the overflow menu, alongside Mark taken/Skip dose inline).
      expect(screen.getByRole('button', { name: 'Mark taken' })).toBeInTheDocument();
      await openMore(user);
      expect(screen.getByRole('menuitem', { name: 'Reactivate' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
      await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
      expect(onEdit).not.toHaveBeenCalled();
      expect(
        screen.getByText('This medication is inactive. Reactivate it to make changes.')
      ).toBeInTheDocument();
    });

    it('an ACTIVE medication dose offers the identical pair — the control is not tied to discontinued_at', () => {
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={makeMed({ ...PAST_DOSE, discontinued_at: null })}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: 'Mark taken' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Skip dose' })).toBeInTheDocument();
    });

    it('a dose that is already logged offers no confirm controls — it shows its status instead', () => {
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={makeMed({
            ...PAST_DOSE,
            discontinued_at: '2026-07-01T12:00:00Z',
            confirmation: {
              status: 'taken',
              confirmed_at: '2020-01-02T13:05:00Z',
              confirmed_by: 'u1',
            },
          })}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: 'Mark taken' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Skip dose' })).toBeNull();
    });

    it('an auto-missed dose still asks — the cron wrote that row, no human did', () => {
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={makeMed({
            ...PAST_DOSE,
            discontinued_at: '2026-07-01T12:00:00Z',
            confirmation: {
              status: 'missed',
              confirmed_at: '2020-01-02T13:05:00Z',
              confirmed_by: 'system',
            },
          })}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: 'Mark taken' })).toBeInTheDocument();
    });

    it('a dose whose DAY has not arrived in the care recipient timezone offers no controls', () => {
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={makeMed({ scheduled_date: '2999-01-01', scheduled_time: '08:00:00' })}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: 'Mark taken' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Skip dose' })).toBeNull();
    });

    // ======================================================================
    // TIMING — `isDoseConfirmable`, the ported mobile predicate.
    // A day-granularity check ("has the dose's day arrived?") was not enough:
    // at noon it put a live Mark taken on an 8 PM dose, and confirming a dose
    // that has not happened falsifies the adherence record a clinician reads.
    // The pair now opens DOSE_EARLY_CONFIRM_WINDOW_MINUTES (2h) early.
    // Time is pinned with fake Date timers so nothing depends on the runner's
    // clock (the dev machine is America/Denver).
    // ======================================================================
    describe('confirm window', () => {
      // 2026-08-05 16:07 UTC = 12:07 PM in New York, same calendar day.
      const NOON_ET = new Date('2026-08-05T16:07:00Z');
      const TZ = 'America/New_York';

      function renderAt(now: Date, event: CalendarEvent): { unmount: () => void } {
        vi.useFakeTimers({ toFake: ['Date'], now });
        return render(
          <EventDetailActions
            circleId="circle-1"
            careRecipientTimezone={TZ}
            onConfirmDose={vi.fn()}
            event={event}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onDiscontinue={vi.fn()}
          />
        );
      }

      afterEach(() => {
        vi.useRealTimers();
      });

      it('offers NO controls for a dose 8 hours out today — the day arriving is not enough', () => {
        renderAt(NOON_ET, makeMed({ scheduled_date: '2026-08-05', scheduled_time: '20:00:00' }));

        expect(screen.queryByRole('button', { name: 'Mark taken' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Skip dose' })).toBeNull();
      });

      it('offers the pair once the dose is inside the 2h window', () => {
        renderAt(NOON_ET, makeMed({ scheduled_date: '2026-08-05', scheduled_time: '13:00:00' }));

        expect(screen.getByRole('button', { name: 'Mark taken' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Skip dose' })).toBeInTheDocument();
      });

      it('opens exactly at scheduled_time − 2h and not a minute earlier', () => {
        // Boundary for 12:07 PM is a 14:07 dose.
        const atBoundary = renderAt(
          NOON_ET,
          makeMed({ scheduled_date: '2026-08-05', scheduled_time: '14:07:00' })
        );
        expect(screen.getByRole('button', { name: 'Mark taken' })).toBeInTheDocument();
        atBoundary.unmount();

        renderAt(NOON_ET, makeMed({ scheduled_date: '2026-08-05', scheduled_time: '14:08:00' }));
        expect(screen.queryByRole('button', { name: 'Mark taken' })).toBeNull();
      });

      it('keeps the pair on an overdue dose earlier the same day', () => {
        renderAt(NOON_ET, makeMed({ scheduled_date: '2026-08-05', scheduled_time: '08:00:00' }));

        expect(screen.getByRole('button', { name: 'Mark taken' })).toBeInTheDocument();
      });

      // The window is measured in the CARE RECIPIENT's timezone. Same instant,
      // same dose, opposite answers.
      it('the care recipient timezone decides, never the viewer clock', () => {
        // 2026-08-05 01:30 UTC = 21:30 on 08-04 in NY, 19:30 on 08-04 in Denver.
        const instant = new Date('2026-08-05T01:30:00Z');
        const dose = makeMed({ scheduled_date: '2026-08-04', scheduled_time: '22:00:00' });

        vi.useFakeTimers({ toFake: ['Date'], now: instant });
        const ny = render(
          <EventDetailActions
            circleId="circle-1"
            careRecipientTimezone="America/New_York"
            onConfirmDose={vi.fn()}
            event={dose}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onDiscontinue={vi.fn()}
          />
        );
        // 30 minutes away in New York → open.
        expect(screen.getByRole('button', { name: 'Mark taken' })).toBeInTheDocument();
        ny.unmount();

        render(
          <EventDetailActions
            circleId="circle-1"
            careRecipientTimezone="America/Denver"
            onConfirmDose={vi.fn()}
            event={dose}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onDiscontinue={vi.fn()}
          />
        );
        // 2.5 hours away in Denver → still closed.
        expect(screen.queryByRole('button', { name: 'Mark taken' })).toBeNull();
      });

      // isDoseConfirmable allows a TIMELESS dose on its own day, but the
      // confirm endpoint requires a scheduled_time — this surface keeps that
      // guard alongside the predicate.
      it('an all-day medication row is still never confirmable here', () => {
        renderAt(NOON_ET, makeMed({ scheduled_date: '2026-08-05', scheduled_time: null }));

        expect(screen.queryByRole('button', { name: 'Mark taken' })).toBeNull();
      });
    });

    it('tasks and appointments never render dose controls — Complete is their verb', () => {
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={makeMed({
            ...PAST_DOSE,
            id: 't-3',
            event_type: 'task',
            title: 'Pick up prescription',
            medication_name: null,
            medication_dosage: null,
          })}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      expect(screen.queryByRole('button', { name: 'Mark taken' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
    });

    it('ES: the dose controls render in Spanish', async () => {
      await i18n.changeLanguage('es');

      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={makeMed({ ...PAST_DOSE, discontinued_at: '2026-07-01T12:00:00Z' })}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: 'Marcar como tomada' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Omitir dosis' })).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // FOOTER CONVENTION (M2) — one filled button, last in DOM order; Delete
  // never renders filled at rest, whether it's inline (the solo-overflow
  // case) or inside the MoreMenu.
  // ==========================================================================
  describe('footer convention', () => {
    // Exact token match, not a substring regex: `bg-moss` and `bg-terracotta-soft`
    // are the two "filled" background utilities, but a ghost (destructive or
    // not) button's `hover:bg-moss-soft` class ALSO satisfies a naive
    // `/\bbg-moss\b/` (the word boundary sits right before the trailing
    // `-soft`), which would misclassify every ghost button as filled.
    const FILLED_CLASSES = new Set(['bg-moss', 'bg-terracotta-soft']);
    function isFilled(button: HTMLElement): boolean {
      return button.className.split(/\s+/).some((cls) => FILLED_CLASSES.has(cls));
    }
    function filledButtons(): HTMLElement[] {
      return screen.getAllByRole('button').filter(isFilled);
    }

    // RULING: the filled button is last among inline ACTION buttons (Skip
    // dose, Mark taken/complete) — the More trigger is not an action, it sits
    // at the right edge AFTER it, so `[Skip] [Mark taken ●] [More ▾]` is
    // correct as-is.
    //
    // The filled button must therefore be the LAST inline button: either the
    // very last button in the footer (no overflow menu), or the button
    // immediately before the More trigger (which must then itself be last of
    // all). Checking only "nothing after it reads More" would pass even if
    // the trigger were moved BEFORE the filled button, since there'd be
    // nothing left to fail on — this checks adjacency instead.
    function expectFilledIsLastAction(filled: HTMLElement): void {
      const buttons = screen.getAllByRole('button');
      const moreIndex = buttons.findIndex((b) => b.getAttribute('aria-haspopup') === 'menu');
      if (moreIndex === -1) {
        expect(buttons[buttons.length - 1]).toBe(filled);
      } else {
        expect(moreIndex).toBe(buttons.length - 1);
        expect(buttons[moreIndex - 1]).toBe(filled);
      }
    }

    it('a medication dose in its confirm window renders exactly one filled button (Mark taken), last before the More trigger', () => {
      const activeDose = makeMed({ scheduled_date: '2020-01-02', scheduled_time: '08:00:00' });
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={activeDose}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      const filled = filledButtons();
      expect(filled).toHaveLength(1);
      expect(filled[0]).toHaveTextContent('Mark taken');
      expectFilledIsLastAction(filled[0]);
    });

    it('an open task renders exactly one filled button (Mark complete), last before the More trigger', () => {
      const openTask = makeMed({
        id: 't-open',
        event_type: 'task',
        title: 'Pick up prescription',
        medication_name: null,
        medication_dosage: null,
        completed_at: null,
      });
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={openTask}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      const filled = filledButtons();
      expect(filled).toHaveLength(1);
      expect(filled[0]).toHaveTextContent('Mark complete');
      expectFilledIsLastAction(filled[0]);
    });

    it('a completed task has NO filled button, and its solo Delete renders as a destructive ghost, never filled', () => {
      const completedTask = makeMed({
        id: 't-done',
        event_type: 'task',
        title: 'Pick up prescription',
        medication_name: null,
        medication_dosage: null,
        completed_at: '2026-07-29T15:00:00Z',
      });
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={completedTask}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      expect(filledButtons()).toHaveLength(0);
      const deleteButton = screen.getByRole('button', { name: 'Delete' });
      expect(deleteButton.className).toContain('text-terracotta-deep');
      expect(isFilled(deleteButton)).toBe(false);
    });

    it('for a medication, Delete lives inside the overflow menu and never renders filled', async () => {
      const user = userEvent.setup();
      const active = makeMed();
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={active}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      // Never rendered as a direct footer button — only inside the menu.
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
      await openMore(user);
      const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
      expect(deleteItem.className).toContain('text-terracotta-deep');
    });
  });
});
