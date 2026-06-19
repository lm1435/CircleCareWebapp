import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import { EventDetailModal } from '../EventDetailModal';

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
    // Naive 08:00 in Chicago + dual display for the New_York "device"
    expect(screen.getByText(/8:00 AM CT/)).toBeInTheDocument();
    // Confirmation time rendered in the recipient's timezone
    expect(screen.getByText('Taken at 8:05 AM')).toBeInTheDocument();
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
});
