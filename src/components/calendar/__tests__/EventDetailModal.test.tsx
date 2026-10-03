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
//
// `notesPanelSpy` (via vi.hoisted, so it exists before the hoisted vi.mock
// factory below runs) records the props EventDetailModal passes down, so the
// `scheduledDate` gating bug (a persisted series ROOT rendered on its own
// start date got `undefined`, so the backend attached the note to the root
// and the GET's parent-id union then surfaced it on EVERY occurrence) has a
// regression test that doesn't require mounting the real panel's React
// Query/auth/toast stack.
const { notesPanelSpy } = vi.hoisted(() => ({ notesPanelSpy: vi.fn() }));
vi.mock('../EventNotesPanel', () => ({
  EventNotesPanel: (props: { circleId: string; eventId: string; scheduledDate?: string }) => {
    notesPanelSpy(props);
    return <h3>Notes</h3>;
  },
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
  notesPanelSpy.mockClear();
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

  // Parity with mobile's calendar detail sheet, which shows "Assigned to" for an
  // appointment that has an assignee (and nothing when it has none).
  describe('appointment assignee', () => {
    const appointment = (over: Partial<CalendarEvent>): CalendarEvent =>
      makeEvent({
        event_type: 'appointment',
        title: 'Cardiology visit',
        medication_name: null,
        medication_dosage: null,
        ...over,
      });

    it('shows who an appointment is assigned to', () => {
      render(
        <EventDetailModal
          event={appointment({
            assigned_to: 'user-2',
            assigned_to_user: {
              id: 'user-2',
              first_name: 'Sam',
              last_name: 'Diaz',
              email: 'sam@example.com',
            } as never,
          })}
          careRecipientTimezone={TZ}
          onClose={vi.fn()}
        />
      );
      expect(screen.getByText('Assigned to')).toBeInTheDocument();
      expect(screen.getByText('Sam Diaz')).toBeInTheDocument();
    });

    it('omits the row (no Unassigned label) when the appointment has no assignee', () => {
      render(
        <EventDetailModal
          event={appointment({ assigned_to: null, assigned_to_user: null })}
          careRecipientTimezone={TZ}
          onClose={vi.fn()}
        />
      );
      expect(screen.queryByText('Assigned to')).not.toBeInTheDocument();
      expect(screen.queryByText('Unassigned')).not.toBeInTheDocument();
    });

    it('omits the row when the assignee has left the circle and no name embed came back', () => {
      render(
        <EventDetailModal
          event={appointment({ assigned_to: 'gone-user', assigned_to_user: null })}
          careRecipientTimezone={TZ}
          onClose={vi.fn()}
          members={[]}
        />
      );
      expect(screen.queryByText('Assigned to')).not.toBeInTheDocument();
    });

    it('is labelled in Spanish', async () => {
      const { default: i18n } = await import('@/i18n');
      await i18n.changeLanguage('es');
      try {
        render(
          <EventDetailModal
            event={appointment({
              assigned_to: 'user-2',
              assigned_to_user: {
                id: 'user-2',
                first_name: 'Sam',
                last_name: 'Diaz',
                email: 'sam@example.com',
              } as never,
            })}
            careRecipientTimezone={TZ}
            onClose={vi.fn()}
          />
        );
        expect(screen.getByText('Asignado a')).toBeInTheDocument();
        expect(screen.getByText('Sam Diaz')).toBeInTheDocument();
      } finally {
        await i18n.changeLanguage('en');
      }
    });
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

  // BUG (2026-09-27): a persisted series ROOT rendered on ITS OWN start date
  // (not virtual, no parent_event_id) fell through the old
  // `event.is_virtual || event.parent_event_id` gate and got `scheduledDate:
  // undefined`. api/eventNotes.ts then sent no `scheduled_date`, the backend
  // attached the note directly to the root row, and GET always unions the
  // root id into every date's query — so a note added on day S appeared on
  // EVERY occurrence of the series. Proven live: one first-day note on 20
  // doses across 3 weeks. Every branch below must pass the row's OWN
  // scheduled_date for a RECURRING event (root-with-recurrence_rule, a
  // persisted child, or a virtual instance) and nothing for a genuinely
  // one-off event.
  describe('EventNotesPanel scheduledDate gating (event-note series-leak bug)', () => {
    it('passes the row-own scheduled_date for a series ROOT rendered on its own start date', () => {
      render(
        <EventDetailModal
          event={makeEvent({
            id: 'root-1',
            recurrence_rule: 'daily',
            parent_event_id: null,
            is_virtual: false,
            scheduled_date: '2026-06-12',
          })}
          careRecipientTimezone={TZ}
          onClose={vi.fn()}
        />
      );

      expect(notesPanelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'root-1', scheduledDate: '2026-06-12' })
      );
    });

    it('passes the row-own scheduled_date for a persisted child (parent_event_id set)', () => {
      render(
        <EventDetailModal
          event={makeEvent({
            id: 'child-1',
            parent_event_id: 'root-1',
            recurrence_rule: null,
            is_virtual: false,
            scheduled_date: '2026-06-19',
          })}
          careRecipientTimezone={TZ}
          onClose={vi.fn()}
        />
      );

      expect(notesPanelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'child-1', scheduledDate: '2026-06-19' })
      );
    });

    it('passes the row-own scheduled_date for a virtual instance', () => {
      render(
        <EventDetailModal
          event={makeEvent({
            id: 'root-1_2026-06-26',
            parent_event_id: null,
            recurrence_rule: 'daily',
            is_virtual: true,
            scheduled_date: '2026-06-26',
          })}
          careRecipientTimezone={TZ}
          onClose={vi.fn()}
        />
      );

      expect(notesPanelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'root-1_2026-06-26', scheduledDate: '2026-06-26' })
      );
    });

    it('passes no scheduledDate for a genuinely one-off (non-recurring) event', () => {
      render(
        <EventDetailModal
          event={makeEvent({
            id: 'oneoff-1',
            recurrence_rule: null,
            parent_event_id: null,
            is_virtual: false,
            scheduled_date: '2026-06-12',
          })}
          careRecipientTimezone={TZ}
          onClose={vi.fn()}
        />
      );

      expect(notesPanelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ eventId: 'oneoff-1', scheduledDate: undefined })
      );
    });
  });
});
