import { fireEvent, render, screen } from '@testing-library/react';
import { Select } from '../Select';

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

const OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

function shellOf(control: HTMLElement): HTMLElement {
  const shell = control.parentElement;
  if (!shell) throw new Error('field has no shell');
  return shell;
}

describe('Select', () => {
  it('renders the options and reports changes', () => {
    const onChange = vi.fn();
    render(
      <Select id="repeat" label="Repeat" options={OPTIONS} value="daily" onChange={onChange} />
    );
    const control = screen.getByLabelText('Repeat');
    expect(screen.getByRole('option', { name: 'Weekly' })).toBeInTheDocument();
    fireEvent.change(control, { target: { value: 'weekly' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('renders the placeholder as a disabled empty option', () => {
    render(
      <Select
        id="repeat"
        label="Repeat"
        options={OPTIONS}
        placeholder="Choose…"
        value=""
        onChange={() => {}}
      />
    );
    const placeholder = screen.getByRole('option', { name: 'Choose…' });
    expect(placeholder).toBeDisabled();
    expect(placeholder).toHaveValue('');
  });

  it('drops the native caret and renders the app chevron in the 44px shell', () => {
    render(<Select id="repeat" label="Repeat" options={OPTIONS} value="daily" onChange={() => {}} />);
    const control = screen.getByLabelText('Repeat');
    expect(control.className).toContain('appearance-none');
    const shell = shellOf(control);
    expect(shell.className).toContain('min-h-[44px]');
    expect(shell.className).toContain('focus-within:border-moss-light');
    expect(shell.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
  });

  it('turns the shell terracotta and shows the alert glyph in the error state', () => {
    render(
      <Select
        id="repeat"
        label="Repeat"
        options={OPTIONS}
        error="Pick one"
        value=""
        onChange={() => {}}
      />
    );
    const shell = shellOf(screen.getByLabelText('Repeat'));
    expect(shell.className).toContain('border-terracotta');
    expect(shell.className).not.toContain('moss-light');
    expect(document.querySelector('[data-icon="alert-circle-outline"]')).toBeInTheDocument();
    expect(screen.getByLabelText('Repeat')).toHaveAttribute('aria-invalid', 'true');
  });

  it('dims the shell at 50% when disabled', () => {
    render(
      <Select id="repeat" label="Repeat" options={OPTIONS} disabled value="daily" onChange={() => {}} />
    );
    expect(shellOf(screen.getByLabelText('Repeat')).className).toContain('opacity-50');
  });

  // The shell carries NO vertical padding — the select owns it, so a click
  // anywhere in the shell lands on the real control, not a dead zone.
  it("gives the select, not the shell, the shell's vertical padding", () => {
    render(<Select id="repeat" label="Repeat" options={OPTIONS} value="daily" onChange={() => {}} />);
    const control = screen.getByLabelText('Repeat');
    const shell = shellOf(control);
    expect(shell.className).not.toContain('py-3');
    expect(control.className).toContain('self-stretch');
    expect(control.className).toContain('py-3');
  });
});
