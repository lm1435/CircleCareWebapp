import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@/i18n';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CircleMember } from '@/api/circleMembers';
import { ShiftCard } from '../ShiftCard';

vi.mock('@/hooks/useHourCycle', () => ({ useHourCycle: () => '12h' }));

// The viewer shares the recipient's zone here, so no dual time is shown.
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
  timeZone: 'America/Chicago',
} as Intl.ResolvedDateTimeFormatOptions);

const TZ = 'America/Chicago';

const members = [
  { id: 'u-ana', first_name: 'Ana', last_name: 'R', email: 'ana@x.test' },
  { id: 'u-me', first_name: 'Pat', last_name: 'L', email: 'pat@x.test' },
] as unknown as CircleMember[];

function shift(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 's1',
    circle_id: 'c',
    event_type: 'shift',
    title: 'Night',
    scheduled_date: '2026-10-19',
    scheduled_time: '20:00:00',
    duration_minutes: 720,
    assigned_to: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

function renderCard(s: CalendarEvent, extra: Partial<React.ComponentProps<typeof ShiftCard>> = {}) {
  const onOpen = vi.fn();
  const onTake = vi.fn();
  render(
    <ul>
      <ShiftCard
        shift={s}
        timezone={TZ}
        members={members}
        viewerId="u-me"
        onOpen={onOpen}
        onTake={onTake}
        {...extra}
      />
    </ul>
  );
  return { onOpen, onTake };
}

describe('ShiftCard', () => {
  it('OPEN: the same white card (no amber, no dashed edge), "Open" in moss on the meta line, a Take button and an accessible name that says open', async () => {
    const user = userEvent.setup();
    const { onOpen, onTake } = renderCard(shift());
    const card = screen.getByTestId('shift-card');
    expect(card).toHaveAttribute('data-shift-state', 'open');
    expect(card).toHaveClass('border', 'border-line!', 'bg-cream');
    expect(card.className).not.toMatch(/amber|dashed/);
    expect(screen.getByTestId('shift-open-ring').className).not.toMatch(/amber|dashed/);
    // Conveyed by text ("Open" on the meta line, in moss), not by colour or edge style.
    const word = within(card).getByTestId('shift-open-word');
    expect(word).toHaveTextContent('Open');
    expect(word).toHaveClass('text-moss', 'font-semibold');
    expect(word.parentElement).toHaveTextContent(/8:00 PM – 8:00 AM · next day · Open/);
    expect(within(card).getAllByText('Open')).toHaveLength(1);
    const body = screen.getByRole('button', { name: 'Night, 8:00 PM to 8:00 AM, next day, open' });
    // The action sits in the description, never in the label.
    expect(body).toHaveAccessibleDescription('Opens the shift details');
    expect(body.getAttribute('aria-label')).not.toMatch(/double tap/i);
    await user.click(body);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    await user.click(screen.getByRole('button', { name: 'Take Night' }));
    expect(onTake).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
  });

  it('FILLED: moss surface, the assignee name, no Take', () => {
    renderCard(shift({ assigned_to: 'u-ana' }));
    const card = screen.getByTestId('shift-card');
    expect(card).toHaveAttribute('data-shift-state', 'filled');
    expect(card).toHaveClass('bg-moss-soft');
    expect(card).not.toHaveClass('border-dashed');
    expect(screen.getByText(/8:00 PM – 8:00 AM · next day · Ana/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Night, 8:00 PM to 8:00 AM, next day, Ana is on it' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Take/ })).not.toBeInTheDocument();
  });

  it('the viewer reads "You"', () => {
    renderCard(shift({ assigned_to: 'u-me' }));
    expect(screen.getByText(/· You/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Night, 8:00 PM to 8:00 AM, next day, you are on this shift' })).toBeInTheDocument();
  });

  it('a same-day shift has no "next day" in the label', () => {
    renderCard(shift({ scheduled_time: '08:00:00', duration_minutes: 360 }));
    expect(
      screen.getByRole('button', { name: 'Night, 8:00 AM to 2:00 PM, open' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/next day/)).not.toBeInTheDocument();
  });

  it('an open card has no Take without edit rights (no onTake)', () => {
    renderCard(shift(), { onTake: undefined });
    expect(screen.queryByRole('button', { name: /^Take/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
  });
});
