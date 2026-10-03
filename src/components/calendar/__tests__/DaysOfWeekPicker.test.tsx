import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import '@/i18n';
import { DaysOfWeekPicker } from '../DaysOfWeekPicker';

function Harness({
  initial,
  lockedDay = null,
  language = 'en',
  onChange = () => {},
}: {
  initial: number[];
  lockedDay?: number | null;
  language?: string;
  onChange?: (days: number[]) => void;
}) {
  const [days, setDays] = useState(initial);
  return (
    <>
      <DaysOfWeekPicker
        id="days"
        label="Repeat on"
        selected={days}
        lockedDay={lockedDay}
        lockedHintId={lockedDay != null ? 'lock-note' : undefined}
        language={language}
        onChange={(next) => {
          onChange(next);
          setDays(next);
        }}
      />
      {lockedDay != null && <p id="lock-note">locked</p>}
    </>
  );
}

describe('DaysOfWeekPicker', () => {
  it('is a labelled group of seven checkboxes in the EN week order (Sunday first)', () => {
    render(<Harness initial={[]} />);
    const group = screen.getByRole('group', { name: 'Repeat on' });
    const chips = within(group).getAllByRole('checkbox');
    expect(chips.map((c) => c.textContent)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]);
  });

  it('starts the week on Monday in Spanish, full names as the accessible names', () => {
    render(<Harness initial={[]} language="es" />);
    const chips = within(screen.getByRole('group', { name: 'Repeat on' })).getAllByRole('checkbox');
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
      'domingo',
    ]);
    expect(chips[0]).toHaveTextContent('lun');
    // Sunday keeps index 0 whatever its POSITION.
    expect(chips[6]).toHaveAttribute('data-day', '0');
  });

  it('toggles with a click and with Space, reporting a sorted 0=Sun set', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={[5]} onChange={onChange} />);

    await user.click(screen.getByRole('checkbox', { name: 'Monday' }));
    expect(onChange).toHaveBeenLastCalledWith([1, 5]);

    screen.getByRole('checkbox', { name: 'Sunday' }).focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith([0, 1, 5]);
    expect(screen.getByRole('checkbox', { name: 'Sunday' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('checkbox', { name: 'Friday' }));
    expect(onChange).toHaveBeenLastCalledWith([0, 1]);
  });

  it('every chip is its own tab stop (a multi-select, not a roving radiogroup)', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} />);
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Sunday' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('checkbox', { name: 'Monday' })).toHaveFocus();
  });

  it('the locked day stays checked, is aria-disabled + described, and ignores presses', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={[3]} lockedDay={1} onChange={onChange} />);

    const monday = screen.getByRole('checkbox', { name: 'Monday' });
    expect(monday).toHaveAttribute('aria-checked', 'true');
    expect(monday).toHaveAttribute('aria-disabled', 'true');
    expect(monday).toHaveAttribute('aria-describedby', 'lock-note');
    // Still focusable, so the explanation can be reached.
    expect(monday).not.toBeDisabled();

    await user.click(monday);
    monday.focus();
    await user.keyboard(' ');
    expect(onChange).not.toHaveBeenCalled();
    expect(monday).toHaveAttribute('aria-checked', 'true');

    // Toggling another day always keeps the locked one in the reported set.
    await user.click(screen.getByRole('checkbox', { name: 'Wednesday' }));
    expect(onChange).toHaveBeenLastCalledWith([1]);
  });

  it('renders the optional note under the chips and describes the group by it (PK23)', () => {
    render(
      <DaysOfWeekPicker
        id="days"
        label="Repeat on"
        selected={[]}
        onChange={() => {}}
        language="en"
        note="Days are in Rosa's time zone (New York)"
        noteId="days-note"
      />
    );
    const note = screen.getByText("Days are in Rosa's time zone (New York)");
    expect(note).toHaveAttribute('id', 'days-note');
    expect(screen.getByRole('group', { name: 'Repeat on' })).toHaveAttribute(
      'aria-describedby',
      'days-note'
    );
  });

  it('renders no note element without a note', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByRole('group', { name: 'Repeat on' })).not.toHaveAttribute('aria-describedby');
  });
});
