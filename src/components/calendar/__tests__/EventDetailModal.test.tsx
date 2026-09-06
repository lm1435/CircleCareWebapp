import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { EventDetailModal } from '../EventDetailModal';

// The notes panel pulls in React Query + auth + toast context; these
// detail-modal tests are scoped to the detail rendering, so stub it out.
// EventNotesPanel has its own dedicated test (EventNotesPanel.test.tsx).
//
// The stub renders the panel's real "Notes" heading text (rather than
// nothing) so THIS file can actually verify the M2 fix: the event's OWN
// description row is never labelled "Notes" for ANY event type
// (Instructions for a medication, Details for everything else) — because
// this panel heading is the second "Notes" the dialog would otherwise show.
vi.mock('../EventNotesPanel', () => ({
  EventNotesPanel: () => <h3>Notes</h3>,
}));

// The viewer's 12h/24h clock. The real hook reads the shared currentUser React
// Query — pin it so these tests need no QueryClientProvider and never depend on
// the runner's navigator.language.
const mockUseHourCycle = vi.fn();
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => mockUseHourCycle(),
}));

beforeEach(() => {
  mockUseHourCycle.mockReturnValue('12h');
});

// Pin the "device" timezone (only getDeviceTimezone reads resolvedOptions —
// formatToParts/format are unaffected). Dev machine is America/Denver; tests
// must never depend on it.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/New_York',
} as Intl.ResolvedDateTimeFormatOptions);

const TZ = 'America/Chicago';

function makeEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'ev-1',
    circle_id: 'circle-1',
    event_type: 'medication',
    title: 'Metformin',
    medication_name: 'Metformin',
    medication_dosage: '500mg',
    scheduled_date: '2026-06-12',
    scheduled_time: '08:00:00',
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('EventDetailModal', () => {
  it('renders title, type badge, and date + time in the recipient timezone', () => {
    render(
      <EventDetailModal
        event={makeEvent({
          confirmation: {
            status: 'taken',
            confirmed_at: '2026-06-12T13:05:00Z',
            confirmed_by: 'u1',
          },
        })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: /Metformin/ })).toBeInTheDocument();
    expect(screen.getByText('Medication')).toBeInTheDocument();
    expect(screen.getByText('Friday, June 12, 2026')).toBeInTheDocument();
    // Naive 08:00 in Chicago + dual display for the New_York "device". The
    // zone is named by its city now, not by an invented abbreviation.
    expect(screen.getByText(/8:00 AM \(Chicago\)/)).toBeInTheDocument();
    // Confirmation time rendered in the recipient's timezone
    expect(screen.getByText('Taken at 8:05 AM (Chicago)')).toBeInTheDocument();

    // The type eyebrow renders through the shared `Eyebrow` component (spec
    // §6.4 "the type eyebrow uses Eyebrow dot"): a type-colored dot + label,
    // colour overridden per event type via `Eyebrow`'s own `color` prop.
    const eyebrow = screen.getByText('Medication');
    expect(eyebrow.className).toContain('text-clay!');
    const dot = eyebrow.querySelector('span[aria-hidden="true"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveClass('bg-clay');
  });

  it('shows notes, location, and human-readable weekly recurrence (0=Sun..6=Sat)', () => {
    render(
      <EventDetailModal
        event={makeEvent({
          event_type: 'appointment',
          title: 'Dr. Smith',
          medication_name: null,
          medication_dosage: null,
          description: 'Bring insurance card',
          location: 'Clinic',
          recurrence_rule: 'weekly',
          recurrence_days: [0, 3],
        })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Bring insurance card')).toBeInTheDocument();
    expect(screen.getByText('Clinic')).toBeInTheDocument();
    // Sunday stays 0 → "Sun" — never converted to 7
    expect(screen.getByText('Weekly on Sun, Wed')).toBeInTheDocument();
  });

  it('shows the missed status for unconfirmed past meds', () => {
    render(
      <EventDetailModal
        event={makeEvent({ scheduled_date: '2020-01-01' })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Missed')).toBeInTheDocument();
  });

  it('renders the download-app CTA when canEdit is false', () => {
    render(<EventDetailModal event={makeEvent({})} careRecipientTimezone={TZ} onClose={vi.fn()} />);
    expect(screen.getByText('Get the full experience.')).toBeInTheDocument();
    expect(screen.getByText('Download CircleCare for iOS or Android.')).toBeInTheDocument();
  });

  it('renders the editActions slot instead of the CTA when canEdit', () => {
    render(
      <EventDetailModal
        event={makeEvent({})}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
        canEdit
        editActions={<button type="button">Edit event</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Edit event' })).toBeInTheDocument();
    expect(screen.queryByText('Get the full experience.')).not.toBeInTheDocument();
  });

  it('moves focus to the close button on open and closes on Escape', () => {
    const onClose = vi.fn();
    render(<EventDetailModal event={makeEvent({})} careRecipientTimezone={TZ} onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: 'Close event details' });
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to the previously focused element on unmount', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <EventDetailModal event={makeEvent({})} careRecipientTimezone={TZ} onClose={vi.fn()} />
    );
    expect(trigger).not.toHaveFocus();

    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
  // The medication's state is still conveyed in TEXT — the badge AND the body
  // note — because only the DOSE's actionability changed when inactive doses
  // became confirmable again. Colour alone would fail WCAG 2.1 AA 1.4.1, and a
  // note that told the user the dose was read-only would now be false.
  it('an inactive medication keeps the Inactive badge and a note that does NOT claim the dose is read-only', () => {
    render(
      <EventDetailModal
        event={makeEvent({ discontinued_at: '2026-06-12T18:00:00Z' })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Inactive')).toBeInTheDocument();
    const note = screen.getByText(/This medication is inactive\./);
    expect(note).toHaveTextContent('you can still mark one taken or skipped');
    expect(note).toHaveTextContent(
      'Reactivate the medication to change its details or resume reminders.'
    );
  });

  // M2 — no Done/Close footer button: the Modal's × already closes this
  // dialog and neither branch (download CTA, or edit actions) has unsaved
  // state a second dismiss would protect.
  it('renders no Done button, whether canEdit is false or true', () => {
    const { rerender } = render(
      <EventDetailModal event={makeEvent({})} careRecipientTimezone={TZ} onClose={vi.fn()} />
    );
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();

    rerender(
      <EventDetailModal
        event={makeEvent({})}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
        canEdit
        editActions={<button type="button">Edit event</button>}
      />
    );
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('detail row labels use the shared Text label variant, not the raw mono utility', () => {
    render(<EventDetailModal event={makeEvent({})} careRecipientTimezone={TZ} onClose={vi.fn()} />);

    const dateLabel = screen.getByText('Date');
    expect(dateLabel.tagName).toBe('DT');
    expect(dateLabel.className).toContain('text-sm');
    expect(dateLabel.className).toContain('font-semibold');
    expect(dateLabel.className).not.toContain('mono');
  });

  // M2 — the event's OWN description row is a DIFFERENT thing from the
  // circle-notes panel rendered below (shared, ongoing notes about the care
  // recipient), which already renders its own "Notes" heading. Labelling
  // this row "Notes" too, for ANY event type, put two "Notes" headings in one
  // dialog — so every type gets a row label that is never "Notes": a
  // medication's own note is its dosing INSTRUCTIONS, everything else is its
  // DETAILS.
  it('a medication description row is labelled Instructions, leaving exactly one Notes heading', () => {
    render(
      <EventDetailModal
        event={makeEvent({ description: 'Take with food' })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Instructions')).toBeInTheDocument();
    expect(screen.getByText('Take with food')).toBeInTheDocument();
    expect(screen.queryByText('Details')).not.toBeInTheDocument();
    expect(screen.getAllByText('Notes')).toHaveLength(1);
  });

  // Task 15/16 — a completed task opens THIS modal (TaskDetailModal is
  // deleted), so the "Completed by" row lands here, not there.
  it('renders a Completed by row for a completed task, attributed from the circle roster', () => {
    render(
      <EventDetailModal
        event={makeEvent({
          event_type: 'task',
          title: 'Pick up prescription',
          medication_name: null,
          medication_dosage: null,
          completed_at: '2026-06-12T18:05:00Z',
          completed_by: 'user-1',
        })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
        members={[
          {
            id: 'user-1',
            email: 'rosa@example.com',
            first_name: 'Rosa',
            last_name: 'Diaz',
          } as never,
        ]}
      />
    );

    expect(screen.getByText('Completed by')).toBeInTheDocument();
    expect(screen.getByText(/Rosa Diaz/)).toBeInTheDocument();
    // 18:05 UTC on 2026-06-12 = 1:05 PM in Chicago (CDT, UTC-5).
    expect(screen.getByText(/1:05 PM/)).toBeInTheDocument();
  });

  it('falls back to an unattributed Completed on row when no name can be resolved', () => {
    render(
      <EventDetailModal
        event={makeEvent({
          event_type: 'task',
          title: 'Pick up prescription',
          medication_name: null,
          medication_dosage: null,
          completed_at: '2026-06-12T18:05:00Z',
          completed_by: null,
        })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Completed on')).toBeInTheDocument();
    expect(screen.queryByText('Completed by')).not.toBeInTheDocument();
  });

  // Review 2026-09-05 — the deleted TaskDetailModal had this row (mobile
  // TaskDetailSheet.tsx:323-334); it must survive the move to this modal.
  it('renders an Assigned to row for a task, attributed from the circle roster', () => {
    render(
      <EventDetailModal
        event={makeEvent({
          event_type: 'task',
          title: 'Pick up prescription',
          medication_name: null,
          medication_dosage: null,
          assigned_to: 'user-2',
        })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
        members={[
          {
            id: 'user-2',
            email: 'sam@example.com',
            first_name: 'Sam',
            last_name: 'Diaz',
          } as never,
        ]}
      />
    );

    expect(screen.getByText('Assigned to')).toBeInTheDocument();
    expect(screen.getByText('Sam Diaz')).toBeInTheDocument();
  });

  it('falls back to the shared Unassigned label for a task with no assignee', () => {
    render(
      <EventDetailModal
        event={makeEvent({
          event_type: 'task',
          title: 'Pick up prescription',
          medication_name: null,
          medication_dosage: null,
          assigned_to: null,
        })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Assigned to')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
  });

  it('renders no Assigned to row for a medication or an appointment', () => {
    render(
      <EventDetailModal
        event={makeEvent({ event_type: 'medication' })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText('Assigned to')).not.toBeInTheDocument();
  });

  it('a task/appointment description row is labelled Details, leaving exactly one Notes heading', () => {
    render(
      <EventDetailModal
        event={makeEvent({
          event_type: 'appointment',
          title: 'Dr. Smith',
          medication_name: null,
          medication_dosage: null,
          description: 'Bring insurance card',
        })}
        careRecipientTimezone={TZ}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Bring insurance card')).toBeInTheDocument();
    expect(screen.queryByText('Instructions')).not.toBeInTheDocument();
    expect(screen.getAllByText('Notes')).toHaveLength(1);
  });
});
