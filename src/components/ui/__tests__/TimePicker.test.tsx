import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { TimeField } from '../TimeField';
import { from12h, parseTimeValue, to12h, toTimeValue } from '../TimePickerPanel';

// The panel reads the viewer's clock through React Query; the conversion it
// drives is what these tests are about, so the cycle is injected directly.
let cycle: '12h' | '24h' = '12h';
vi.mock('@/hooks/useHourCycle', () => ({
  useHourCycle: () => cycle,
}));

beforeEach(() => {
  cycle = '12h';
});

/**
 * A controlled host, because that is what every real call site is
 * (`AddEventModal`, `ProfilePage`, `VitalFormModal`, the first-run wizard) and
 * because a pick has to survive into the NEXT pick — choosing PM after
 * choosing an hour must keep the hour.
 */
function Host({
  initial = '',
  onChange,
}: {
  initial?: string;
  onChange?: (value: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <TimeField
      id="at"
      label="Time"
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onChange?.(event.target.value);
      }}
    />
  );
}

// The panel is `React.lazy` (see the import comment in TimeField), so opening
// it is asynchronous by one chunk — wait for the panel, not just for the click.
async function openPicker(): Promise<void> {
  await userEvent.setup().click(screen.getByRole('button', { name: 'Choose a time' }));
  await screen.findByRole('dialog', { name: 'Time picker' });
}

function column(name: string): HTMLElement {
  return screen.getByRole('listbox', { name });
}

describe('time value conversion', () => {
  // 12 AM = 00 and 12 PM = 12 are where every 12-hour picker breaks.
  it('maps the 12 AM / 12 PM boundaries in both directions', () => {
    expect(from12h(12, false)).toBe(0);
    expect(from12h(12, true)).toBe(12);
    expect(to12h(0)).toEqual({ hour12: 12, pm: false });
    expect(to12h(12)).toEqual({ hour12: 12, pm: true });
  });

  it('maps the ordinary hours', () => {
    expect(from12h(1, false)).toBe(1);
    expect(from12h(8, true)).toBe(20);
    expect(from12h(11, true)).toBe(23);
    expect(to12h(13)).toEqual({ hour12: 1, pm: true });
    expect(to12h(23)).toEqual({ hour12: 11, pm: true });
    expect(to12h(11)).toEqual({ hour12: 11, pm: false });
  });

  it('round-trips every hour of the day through the 12-hour split', () => {
    for (let hour24 = 0; hour24 < 24; hour24 += 1) {
      const { hour12, pm } = to12h(hour24);
      expect(from12h(hour12, pm)).toBe(hour24);
    }
  });

  it('reads HH:MM, tolerates the Postgres HH:MM:SS form, and rejects nonsense', () => {
    expect(parseTimeValue('08:48')).toEqual({ hour24: 8, minute: 48 });
    expect(parseTimeValue('20:48:00')).toEqual({ hour24: 20, minute: 48 });
    // `24:00` is the midnight serialisation already in the database.
    expect(parseTimeValue('24:00')).toEqual({ hour24: 0, minute: 0 });
    expect(parseTimeValue('')).toBeNull();
    expect(parseTimeValue(undefined)).toBeNull();
    expect(parseTimeValue('8:70')).toBeNull();
    expect(parseTimeValue('nope')).toBeNull();
  });

  it('always emits a zero-padded 24-hour string', () => {
    expect(toTimeValue(9, 5)).toBe('09:05');
    expect(toTimeValue(0, 0)).toBe('00:00');
    expect(toTimeValue(23, 59)).toBe('23:59');
  });
});

