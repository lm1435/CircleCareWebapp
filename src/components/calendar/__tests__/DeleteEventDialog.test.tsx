import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clickTwice, neverSettles } from '@/test/doubleSubmit';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { DeleteEventDialog } from '../DeleteEventDialog';

const CIRCLE_ID = 'circle-1';
/** `calendar:deleteEvent.deleted` — the success path's toast. */
const DELETED_TOAST = 'Event deleted';

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
      // event".
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
});
