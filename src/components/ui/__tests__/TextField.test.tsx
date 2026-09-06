import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextField } from '../TextField';

// The real Icon inlines every ionicon SVG through import.meta.glob; the stub
// keeps these tests about the FIELD and makes "which glyph" assertable.
vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

/** The bordered box (spec §4.5) — the input's parent, never the input. */
function shellOf(control: HTMLElement): HTMLElement {
  const shell = control.parentElement;
  if (!shell) throw new Error('field has no shell');
  return shell;
}

describe('TextField', () => {
  it('renders a label associated with the input', () => {
    render(<TextField id="title" label="Title" value="" onChange={() => {}} />);
    const input = screen.getByLabelText(/^Title( \* \(required\))?$/);
    expect(input).toBe(screen.getByRole('textbox'));
  });

  it('wires aria-invalid + aria-describedby to the error text', () => {
    render(
      <TextField id="title" label="Title" error="Title is required" value="" onChange={() => {}} />
    );
    const input = screen.getByLabelText(/^Title( \* \(required\))?$/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const errorText = screen.getByText('Title is required');
    expect(errorText).toHaveAttribute('id', 'title-error');
    expect(input.getAttribute('aria-describedby')).toContain('title-error');
  });

  it('describes the input by the hint when no error', () => {
    render(
      <TextField id="title" label="Title" hint="Up to 150 characters" value="" onChange={() => {}} />
    );
    const input = screen.getByLabelText(/^Title( \* \(required\))?$/);
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input.getAttribute('aria-describedby')).toContain('title-hint');
  });

  it('reflects the disabled state', () => {
    render(<TextField id="title" label="Title" disabled value="" onChange={() => {}} />);
    expect(screen.getByLabelText(/^Title( \* \(required\))?$/)).toBeDisabled();
  });

  it('forwards changes to the controlled handler', () => {
    const onChange = vi.fn();
    render(<TextField id="title" label="Title" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^Title( \* \(required\))?$/), { target: { value: 'Metformin' } });
    expect(onChange).toHaveBeenCalled();
  });
});

// The global focus-visible ring is REMOVED from input/textarea/select
// (globals.css), so a field with no focus-within border has no focus
// affordance at all — these assertions are the only thing holding it.
describe('TextField — the §4.5 shell', () => {
  it('puts the border, the 44px floor and the focus transition on the shell, not the input', () => {
    render(<TextField id="title" label="Title" value="" onChange={() => {}} />);
    const shell = shellOf(screen.getByLabelText(/^Title( \* \(required\))?$/));
    expect(shell.className).toContain('border-line-2');
    expect(shell.className).toContain('min-h-[44px]');
    expect(shell.className).toContain('focus-within:border-moss-light');
    expect(shell.className).toContain('duration-fast');
  });

  it('turns the shell terracotta and shows the alert glyph in the error state', () => {
    render(
      <TextField id="title" label="Title" error="Title is required" value="" onChange={() => {}} />
    );
    const shell = shellOf(screen.getByLabelText(/^Title( \* \(required\))?$/));
    expect(shell.className).toContain('border-terracotta');
    // Error REPLACES the resting pair — two border-color utilities in one class
    // string would be resolved by Tailwind's emit order, not by intent.
    expect(shell.className).toContain('focus-within:border-terracotta');
    expect(shell.className).not.toContain('moss-light');
    expect(shell.className).not.toContain('border-line-2');
    const alert = document.querySelector('[data-icon="alert-circle-outline"]');
    expect(alert).toBeInTheDocument();
  });

  it('dims the shell at 50% when disabled', () => {
    render(<TextField id="title" label="Title" disabled value="" onChange={() => {}} />);
    expect(shellOf(screen.getByLabelText(/^Title( \* \(required\))?$/)).className).toContain('opacity-50');
  });

  // The shell carries NO vertical padding — the input owns it, so a click
  // anywhere in the 44–50px shell lands on the real control, not a dead zone
  // of shell padding (layout/click-forwarding can't be measured in jsdom, so
  // this only pins the classes that make it true).
  it("gives the input, not the shell, the shell's vertical padding", () => {
    render(<TextField id="title" label="Title" value="" onChange={() => {}} />);
    const input = screen.getByLabelText(/^Title( \* \(required\))?$/);
    const shell = shellOf(input);
    expect(shell.className).not.toContain('py-3');
    expect(input.className).toContain('self-stretch');
    expect(input.className).toContain('py-3');
  });
});

describe('TextField — password toggle', () => {
  const labels = { show: 'Show password', hide: 'Hide password' };

  it('flips the input type and aria-pressed, swapping the eye glyph', async () => {
    const user = userEvent.setup();
    render(
      <TextField
        id="pw"
        label="Password"
        type="password"
        showToggle
        toggleLabels={labels}
        value=""
        onChange={() => {}}
      />
    );

    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.querySelector('[data-icon="eye-outline"]')).toBeInTheDocument();

    await user.click(toggle);

    expect(input).toHaveAttribute('type', 'text');
    const pressed = screen.getByRole('button', { name: 'Hide password' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(pressed.querySelector('[data-icon="eye-off-outline"]')).toBeInTheDocument();
  });

  it('gives the toggle a 44×44 target', () => {
    render(
      <TextField
        id="pw"
        label="Password"
        type="password"
        showToggle
        toggleLabels={labels}
        value=""
        onChange={() => {}}
      />
    );
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.className).toContain('min-h-[44px]');
    expect(toggle.className).toContain('min-w-[44px]');
  });

  // Copy never lives in a primitive: with no translated labels the eye would
  // ship as an unlabeled button, so it must not ship at all.
  it('renders no eye without toggleLabels, and warns in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <TextField id="pw" label="Password" type="password" showToggle value="" onChange={() => {}} />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // The warning is DEV-gated; assert the gate is open so this can't pass by
    // silently skipping the branch it is here to cover.
    expect(import.meta.env.DEV).toBe(true);
    expect(warn).toHaveBeenCalledWith('TextField: showToggle requires toggleLabels');
    warn.mockRestore();
  });

  it('renders no eye on a non-password field', () => {
    render(
      <TextField
        id="title"
        label="Title"
        showToggle
        toggleLabels={labels}
        value=""
        onChange={() => {}}
      />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('TextField — trailing icon slot', () => {
  it('renders a decorative glyph when there is no press handler', () => {
    render(
      <TextField
        id="search"
        label="Search"
        rightIcon="close-outline"
        value=""
        onChange={() => {}}
      />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('[data-icon="close-outline"]')).toBeInTheDocument();
  });

  // Same rule as the eye: a trailing button with no accessible name is worse
  // than no button, so the glyph degrades to decoration and dev hears about it.
  it('renders no button when onRightIconPress has no rightIconLabel, and warns in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <TextField
        id="search"
        label="Search"
        rightIcon="close-outline"
        onRightIconPress={vi.fn()}
        value=""
        onChange={() => {}}
      />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('[data-icon="close-outline"]')).toBeInTheDocument();
    expect(import.meta.env.DEV).toBe(true);
    expect(warn).toHaveBeenCalledWith('TextField: onRightIconPress requires rightIconLabel');
    warn.mockRestore();
  });

  it('renders a named button when onRightIconPress is given', async () => {
    const user = userEvent.setup();
    const onRightIconPress = vi.fn();
    render(
      <TextField
        id="search"
        label="Search"
        rightIcon="close-outline"
        rightIconLabel="Clear"
        onRightIconPress={onRightIconPress}
        value=""
        onChange={() => {}}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onRightIconPress).toHaveBeenCalledTimes(1);
  });
});
