import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { DiscontinueMedDialog } from '../DiscontinueMedDialog';

// Stage 17 — whole-medication semantics: confirming fires ONE medication-status
// mutation per DISTINCT series root whose med key (normalized name + dosage)
// matches the tapped event. A different dose is a different medication.

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
  mutateAsync.mockResolvedValue({});
});

describe('DiscontinueMedDialog', () => {
  it('discontinues EVERY series of the same med key — two roots → TWO mutations', async () => {
    const user = userEvent.setup();
    const morning = makeMed({ id: 'morning' });
    // Same name, dose differs only by whitespace → same medication.
    const evening = makeMed({ id: 'evening', medication_dosage: '500 mg' });

    render(
      <DiscontinueMedDialog
        circleId="circle-1"
        event={morning}
        events={[morning, evening]}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Discontinue' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2));
    expect(mutateAsync).toHaveBeenCalledWith({ eventId: 'morning', discontinued: true });
    expect(mutateAsync).toHaveBeenCalledWith({ eventId: 'evening', discontinued: true });
  });

  it('leaves a DIFFERENT dose alone — one root → ONE mutation', async () => {
    const user = userEvent.setup();
    const target = makeMed({ id: 'm-500' });
    const otherDose = makeMed({ id: 'm-1000', medication_dosage: '1000mg' });

    render(
      <DiscontinueMedDialog
        circleId="circle-1"
        event={target}
        events={[target, otherDose]}
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Discontinue' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ eventId: 'm-500', discontinued: true });
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
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discontinue' })).not.toBeInTheDocument();
  });

  it('falls back to event.discontinued_at when groupInactive is omitted (single-event callers)', () => {
    const discontinued = makeMed({ id: 'm-1', discontinued_at: '2026-07-01T12:00:00Z' });
    render(<DiscontinueMedDialog circleId="circle-1" event={discontinued} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('reactivates a discontinued med (opposite of current state) and still works without events', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const inactive = makeMed({ id: 'm-1', discontinued_at: '2026-07-01T12:00:00Z' });

    render(<DiscontinueMedDialog circleId="circle-1" event={inactive} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ eventId: 'm-1', discontinued: false });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
