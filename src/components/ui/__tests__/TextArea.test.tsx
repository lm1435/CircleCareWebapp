import { fireEvent, render, screen } from '@testing-library/react';
import { TextArea } from '../TextArea';

vi.mock('../Icon', () => ({
  Icon: ({ name }: { name: string }) => <i data-icon={name} />,
}));

function shellOf(control: HTMLElement): HTMLElement {
  const shell = control.parentElement;
  if (!shell) throw new Error('field has no shell');
  return shell;
}

describe('TextArea', () => {
  it('renders a label associated with the textarea and forwards changes', () => {
    const onChange = vi.fn();
    render(<TextArea id="notes" label="Notes" value="" onChange={onChange} />);
    const control = screen.getByLabelText('Notes');
    fireEvent.change(control, { target: { value: 'Slept well' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('wires aria-invalid + aria-describedby to the error and hint', () => {
    render(
      <TextArea id="notes" label="Notes" error="Too long" hint="Optional" value="" onChange={() => {}} />
    );
    const control = screen.getByLabelText('Notes');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control.getAttribute('aria-describedby')).toContain('notes-error');
    expect(control.getAttribute('aria-describedby')).toContain('notes-hint');
  });

  it('top-aligns the shell and floors the box at 72px', () => {
    render(<TextArea id="notes" label="Notes" value="" onChange={() => {}} />);
    const control = screen.getByLabelText('Notes');
    const shell = shellOf(control);
    expect(shell.className).toContain('items-start');
    expect(shell.className).not.toContain('items-center');
    expect(shell.className).toContain('min-h-[44px]');
    expect(shell.className).toContain('focus-within:border-moss-light');
    expect(control.className).toContain('min-h-[72px]');
    expect(control.className).toContain('resize-y');
  });

  // The shell carries NO vertical padding — the textarea owns it, so a click
  // anywhere in the shell lands on the real control, not a dead zone. `items-
  // start` above is moot for sizing once `self-stretch` is on the control
  // (align-self wins over the parent's align-items), but is kept so a
  // textarea shorter than its shell (rare) still anchors to the top.
  it("gives the textarea, not the shell, the shell's vertical padding", () => {
    render(<TextArea id="notes" label="Notes" value="" onChange={() => {}} />);
    const control = screen.getByLabelText('Notes');
    expect(shellOf(control).className).not.toContain('py-3');
    expect(control.className).toContain('self-stretch');
    expect(control.className).toContain('py-3');
  });

  it('turns the shell terracotta and shows the alert glyph in the error state', () => {
    render(<TextArea id="notes" label="Notes" error="Too long" value="" onChange={() => {}} />);
    const shell = shellOf(screen.getByLabelText('Notes'));
    expect(shell.className).toContain('border-terracotta');
    expect(shell.className).not.toContain('moss-light');
    expect(document.querySelector('[data-icon="alert-circle-outline"]')).toBeInTheDocument();
  });

  it('dims the shell at 50% when disabled', () => {
    render(<TextArea id="notes" label="Notes" disabled value="" onChange={() => {}} />);
    expect(screen.getByLabelText('Notes')).toBeDisabled();
    expect(shellOf(screen.getByLabelText('Notes')).className).toContain('opacity-50');
  });
});