describe('TimeField picker trigger', () => {
  it('names the trigger, wires aria-haspopup, and only points at a panel that exists', async () => {
    render(<Host initial="08:48" />);
    const trigger = screen.getByRole('button', { name: 'Choose a time' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');

    await openPicker();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls');
    expect(screen.getByRole('dialog', { name: 'Time picker' })).toBeInTheDocument();
  });

  // The native wheel must be unreachable, not merely covered — that is the
  // whole reason TimeField stopped sharing DateField's overlay.
  it('removes the native picker indicator instead of overlaying it', () => {
    render(<Host initial="08:48" />);
    const input = screen.getByLabelText(/^Time/);
    expect(input.className).toContain('[&::-webkit-calendar-picker-indicator]:hidden');
    expect(input.className).not.toContain('[&::-webkit-calendar-picker-indicator]:opacity-0');
  });
});

describe('TimePickerPanel in 12-hour mode', () => {
  it('renders three columns, all 60 minutes, and marks the current value selected', async () => {
    render(<Host initial="20:48" />);
    await openPicker();

    expect(within(column('Hour')).getAllByRole('option')).toHaveLength(12);
    expect(within(column('Minute')).getAllByRole('option')).toHaveLength(60);
    expect(within(column('AM/PM')).getAllByRole('option')).toHaveLength(2);

    expect(within(column('Hour')).getByRole('option', { name: '08' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(column('Minute')).getByRole('option', { name: '48' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(column('AM/PM')).getByRole('option', { name: 'PM' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    // The 5/15-minute snap a lesser picker would ship with would lose this one.
    expect(within(column('Minute')).getByRole('option', { name: '07' })).toBeInTheDocument();
  });

  it('emits HH:MM through the caller onChange when an hour is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="08:48" onChange={onChange} />);
    await openPicker();

    await user.click(within(column('Hour')).getByRole('option', { name: '09' }));
    expect(onChange).toHaveBeenLastCalledWith('09:48');
    expect(screen.getByLabelText('Time')).toHaveValue('09:48');
  });

  it('turns 8 AM into 20:48 when PM is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="08:48" onChange={onChange} />);
    await openPicker();

    await user.click(within(column('AM/PM')).getByRole('option', { name: 'PM' }));
    expect(onChange).toHaveBeenLastCalledWith('20:48');
  });

  // The two cases every 12-hour picker gets wrong, driven through the UI.
  it('turns 12:30 PM into 00:30 when AM is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="12:30" onChange={onChange} />);
    await openPicker();

    expect(within(column('AM/PM')).getByRole('option', { name: 'PM' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await user.click(within(column('AM/PM')).getByRole('option', { name: 'AM' }));
    expect(onChange).toHaveBeenLastCalledWith('00:30');
  });

  it('shows midnight as 12 AM and turns it into noon when PM is chosen', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="00:15" onChange={onChange} />);
    await openPicker();

    expect(within(column('Hour')).getByRole('option', { name: '12' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(within(column('AM/PM')).getByRole('option', { name: 'AM' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await user.click(within(column('AM/PM')).getByRole('option', { name: 'PM' }));
    expect(onChange).toHaveBeenLastCalledWith('12:15');
  });

  // An empty field has nothing to mark selected — but the keyboard still has to
  // start somewhere, and a pick still has to produce a COMPLETE time.
  it('selects nothing while the field is empty and still emits a full time', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    await openPicker();

    expect(
      within(column('Hour')).queryByRole('option', { selected: true })
    ).not.toBeInTheDocument();
    await user.click(within(column('Minute')).getByRole('option', { name: '48' }));
    expect(onChange).toHaveBeenLastCalledWith('12:48');
  });
});

describe('TimePickerPanel in Spanish', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  // The meridiem is read off `formatTimeOfDay`, not off a locale key, so the
  // column cannot drift from the RAE form the rest of the app renders.
  it('labels the columns in Spanish and writes the meridiem the RAE way', async () => {
    await i18n.changeLanguage('es');
    render(<Host initial="20:48" />);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Elegir una hora' }));
    await screen.findByRole('dialog', { name: 'Selector de hora' });

    expect(column('Hora')).toBeInTheDocument();
    expect(column('Minuto')).toBeInTheDocument();
    expect(within(column('a. m./p. m.')).getByRole('option', { name: 'p. m.' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});

describe('TimePickerPanel in 24-hour mode', () => {
  it('renders two columns with hours 00-23 and no AM/PM', async () => {
    cycle = '24h';
    render(<Host initial="20:48" />);
    await openPicker();

    expect(screen.getAllByRole('listbox')).toHaveLength(2);
    expect(screen.queryByRole('listbox', { name: 'AM/PM' })).not.toBeInTheDocument();

    const hours = within(column('Hour')).getAllByRole('option');
    expect(hours).toHaveLength(24);
    expect(hours[0]).toHaveTextContent('00');
    expect(hours[23]).toHaveTextContent('23');
    expect(within(column('Hour')).getByRole('option', { name: '20' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('emits the same HH:MM contract it displays', async () => {
    cycle = '24h';
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="20:48" onChange={onChange} />);
    await openPicker();

    await user.click(within(column('Hour')).getByRole('option', { name: '00' }));
    expect(onChange).toHaveBeenLastCalledWith('00:48');
  });
});

describe('TimePickerPanel keyboard', () => {
  it('opens focused on the current hour and moves within a column with Up/Down', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="08:30" onChange={onChange} />);
    await openPicker();

    expect(within(column('Hour')).getByRole('option', { name: '08' })).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('09:30');
    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith('08:30');
  });

  it('wraps at the end of a column', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="11:30" onChange={onChange} />);
    await openPicker();

    // 11 is the last row of the 12-hour column (12, 01 … 11).
    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('00:30');
  });

  it('moves between columns with Left/Right and with Tab', async () => {
    const user = userEvent.setup();
    render(<Host initial="08:30" />);
    await openPicker();

    await user.keyboard('{ArrowRight}');
    expect(within(column('Minute')).getByRole('option', { name: '30' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(within(column('AM/PM')).getByRole('option', { name: 'AM' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(within(column('Minute')).getByRole('option', { name: '30' })).toHaveFocus();

    await user.keyboard('{Tab}');
    expect(within(column('AM/PM')).getByRole('option', { name: 'AM' })).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(within(column('Minute')).getByRole('option', { name: '30' })).toHaveFocus();
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Host initial="08:30" />);
    await openPicker();
    expect(screen.getByRole('dialog', { name: 'Time picker' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Time picker' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Choose a time' })).toHaveFocus();
  });

  /**
   * AND BACK TO THE INPUT WHEN THE INPUT IS WHERE IT CAME FROM. Alt+ArrowDown
   * is the native keyboard opener, which this field intercepts and routes to
   * our popover (`opensNativePicker`); every exit path then handed focus to the
   * trailing icon button, so a keyboard user who tabbed into the field, opened
   * the picker and changed their mind landed one Shift+Tab PAST the segment
   * they were editing. A native `<input type="time">` puts focus back in the
   * input, and so must a replacement for it.
   */
  it('returns focus to the input when Alt+ArrowDown is what opened it', async () => {
    const user = userEvent.setup();
    render(<Host initial="08:30" />);
    const input = screen.getByLabelText('Time');
    await user.click(input);
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await screen.findByRole('dialog', { name: 'Time picker' });

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Time picker' })).not.toBeInTheDocument();
    });
    expect(input).toHaveFocus();
  });

  it('closes on Enter, keeping the value the arrows already committed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Host initial="08:30" onChange={onChange} />);
    await openPicker();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Time picker' })).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText('Time')).toHaveValue('09:30');
  });
});
