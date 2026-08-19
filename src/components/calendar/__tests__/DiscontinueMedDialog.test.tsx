import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { DiscontinueMedDialog } from '../DiscontinueMedDialog';

// Stage 17 — whole-medication semantics: confirming fires exactly ONE
// medication-status mutation carrying `scope: 'medication'`, and the SERVER
// resolves every series root whose med key (normalized name + dosage) matches
// the tapped event. The client no longer enumerates roots from its loaded
// pool — that pool is a calendar window and could miss a sibling series.

const mutateAsync = vi.fn();

vi.mock('@/hooks/useCalendarEvents', () => ({
  useMedicationStatus: () => ({ mutateAsync, isPending: false }),
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
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  } as CalendarEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateAsync.mockResolvedValue({ discontinued: true, affected_count: 1, series_count: 1 });
});

describe('DiscontinueMedDialog', () => {
  it('discontinues the WHOLE medication in ONE scoped mutation, whatever the loaded pool holds', async () => {
    const user = userEvent.setup();
    const morning = makeMed({ id: 'morning' });
    // Same name, dose differs only by whitespace → same medication. It is in
    // the pool here, but nothing about the request depends on that.
    const evening = makeMed({ id: 'evening', medication_dosage: '500 mg' });

    render(
      <DiscontinueMedDialog
        circleId="circle-1"
        event={morning}
        events={[morning, evening]}
        surface="calendar"
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Discontinue' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      eventId: 'morning',
      discontinued: true,
      scope: 'medication',
    });
  });

  it('sends the tapped event PARENT root, and still exactly one mutation', async () => {
    const user = userEvent.setup();
    const child = makeMed({ id: 'child-1', parent_event_id: 'root-1' });

    render(
      <DiscontinueMedDialog
        circleId="circle-1"
        event={child}
        events={[child]}
        surface="calendar"
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Discontinue' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      eventId: 'root-1',
      discontinued: true,
      scope: 'medication',
    });
  });

  // The whole-medication toast used to overclaim (the client had only seen a
  // window); with the server resolving every root it is plainly true.
  it('reports the whole medication in the success toast', async () => {
    const user = userEvent.setup();
    const target = makeMed({ id: 'm-500' });

    render(
      <DiscontinueMedDialog
        circleId="circle-1"
        event={target}
        surface="calendar"
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Discontinue' }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Medication discontinued', 'success'));
  });

  // WA3 regression: `groupInactive` overrides the representative event's own
  // `discontinued_at` when the caller supplies it (MedicationsPage passes the
  // GROUP's aggregate status). Without the override, a discontinued
  // representative event would flip the dialog to "Reactivate" even though
  // the caller says the group is overall active and the user tapped
  // "Discontinue".
  it('groupInactive=false overrides a discontinued representative event — still offers Discontinue', async () => {
    const user = userEvent.setup();
    // The representative event IS discontinued, but the group it represents
    // is overall active (a sibling series is still active).
    const discontinuedRepresentative = makeMed({
      id: 'root-discontinued',
      discontinued_at: '2026-07-01T12:00:00Z',
    });

    render(
      <DiscontinueMedDialog
        circleId="circle-1"
        event={discontinuedRepresentative}
        groupInactive={false}
        surface="calendar"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Discontinue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discontinue' }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        eventId: 'root-discontinued',
        discontinued: true,
        scope: 'medication',
      })
    );
  });

  it('groupInactive=true overrides an active representative event — offers Reactivate', async () => {
    const active = makeMed({ id: 'root-active' });

    render(
      <DiscontinueMedDialog
        circleId="circle-1"
        event={active}
        groupInactive={true}
        surface="calendar"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discontinue' })).not.toBeInTheDocument();
  });

  it('falls back to event.discontinued_at when groupInactive is omitted (single-event callers)', () => {
    const discontinued = makeMed({ id: 'm-1', discontinued_at: '2026-07-01T12:00:00Z' });
    render(
      <DiscontinueMedDialog
        circleId="circle-1"
        event={discontinued}
        surface="calendar"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('reactivates a discontinued med (opposite of current state) and still works without events', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const inactive = makeMed({ id: 'm-1', discontinued_at: '2026-07-01T12:00:00Z' });

    render(
      <DiscontinueMedDialog
        circleId="circle-1"
        event={inactive}
        surface="calendar"
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      eventId: 'm-1',
      discontinued: false,
      scope: 'medication',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
