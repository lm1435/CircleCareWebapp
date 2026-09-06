import { fireEvent, render, screen } from '@testing-library/react';
import { DateField } from '../DateField';
import { TimeField } from '../TimeField';

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

function shellOf(control: HTMLElement): HTMLElement {
  const shell = control.parentElement;
  if (!shell) throw new Error('field has no shell');
  return shell;
}

describe('DateField', () => {
  it('renders a native date input in the 44px shell with the calendar glyph', () => {
    render(<DateField id="start" label="Start date" value="2026-09-04" onChange={() => {}} />);
    const control = screen.getByLabelText('Start date');
    expect(control).toHaveAttribute('type', 'date');
    const shell = shellOf(control);
    expect(shell.className).toContain('min-h-[44px]');
    expect(shell.className).toContain('focus-within:border-moss-light');
    expect(shell.querySelector('[data-icon="calendar-outline"]')).toBeInTheDocument();
  });

  // The native picker button is kept (transparent, over our glyph) so the
  // picker stays reachable with a mouse — hiding it outright would make the
  // field type-only.
  it('overlays the native picker indicator on the trailing slot', () => {
    render(<DateField id="start" label="Start date" value="" onChange={() => {}} />);
    const control = screen.getByLabelText('Start date');
    expect(control.className).toContain('[&::-webkit-calendar-picker-indicator]:opacity-0');
    expect(control.className).toContain('[&::-webkit-calendar-picker-indicator]:w-11');
    expect(shellOf(control).className).toContain('relative');
  });

  it('reports changes and wires the error state', () => {
    const onChange = vi.fn();
    render(
      <DateField id="start" label="Start date" error="Required" value="" onChange={onChange} />
    );
    const control = screen.getByLabelText('Start date');
    fireEvent.change(control, { target: { value: '2026-09-05' } });
    expect(onChange).toHaveBeenCalled();
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(shellOf(control).className).toContain('border-terracotta');
    expect(document.querySelector('[data-icon="alert-circle-outline"]')).toBeInTheDocument();
  });

  // The shell carries NO vertical padding — the input owns it, so a click
  // anywhere in the shell lands on the real control, not a dead zone.
  it("gives the input, not the shell, the shell's vertical padding", () => {
    render(<DateField id="start" label="Start date" value="" onChange={() => {}} />);
    const control = screen.getByLabelText('Start date');
    expect(shellOf(control).className).not.toContain('py-3');
    expect(control.className).toContain('self-stretch');
    expect(control.className).toContain('py-3');
  });
});

describe('TimeField', () => {
  it('renders a native time input in the 44px shell with the clock glyph', () => {
    render(<TimeField id="at" label="Time" value="08:00" onChange={() => {}} />);
    const control = screen.getByLabelText(/^Time/);
    expect(control).toHaveAttribute('type', 'time');
    const shell = shellOf(control);
    expect(shell.className).toContain('min-h-[44px]');
    expect(shell.className).toContain('focus-within:border-moss-light');
    expect(shell.querySelector('[data-icon="time-outline"]')).toBeInTheDocument();
  });

  it('turns the shell terracotta in the error state', () => {
    render(<TimeField id="at" label="Time" error="Required" value="" onChange={() => {}} />);
    const shell = shellOf(screen.getByLabelText(/^Time/));
    expect(shell.className).toContain('border-terracotta');
    expect(shell.className).not.toContain('moss-light');
  });

  it('dims the shell at 50% when disabled', () => {
    render(<TimeField id="at" label="Time" disabled value="" onChange={() => {}} />);
    expect(shellOf(screen.getByLabelText(/^Time/)).className).toContain('opacity-50');
  });

  it("gives the input, not the shell, the shell's vertical padding", () => {
    render(<TimeField id="at" label="Time" value="" onChange={() => {}} />);
    const control = screen.getByLabelText(/^Time/);
    expect(shellOf(control).className).not.toContain('py-3');
    expect(control.className).toContain('self-stretch');
    expect(control.className).toContain('py-3');
  });
});
