import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clickTwice, neverSettles } from '@/test/doubleSubmit';
import i18n from '@/i18n';
import { Analytics } from '@/lib/analytics';
import type { CalendarEvent } from '@/api/calendarEvents';
import { DeleteEventDialog } from '../DeleteEventDialog';

const CIRCLE_ID = 'circle-1';
/**
 * `calendar:deleteMedication.deleted` — the success path's toast for the
 * default fixture (a medication).
 */
const DELETED_TOAST = 'Medication deleted';

const mutateDelete = vi.fn();
// Mutable so a test can render mid-delete without a real unresolved promise:
// the ConfirmDialog `loading` prop only cares about this flag, not about
// mutateAsync's actual settlement.
let deleteIsPending = false;
vi.mock('@/hooks/useCalendarEvents', () => ({
  useDeleteEvent: () => ({ mutateAsync: mutateDelete, isPending: deleteIsPending }),
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
  deleteIsPending = false;
});

describe('DeleteEventDialog', () => {
  it('non-recurring: simple confirm → delete with NO scope params', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <DeleteEventDialog
        circleId={CIRCLE_ID}
        event={makeEvent()}
        surface="calendar"
        onClose={onClose}
      />
    );

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
        surface="calendar"
        onClose={vi.fn()}
      />
    );

    // 3-way choice present; default is "this dose only".
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    await user.click(screen.getByLabelText('This and all future doses'));
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));
    // Scoped delete targets the PARENT series + passes the instance date.
    expect(mutateDelete).toHaveBeenCalledWith({
      eventId: 'parent-7',
      deleteScope: 'future',
      scheduledDate: '2026-06-20',
    });
  });

  it('recurring: default scope is "single" (this dose only)', async () => {
    const user = userEvent.setup();
    render(
      <DeleteEventDialog
        circleId={CIRCLE_ID}
        event={makeEvent({
          parent_event_id: 'parent-7',
          recurrence_rule: 'weekly',
          scheduled_date: '2026-06-20',
        })}
        surface="calendar"
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

  // Every item type names itself — a medication dialog never says "event"
  // (matches mobile). Title, both scope options and the success toast are
  // per-type; messages / scope label / buttons stay shared.
  describe('per-type copy', () => {
    const RECURRING = {
      parent_event_id: 'parent-7',
      recurrence_rule: 'weekly',
      scheduled_date: '2026-06-20',
    } as const;

    const CASES = [
      {
        type: 'medication',
        overrides: {},
        title: 'Delete medication',
        single: 'This dose only',
        future: 'This and all future doses',
        toast: 'Medication deleted',
      },
      {
        type: 'task',
        overrides: { event_type: 'task', medication_name: undefined, title: 'Pick up refills' },
        title: 'Delete task',
        single: 'This task only',
        future: 'This and all future tasks',
        toast: 'Task deleted',
      },
      {
        type: 'appointment',
        overrides: {
          event_type: 'appointment',
          medication_name: undefined,
          title: 'Cardiology',
        },
        title: 'Delete appointment',
        single: 'This appointment only',
        future: 'This and all future appointments',
        toast: 'Appointment deleted',
      },
    ] as const;

    it.each(CASES)(
      '$type one-off: "$title" title, no "event" wording, "$toast" toast',
      async ({ overrides, title, toast }) => {
        const user = userEvent.setup();
        render(
          <DeleteEventDialog
            circleId={CIRCLE_ID}
            event={makeEvent(overrides as Partial<CalendarEvent>)}
            surface="calendar"
            onClose={vi.fn()}
          />
        );

        const dialog = screen.getByRole('dialog', { name: title });
        expect(dialog.textContent).not.toMatch(/\bevents?\b/i);

        await user.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(showToast).toHaveBeenCalledWith(toast, 'success'));
      }
    );

    it.each(CASES)(
      '$type recurring: "$title" title, "$single" / "$future" scopes, "$toast" toast',
      async ({ overrides, title, single, future, toast }) => {
        const user = userEvent.setup();
        render(
          <DeleteEventDialog
            circleId={CIRCLE_ID}
            event={makeEvent({ ...(overrides as Partial<CalendarEvent>), ...RECURRING })}
            surface="calendar"
            onClose={vi.fn()}
          />
        );

        const dialog = screen.getByRole('dialog', { name: title });
        expect(screen.getByLabelText(single)).toBeInTheDocument();
        expect(screen.getByLabelText(future)).toBeInTheDocument();
        expect(dialog.textContent).not.toMatch(/\bevents?\b/i);

        await user.click(screen.getByLabelText(future));
        await user.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() =>
          expect(mutateDelete).toHaveBeenCalledWith({
            eventId: 'parent-7',
            deleteScope: 'future',
            scheduledDate: '2026-06-20',
          })
        );
        expect(showToast).toHaveBeenCalledWith(toast, 'success');
      }
    );

    // PK20 — the backend now serves this exact request with a tombstone (HTTP
    // 200) for tasks and appointments too. Pins the CLIENT half of the contract:
    // the default "This <type> only" sends the SERIES ROOT id, deleteScope
    // 'single' and the occurrence's OWN date, and the success toast is the
    // per-type one (never the generic save error).
    it.each(CASES.filter((c) => c.type !== 'medication'))(
      '$type "$single": mutateAsync({ eventId: <root>, deleteScope: single, scheduledDate }) → "$toast" toast',
      async ({ overrides, single, toast }) => {
        const user = userEvent.setup();
        render(
          <DeleteEventDialog
            circleId={CIRCLE_ID}
            event={makeEvent({
              ...(overrides as Partial<CalendarEvent>),
              ...RECURRING,
              id: 'occurrence-child',
            })}
            surface="calendar"
            onClose={vi.fn()}
          />
        );

        expect(screen.getByLabelText(single)).toBeChecked();
        await user.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));
        expect(mutateDelete).toHaveBeenCalledWith({
          eventId: 'parent-7',
          deleteScope: 'single',
          scheduledDate: '2026-06-20',
        });
        expect(showToast).toHaveBeenCalledWith(toast, 'success');
        expect(showToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
      }
    );

    it('an unknown event_type falls back to the generic event wording', async () => {
      const user = userEvent.setup();
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent({
            event_type: 'something_new' as CalendarEvent['event_type'],
            medication_name: undefined,
            title: 'Mystery',
          })}
          surface={null}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByRole('dialog', { name: 'Delete event' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(showToast).toHaveBeenCalledWith('Event deleted', 'success'));
    });
  });

  // M2 — both the non-recurring and recurring paths now render through the
  // SAME `ConfirmDialog` (one dialog, one heading, one footer shape: a
  // full-width terracotta confirm over a full-width secondary cancel) instead
  // of the recurring path hand-rolling its own Modal + footer.
  describe('unified ConfirmDialog footer shape', () => {
    it('non-recurring: one heading, and a terracotta Delete over a secondary Cancel', async () => {
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent()}
          surface="calendar"
          onClose={vi.fn()}
        />
      );

      expect(screen.getAllByRole('heading')).toHaveLength(1);
      const deleteButton = screen.getByRole('button', { name: 'Delete' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      expect(deleteButton.className).toContain('bg-terracotta-soft');
      expect(cancelButton.className).toContain('bg-bg-2');
      expect(cancelButton.className).not.toMatch(/\bbg-(moss|terracotta-soft)\b/);
    });

    it('recurring: also one heading, and the identical terracotta/secondary footer shape', () => {
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent({
            parent_event_id: 'parent-7',
            recurrence_rule: 'weekly',
            scheduled_date: '2026-06-20',
          })}
          surface="calendar"
          onClose={vi.fn()}
        />
      );

      // The dialog's own title is the ONLY heading — the scope RadioGroup's
      // label is a plain <span>, not a second heading repeating "Delete
      // medication".
      expect(screen.getAllByRole('heading')).toHaveLength(1);
      const deleteButton = screen.getByRole('button', { name: 'Delete' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      expect(deleteButton.className).toContain('bg-terracotta-soft');
      expect(cancelButton.className).toContain('bg-bg-2');

      // The scope picker gets its OWN label — "What should be deleted?" —
      // rather than reusing the dialog title as its accessible name.
      expect(
        screen.getByRole('radiogroup', { name: 'What should be deleted?' })
      ).toBeInTheDocument();
    });
  });

  // M2 follow-up — both paths now go through ConfirmDialog's `loading` prop
  // (not `confirmDisabled`), which disables BOTH buttons and swaps the
  // confirm label. `confirmDisabled` alone left Cancel clickable mid-delete;
  // this restores the guard HEAD had on both paths.
  describe('disabled mid-delete', () => {
    it('non-recurring: Cancel is disabled and the confirm label swaps to "Deleting…" while pending', () => {
      deleteIsPending = true;
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent()}
          surface="calendar"
          onClose={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });

    it('recurring: Cancel is also disabled and the confirm label swaps while pending', () => {
      deleteIsPending = true;
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent({
            parent_event_id: 'parent-7',
            recurrence_rule: 'weekly',
            scheduled_date: '2026-06-20',
          })}
          surface="calendar"
          onClose={vi.fn()}
        />
      );

      expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });
  });
  // ──────────────────────────────────────────────────────────────────────────
  // DOUBLE CONFIRM. `loading={deleteEvent.isPending}` disables the button a
  // render AFTER the click that started the delete, so two clicks in the SAME
  // tick both fired a DELETE. That matters most on the recurring branch:
  // delete-one-occurrence is one of the three backend routes that write against
  // the partial unique index with NO 23505 recovery, so the losing racer is
  // answered with a 500 over a delete that already succeeded — and the user is
  // shown a failure for an action that worked.
  //
  // `clickTwice`, not two awaited `userEvent.click`s: userEvent commits a
  // render between interactions, so the button would already be disabled and
  // the test would prove nothing.
  //
  // …and a TURN between the two clicks, not only the synchronous pair. Two
  // clicks inside one tick are blocked by the shell's ref whatever this dialog
  // does with the request — nothing runs between them to release it. What the
  // dialog owes is that the guard OUTLIVES the tick: `runDelete` has to AWAIT
  // `mutateAsync`, so ConfirmDialog holds the ref for the whole request. A
  // `void mutateAsync(...)` resolves `runDelete` at once, releases the ref on
  // the next microtask, and a second click that lands after it (the request
  // still in flight, `isPending` not yet rendered) sends a second DELETE. A
  // same-tick-only test passes over that defect.
  // ──────────────────────────────────────────────────────────────────────────
  describe('double confirm', () => {
    function click(element: HTMLElement): void {
      element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    /** A request the test settles by hand. */
    function deferred(): { promise: Promise<void>; resolve: () => void } {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    /**
     * THE GUARD MUST BE HELD BY THE REQUEST, NOT BY THE CLOCK.
     *
     * A turn between the clicks is not enough: a dialog that released after a
     * fixed cooldown (`setTimeout(release, 300)`) instead of awaiting the
     * DELETE passed that version of this test. So the request is held pending
     * while fake time runs far past any plausible cooldown (5s), the second
     * click must still send nothing, and only settling the REQUEST may free the
     * button again — proven by a third click that does go through.
     */
    async function expectGuardHeldForTheWholeRequest(expectedCall: unknown): Promise<void> {
      vi.useFakeTimers();
      try {
        const request = deferred();
        mutateDelete.mockImplementationOnce(() => request.promise);
        const confirm = screen.getByRole('button', { name: 'Delete' });

        await act(async () => {
          click(confirm);
        });
        expect(mutateDelete).toHaveBeenCalledTimes(1);
        expect(mutateDelete).toHaveBeenLastCalledWith(expectedCall);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });
        await act(async () => {
          click(confirm);
        });
        // Still in flight after 5s: the second press sends NOTHING.
        expect(mutateDelete).toHaveBeenCalledTimes(1);

        // The request settles; the dialog runs its success path (it stays
        // mounted: `onClose` is a spy here, not a parent that unmounts it)…
        await act(async () => {
          request.resolve();
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(showToast).toHaveBeenCalledWith(DELETED_TOAST, 'success');

        // …and only now is the guard free again.
        await act(async () => {
          click(confirm);
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(mutateDelete).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    }

    it('one-off: two clicks in one tick send ONE delete', async () => {
      mutateDelete.mockImplementation(() => neverSettles());
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent()}
          surface="calendar"
          onClose={vi.fn()}
        />
      );

      await clickTwice(screen.getByRole('button', { name: 'Delete' }));

      expect(mutateDelete).toHaveBeenCalledTimes(1);
    });

    it('one-off: a second click 5s later, request still pending, sends nothing; settling frees it', async () => {
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent()}
          surface="calendar"
          onClose={vi.fn()}
        />
      );

      await expectGuardHeldForTheWholeRequest({ eventId: 'ev-1' });
    });

    it('recurring occurrence: a second click 5s later, request still pending, sends nothing; settling frees it', async () => {
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent({
            parent_event_id: 'parent-7',
            recurrence_rule: 'weekly',
            scheduled_date: '2026-06-20',
          })}
          surface="calendar"
          onClose={vi.fn()}
        />
      );

      await expectGuardHeldForTheWholeRequest({
        eventId: 'parent-7',
        deleteScope: 'single',
        scheduledDate: '2026-06-20',
      });
    });

    it('recurring occurrence: two clicks in one tick send ONE scoped delete', async () => {
      mutateDelete.mockImplementation(() => neverSettles());
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent({
            parent_event_id: 'parent-7',
            recurrence_rule: 'weekly',
            scheduled_date: '2026-06-20',
          })}
          surface="calendar"
          onClose={vi.fn()}
        />
      );

      await clickTwice(screen.getByRole('button', { name: 'Delete' }));

      expect(mutateDelete).toHaveBeenCalledTimes(1);
      expect(mutateDelete).toHaveBeenCalledWith({
        eventId: 'parent-7',
        deleteScope: 'single',
        scheduledDate: '2026-06-20',
      });
    });

    it('a FAILED delete can be retried — the guard is not latched', async () => {
      mutateDelete.mockRejectedValue(new Error('500'));
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent()}
          surface="calendar"
          onClose={vi.fn()}
        />
      );

      const confirm = screen.getByRole('button', { name: 'Delete' });
      await clickTwice(confirm);
      await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));

      await clickTwice(confirm);
      await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(2));
    });
  });

  // Test-gap audit #1 (2026-09-29): a Meds page CARD passes its group's
  // representative — the series ROOT, dated its START day. With the dose picker
  // that anchored every scope on the start date: "future" erased the whole med
  // and every recorded dose, "single" erased the start-date dose. A card now
  // passes doseScoped=false → whole-medication confirm, no scope, no date.
  describe('doseScoped=false (Meds page card — whole medication)', () => {
    // The card's representative: a recurring ROOT whose date is the start day.
    const cardRoot = (): CalendarEvent =>
      makeEvent({ id: 'root-7', recurrence_rule: 'daily', scheduled_date: '2026-06-01' });

    afterEach(async () => {
      if (i18n.language !== 'en') await i18n.changeLanguage('en');
    });

    it('a recurring root: no scope picker, whole-med copy + Discontinue hint, ONE scope-less DELETE of the root', async () => {
      const user = userEvent.setup();
      const spy = vi.spyOn(Analytics, 'medicationDeleted');
      const onClose = vi.fn();
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={cardRoot()}
          surface="meds_tab"
          doseScoped={false}
          onClose={onClose}
        />
      );

      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
      expect(screen.queryAllByRole('radio')).toHaveLength(0);
      expect(screen.getByRole('heading', { name: 'Delete medication' })).toBeInTheDocument();
      expect(
        screen.getByText(
          'Delete "Metformin"? It will be removed from your medication list and its reminders will stop. Doses already recorded stay in adherence reports. This can\'t be undone.'
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'To keep it in your Inactive list so you can turn it back on later, use Discontinue instead.'
        )
      ).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));
      // EXACT shape: the series id alone — no deleteScope, no scheduledDate.
      expect(mutateDelete.mock.calls[0]).toEqual([{ eventId: 'root-7' }]);
      expect(spy).toHaveBeenCalledWith(CIRCLE_ID, { surface: 'meds_tab', scope: 'series' });
      expect(onClose).toHaveBeenCalled();
      spy.mockRestore();
    });

    // PK3: a whole-med delete that kept recorded doses answers history_kept; the client
    // reports it to analytics, says the normal "deleted" toast, and closes (the med is gone
    // from every list server-side; no extra UI).
    it('reports history_kept to analytics when the server kept the recorded doses', async () => {
      const user = userEvent.setup();
      const spy = vi.spyOn(Analytics, 'medicationDeleted');
      mutateDelete.mockResolvedValueOnce({ historyKept: true });
      const onClose = vi.fn();
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={cardRoot()}
          surface="meds_tab"
          doseScoped={false}
          onClose={onClose}
        />
      );
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(spy).toHaveBeenCalledWith(CIRCLE_ID, {
        surface: 'meds_tab',
        scope: 'series',
        historyKept: true,
      });
      spy.mockRestore();
    });

    it('a child/instance row resolves to its series root (parent_event_id), still with no date', async () => {
      const user = userEvent.setup();
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={makeEvent({
            id: 'child-3',
            parent_event_id: 'root-7',
            recurrence_rule: 'daily',
            scheduled_date: '2026-06-20',
          })}
          surface="meds_tab"
          doseScoped={false}
          onClose={vi.fn()}
        />
      );
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(mutateDelete).toHaveBeenCalledTimes(1));
      expect(mutateDelete.mock.calls[0]).toEqual([{ eventId: 'root-7' }]);
    });

    it('Spanish: whole-med copy + hint naming web\'s «Suspender» action', async () => {
      await i18n.changeLanguage('es');
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={cardRoot()}
          surface="meds_tab"
          doseScoped={false}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByRole('heading', { name: 'Eliminar medicamento' })).toBeInTheDocument();
      expect(
        screen.getByText(
          '¿Eliminar "Metformin"? Se quitará de tu lista de medicamentos y se detendrán sus recordatorios. Las dosis ya registradas se conservan en los reportes de adherencia. Esta acción no se puede deshacer.'
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Para conservarlo en tu lista de inactivos y poder reactivarlo después, usa «Suspender».'
        )
      ).toBeInTheDocument();
      expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    });

    it('default (doseScoped omitted) keeps the calendar per-dose picker and never shows the card hint', () => {
      render(
        <DeleteEventDialog
          circleId={CIRCLE_ID}
          event={cardRoot()}
          surface="calendar"
          onClose={vi.fn()}
        />
      );
      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
      expect(
        screen.queryByText(
          'To keep it in your Inactive list so you can turn it back on later, use Discontinue instead.'
        )
      ).not.toBeInTheDocument();
    });
  });
});
