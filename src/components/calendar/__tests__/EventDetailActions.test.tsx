import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { Modal } from '@/components/ui';
import { clickTwice, neverSettles } from '@/test/doubleSubmit';
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

/**
 * ANCHOR for the "this dose offers NO confirm controls" assertions below.
 *
 * `queryByRole(...)` returns null just as readily for a component that rendered
 * NOTHING as for one that deliberately withheld a control, so an absence
 * assertion on its own reads green when the whole action bar fails to render —
 * and what those four tests guard is a permission-and-timing gate on a MEDICAL
 * action (logging a dose against the adherence record a clinician reads). Every
 * medication this component renders carries the overflow menu (Edit +
 * Discontinue/Reactivate + Delete, three items), so a `getBy*` for it THROWS
 * when the bar is missing. Same pattern as `sidebarAssistant()` in
 * `AppLayout.aiGate.test.tsx`.
 */
function medicationActionBar(): HTMLElement {
  return screen.getByRole('button', { name: 'More' });
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

  // ──────────────────────────────────────────────────────────────────────────
  // WHICH OCCURRENCE IS BEING COMPLETED
  //
  // `completed_at` lives on a ROW, and one row is one occurrence. A recurring
  // series' later occurrences are VIRTUAL — the backend synthesises them with a
  // composite id (`${parentId}_${date}`, `is_virtual: true`) that matches no
  // `id` column — so this modal has to address the ROOT and name the day. Post
  // `event.id` and a virtual occurrence can only 404; post the root with no
  // date and the server stamps the series' FIRST day, which is the production
  // bug (14 mis-stamped series across 7 households).
  //
  // These assert the mutation's ARGUMENTS, not that a button rendered.
  // ──────────────────────────────────────────────────────────────────────────
  describe('completing an occurrence of a recurring series', () => {
    async function clickComplete(event: CalendarEvent): Promise<void> {
      const user = userEvent.setup();
      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={event}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );
      await user.click(screen.getByRole('button', { name: 'Mark complete' }));
      await waitFor(() => expect(completeMutateAsync).toHaveBeenCalledTimes(1));
    }

    it('a VIRTUAL occurrence posts the ROOT id plus its own date', async () => {
      await clickComplete(
        makeMed({
          // Exactly what generateVirtualInstances emits.
          id: 'parent-1_2026-08-06',
          parent_event_id: 'parent-1',
          is_virtual: true,
          event_type: 'task',
          title: 'Water the plants',
          medication_name: null,
          medication_dosage: null,
          scheduled_date: '2026-08-06',
          completed_at: null,
        })
      );

      expect(completeMutateAsync).toHaveBeenCalledWith({
        eventId: 'parent-1',
        scheduledDate: '2026-08-06',
      });
    });

    // A MATERIALIZED CHILD IS ITS OWN OCCURRENCE — POST ITS OWN ID.
    //
    // This test used to assert the opposite (root + date), on the theory that
    // the server always resolves a root+date back to the same child row. It
    // does not: that resolution is gated on the addressed row STILL RECURRING
    // (`backend/src/routes/calendarEvents.ts`:
    // `if (addressed.recurrence_rule && !addressed.parent_event_id)`). Clear
    // the rule on the series — "Repeat: Never" in the editor — and the whole
    // block is skipped, leaving `targetEventId = eventId`: the PARENT row, on
    // a DIFFERENT DAY, is stamped completed while the occurrence the caregiver
    // pressed stays open. `pruneOffPatternFutureChildren` deletes only FUTURE
    // off-pattern children, so past materialized children survive that edit and
    // the calendar keeps rendering them — this is reachable, not theoretical.
    //
    // `is_virtual` is the discriminator, not "does it have a parent_event_id".
    // A virtual instance has no row to address; a physical one is the row.
    it('a PHYSICAL child is addressed by its OWN id, with no date', async () => {
      await clickComplete(
        makeMed({
          id: 'child-0806',
          parent_event_id: 'parent-1',
          // Not virtual: the backend materialized this row and sent it as-is.
          is_virtual: false,
          event_type: 'task',
          title: 'Water the plants',
          medication_name: null,
          medication_dosage: null,
          scheduled_date: '2026-08-06',
          completed_at: null,
        })
      );

      expect(completeMutateAsync).toHaveBeenCalledWith({
        eventId: 'child-0806',
        scheduledDate: undefined,
      });
    });

    it('a child row with is_virtual ABSENT is still treated as physical', async () => {
      // `is_virtual` is optional on the wire (`api/calendarEvents.ts`) and the
      // list response omits it for real rows. Absent must mean physical —
      // reading it as "unknown, assume virtual" reinstates the parent-stamping
      // bug for every row the backend does not bother to flag.
      await clickComplete(
        makeMed({
          id: 'child-0807',
          parent_event_id: 'parent-1',
          event_type: 'task',
          title: 'Water the plants',
          medication_name: null,
          medication_dosage: null,
          scheduled_date: '2026-08-07',
          completed_at: null,
        })
      );

      expect(completeMutateAsync).toHaveBeenCalledWith({
        eventId: 'child-0807',
        scheduledDate: undefined,
      });
    });

    it('a ONE-OFF task sends NO date — the request shipped clients make', async () => {
      await clickComplete(
        makeMed({
          id: 't-solo',
          parent_event_id: null,
          event_type: 'task',
          title: 'Pick up prescription',
          medication_name: null,
          medication_dosage: null,
          scheduled_date: '2026-08-06',
          completed_at: null,
        })
      );

      // `scheduledDate: undefined`, so `completeEvent` sends no body at all.
      expect(completeMutateAsync).toHaveBeenCalledWith({
        eventId: 't-solo',
        scheduledDate: undefined,
      });
    });

    it("a series ROOT on its own start date sends no date either", async () => {
      // The root IS that day's occurrence (`parent_event_id` null), so there is
      // nothing to disambiguate and the request stays body-less.
      await clickComplete(
        makeMed({
          id: 'parent-1',
          parent_event_id: null,
          recurrence_rule: 'daily',
          event_type: 'task',
          title: 'Water the plants',
          medication_name: null,
          medication_dosage: null,
          scheduled_date: '2026-08-01',
          completed_at: null,
        })
      );

      expect(completeMutateAsync).toHaveBeenCalledWith({
        eventId: 'parent-1',
        scheduledDate: undefined,
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // THE COMPLETION MUST SHOW WITHOUT A CLOSE/REOPEN.
  //
  // `event` is a SNAPSHOT the parent set once, when the detail modal opened.
  // Before this fix a successful completion changed nothing on screen: Mark
  // complete stayed live (offering to complete an already-stamped row), a
  // completed task kept its Edit affordance, and the modal's "Completed on"
  // row — drawn by the PARENT from the same object — never appeared. The
  // caregiver read a working write as a broken one and clicked again.
  //
  // Two halves, mirroring the WA6 reactivate precedent above:
  //   - this component's own local override (its buttons), and
  //   - `onCompleted`, carrying the SERVER'S ROW up so the parent can restamp
  //     its snapshot. The row matters: completing a virtual occurrence past
  //     the materializer horizon CREATES a physical row whose id the client
  //     has never seen, so no cache entry under the posted (root) id can
  //     describe it.
  // ──────────────────────────────────────────────────────────────────────────
  describe('reflecting the completion in place', () => {
    const openTask = (overrides: Partial<CalendarEvent> = {}): CalendarEvent =>
      makeMed({
        id: 't-solo',
        event_type: 'task',
        title: 'Pick up prescription',
        medication_name: null,
        medication_dosage: null,
        parent_event_id: null,
        completed_at: null,
        ...overrides,
      });

    it('a PHYSICAL row: Mark complete disappears the moment the write lands', async () => {
      const user = userEvent.setup();
      completeMutateAsync.mockResolvedValue({
        ...openTask(),
        completed_at: '2026-07-29T15:00:00Z',
        completed_by: 'u-9',
      });

      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={openTask()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Mark complete' }));

      // NO re-render from a new `event` prop — the parent still holds the old
      // snapshot, exactly as it does in production.
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull()
      );
      // ...and completion is terminal, so the task's Edit is gone too, which
      // leaves Delete as the sole secondary action rendered inline (no menu).
      expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });

    it('a PHYSICAL row: onCompleted hands the parent the stamped row', async () => {
      const user = userEvent.setup();
      const onCompleted = vi.fn();
      completeMutateAsync.mockResolvedValue({
        ...openTask(),
        completed_at: '2026-07-29T15:00:00Z',
        completed_by: 'u-9',
      });

      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={openTask()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
          onCompleted={onCompleted}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Mark complete' }));

      await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
      expect(onCompleted.mock.calls[0][0]).toMatchObject({
        completed_at: '2026-07-29T15:00:00Z',
        completed_by: 'u-9',
      });
    });

    it('a VIRTUAL occurrence: onCompleted carries the NEWLY CREATED row, not the posted root', async () => {
      const user = userEvent.setup();
      const onCompleted = vi.fn();
      const virtual = openTask({
        // Exactly what generateVirtualInstances emits: a composite id matching
        // no `id` column, beyond the materializer's 3-day horizon.
        id: 'parent-1_2026-08-06',
        parent_event_id: 'parent-1',
        is_virtual: true,
        scheduled_date: '2026-08-06',
      });
      // The server materialized the day: a BRAND-NEW physical row, an id the
      // client has never seen, under no cache key it could have invalidated.
      completeMutateAsync.mockResolvedValue({
        ...virtual,
        id: 'child-created-0806',
        is_virtual: false,
        completed_at: '2026-08-06T14:00:00Z',
        completed_by: 'u-9',
      });

      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={virtual}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
          onCompleted={onCompleted}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Mark complete' }));

      // The request shape is unchanged — root + date.
      await waitFor(() =>
        expect(completeMutateAsync).toHaveBeenCalledWith({
          eventId: 'parent-1',
          scheduledDate: '2026-08-06',
        })
      );
      await waitFor(() => expect(onCompleted).toHaveBeenCalledTimes(1));
      // The completion read off the RESPONSE, whose id is the new row's.
      expect(onCompleted.mock.calls[0][0]).toMatchObject({
        id: 'child-created-0806',
        completed_at: '2026-08-06T14:00:00Z',
      });
      // ...and this component's own action set already reflects it.
      expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    });

    it('a FAILED completion leaves Mark complete live — nothing is stamped optimistically', async () => {
      const user = userEvent.setup();
      const onCompleted = vi.fn();
      completeMutateAsync.mockRejectedValue(new Error('403'));

      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={openTask()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
          onCompleted={onCompleted}
        />
      );

      await user.click(screen.getByRole('button', { name: 'Mark complete' }));

      await waitFor(() => expect(completeMutateAsync).toHaveBeenCalledTimes(1));
      expect(onCompleted).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Mark complete' })).toBeInTheDocument();
    });

    // WCAG 2.4.3 (focus order) / 2.1.2 (no keyboard trap).
    //
    // `disabled={completeEvent.isPending}` lands the instant the request
    // starts, and A BROWSER BLURS AN ELEMENT THE MOMENT IT BECOMES DISABLED.
    // jsdom does not — which is exactly why the test above, and the two
    // success-path tests before it, cannot see this: they never lose focus in
    // the first place. So this test performs the blur the browser would, and
    // then asserts on where focus is once the request FAILS. The success path
    // already recovers (the row's `tabIndex={-1}` landing spot); the failure
    // path re-enabled the button and recovered nothing, leaving focus on
    // `<body>` — and `Modal` binds Escape/Tab as a React `onKeyDown` on its own
    // backdrop div, so from `<body>` Escape stops closing the dialog and the
    // focus trap is dead. Rendering INSIDE a real Modal is the point: bare, as
    // the test above renders it, there is no trap to break.
    it('a FAILED completion puts focus back in the dialog — the browser blurred the disabling button', async () => {
      const user = userEvent.setup();
      let rejectComplete: (reason: unknown) => void = () => {};
      completeMutateAsync.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectComplete = reject;
          })
      );

      render(
        <Modal title="Pick up prescription" onClose={vi.fn()} closeLabel="Close">
          <EventDetailActions
            circleId="circle-1"
            careRecipientTimezone="America/New_York"
            onConfirmDose={vi.fn()}
            event={openTask()}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
            onDiscontinue={vi.fn()}
          />
        </Modal>
      );

      await user.click(screen.getByRole('button', { name: 'Mark complete' }));
      await waitFor(() => expect(completeMutateAsync).toHaveBeenCalledTimes(1));

      // What the browser does, and jsdom does not.
      (document.activeElement as HTMLElement).blur();
      expect(document.body).toHaveFocus();

      await act(async () => {
        rejectComplete(new Error('500'));
      });

      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Mark complete' })).toHaveFocus()
      );
    });
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

      expect(medicationActionBar()).toBeInTheDocument();
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

      expect(medicationActionBar()).toBeInTheDocument();
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

        expect(medicationActionBar()).toBeInTheDocument();
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

        expect(medicationActionBar()).toBeInTheDocument();
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

  // ──────────────────────────────────────────────────────────────────────────
  // FOCUS MUST NOT FALL OUT OF THE DIALOG WHEN "MARK COMPLETE" UNMOUNTS.
  //
  // Mark complete is the FIRST control in this modal that disappears while the
  // modal STAYS OPEN — every other action (Edit, Delete, Discontinue, the dose
  // confirms) closes the detail modal, and Modal's cleanup restores focus to
  // the trigger on the way out (Modal.tsx `previouslyFocused?.focus()`).
  //
  // Here nothing closes. `canComplete` flips false the instant the local stamp
  // commits, React removes the button the user just activated, and focus falls
  // to `document.body`. Modal listens for keys with `onKeyDown` ON THE DIALOG
  // SUBTREE (Modal.tsx), not on `document`, so once focus is on body:
  //   - Escape no longer closes the dialog, and
  //   - the Tab trap is dead — the next Tab lands on the page behind the
  //     backdrop, which is NOT aria-hidden or inert (aria-modal="true" is the
  //     only background suppression the shell has; see Modal.tsx).
  // Modal's focus effect deliberately runs only on open ("re-running would
  // steal focus back mid-edit"). Its recovery would now park focus on the
  // dialog PANEL, which is a floor, not an answer: this row moves focus
  // somewhere that says what changed.
  //
  // This is inherent to the completion rendering at all — wiring only
  // `onCompleted` and dropping the local latch produces the identical unmount.
  // ──────────────────────────────────────────────────────────────────────────
  describe('keyboard focus survives the completion (WCAG 2.4.3 / 2.1.2)', () => {
    const openTask = (): CalendarEvent =>
      makeMed({
        id: 't-solo',
        event_type: 'task',
        title: 'Pick up prescription',
        medication_name: null,
        medication_dosage: null,
        parent_event_id: null,
        completed_at: null,
      });

    // The real composition: EventDetailModal drops this component into the
    // shared Modal's `footer` slot, so the assertions below are about the
    // dialog the caregiver is actually standing in.
    function renderInDialog(onClose: () => void): void {
      render(
        <Modal
          title="Pick up prescription"
          onClose={onClose}
          closeLabel="Close"
          footer={
            <EventDetailActions
              circleId="circle-1"
              careRecipientTimezone="America/New_York"
              onConfirmDose={vi.fn()}
              event={openTask()}
              onEdit={vi.fn()}
              onDelete={vi.fn()}
              onDiscontinue={vi.fn()}
            />
          }
        >
          <p>Task details</p>
        </Modal>
      );
    }

    it('leaves focus inside the dialog after Mark complete unmounts itself', async () => {
      const user = userEvent.setup();
      renderInDialog(vi.fn());

      await user.click(screen.getByRole('button', { name: 'Mark complete' }));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull()
      );

      const dialog = screen.getByRole('dialog');
      expect(document.activeElement).not.toBe(document.body);
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('Escape still closes the dialog after completing — the key handler is on the dialog subtree', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderInDialog(onClose);

      await user.click(screen.getByRole('button', { name: 'Mark complete' }));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull()
      );

      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does NOT park focus on the destructive Delete — completing must not arm a delete', async () => {
      const user = userEvent.setup();
      renderInDialog(vi.fn());

      await user.click(screen.getByRole('button', { name: 'Mark complete' }));
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull()
      );

      expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Delete' }));
    });

    // THE OTHER control this component can retire in place is the reactivate
    // flow's `locallyReactivated`. It does NOT have this trap, and this test
    // is the proof rather than an assumption — it passes without the fix
    // above, because the reactivate happens inside a ConfirmDialog, which is
    // itself a Modal: closing it runs Modal's unmount cleanup
    // (`previouslyFocused?.focus()`), handing focus back to the MoreMenu
    // trigger that opened it — a trigger that still exists, since a reactivated
    // medication still has three overflow items. `locallyReactivated` only
    // relabels a menu item; it unmounts nothing that holds focus.
    it('the reactivate flow does NOT drop focus — its ConfirmDialog restores it on close', async () => {
      const user = userEvent.setup();
      render(
        <Modal
          title="Metformin"
          onClose={vi.fn()}
          closeLabel="Close"
          footer={
            <EventDetailActions
              circleId="circle-1"
              careRecipientTimezone="America/New_York"
              onConfirmDose={vi.fn()}
              event={makeMed({ discontinued_at: '2026-07-01T12:00:00Z' })}
              onEdit={vi.fn()}
              onDelete={vi.fn()}
              onDiscontinue={vi.fn()}
            />
          }
        >
          <p>Medication details</p>
        </Modal>
      );

      await openMore(user);
      await user.click(screen.getByRole('menuitem', { name: 'Edit event' }));
      await user.click(screen.getByRole('button', { name: 'Reactivate' }));

      await waitFor(() => expect(statusMutateAsync).toHaveBeenCalledTimes(1));
      const dialog = screen.getByRole('dialog');
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' }));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // MARK COMPLETE IS A MUTATION-FIRING BUTTON AND NEEDS THE SYNCHRONOUS GUARD.
  //
  // `disabled={completeEvent.isPending}` is the exact pattern
  // `useGuardedSubmit`'s docstring was written to condemn: `isPending` is
  // state, committed a render AFTER the click, so two clicks dispatched in the
  // same tick both re-enter `handleComplete` with the flag still false.
  //
  // The damage is not the second POST (the route resolves it to the same row)
  // — it is that `Analytics.taskCompleted` / `appointmentCompleted` fires
  // twice (useCalendarEvents), and completion counts are this product's
  // retention signal.
  //
  // `clickTwice` dispatches both clicks inside ONE `act()` with no await.
  // Two `userEvent.click()` calls would NOT reproduce this: userEvent awaits,
  // React commits, and the button is disabled before the second click lands —
  // so a state-flag "fix" would pass such a test while the real bug shipped.
  // ──────────────────────────────────────────────────────────────────────────
  describe('double-submit guard on Mark complete', () => {
    it('two clicks in ONE tick post exactly ONE completion', async () => {
      // A request still in flight when the second click arrives — a resolved
      // mock would free the guard on the next microtask and pass for the wrong
      // reason.
      completeMutateAsync.mockReturnValue(neverSettles());

      render(
        <EventDetailActions
          circleId="circle-1"
          careRecipientTimezone="America/New_York"
          onConfirmDose={vi.fn()}
          event={makeMed({
            id: 't-solo',
            event_type: 'task',
            title: 'Pick up prescription',
            medication_name: null,
            medication_dosage: null,
            parent_event_id: null,
            completed_at: null,
          })}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onDiscontinue={vi.fn()}
        />
      );

      await clickTwice(screen.getByRole('button', { name: 'Mark complete' }));

      expect(completeMutateAsync).toHaveBeenCalledTimes(1);
    });
  });
});
