import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from '../Checkbox';

/** The visible box — the aria-hidden span inside the checkbox button. */
function boxOf(button: HTMLElement): HTMLElement {
  const box = button.querySelector('[aria-hidden="true"]');
  if (!(box instanceof HTMLElement)) throw new Error('checkbox has no box');
  return box;
}

describe('Checkbox', () => {
  it('is a labelled checkbox reporting its state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="15 minutes before" />);
    const control = screen.getByRole('checkbox', { name: '15 minutes before' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    await user.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  // The reminders fieldset is the reason this primitive exists: one switch for
  // "may this entry notify at all", checkboxes for "which alerts". Same-role
  // controls would collapse that hierarchy back into six identical rows.
  it('is a checkbox, not a switch', () => {
    render(<Checkbox checked onChange={vi.fn()} label="At the scheduled time" />);
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'At the scheduled time' })).toBeInTheDocument();
  });

  it('clicking the label toggles the box', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="24 hours before" />);
    await user.click(screen.getByText('24 hours before'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('describes the checkbox by its hint', () => {
    render(
      <Checkbox
        checked
        onChange={vi.fn()}
        label="At the scheduled time"
        hint="The main alert"
        id="due"
      />
    );
    const control = screen.getByRole('checkbox', { name: 'At the scheduled time' });
    expect(control).toHaveAttribute('aria-describedby', 'due-hint');
    expect(document.getElementById('due-hint')).toHaveTextContent('The main alert');
  });

  it('drops aria-describedby when there is no hint', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="1 hour before" />);
    expect(screen.getByRole('checkbox', { name: '1 hour before' })).not.toHaveAttribute(
      'aria-describedby'
    );
  });

  it('keeps a 44px target around a 24px visible box, flush with the left edge', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="30 minutes before" />);
    const control = screen.getByRole('checkbox', { name: '30 minutes before' });
    // 10px of transparent padding on all four sides of a 24px box = 44.
    expect(control.className).toContain('py-2.5');
    expect(control.className).toContain('px-2.5');
    // ...and the left half is cancelled back out so the box does not indent.
    expect(control.className).toContain('-ml-2.5');
    const box = boxOf(control);
    expect(box.className).toContain('h-6');
    expect(box.className).toContain('w-6');
  });

  it('fills the box with moss and shows a check only when checked', () => {
    const { rerender } = render(
      <Checkbox checked={false} onChange={vi.fn()} label="15 minutes before" />
    );
    let box = boxOf(screen.getByRole('checkbox', { name: '15 minutes before' }));
    expect(box.className).toContain('border-line');
    expect(box.className).not.toContain('bg-moss');
    expect(box.querySelector('svg')).toBeNull();

    rerender(<Checkbox checked onChange={vi.fn()} label="15 minutes before" />);
    box = boxOf(screen.getByRole('checkbox', { name: '15 minutes before' }));
    expect(box.className).toContain('bg-moss');
    expect(box.querySelector('svg')).not.toBeNull();
  });

  // The global *:focus-visible ring lands on the button; a second hand-rolled
  // ring on the box would draw a different focus language from the rest of the app.
  it('draws no focus ring of its own', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="15 minutes before" />);
    const control = screen.getByRole('checkbox', { name: '15 minutes before' });
    expect(control.innerHTML).not.toContain('ring-');
    expect(control.className).not.toContain('ring-');
  });

  it('disables and dims at 50%', () => {
    render(<Checkbox checked={false} onChange={vi.fn()} label="15 minutes before" disabled />);
    const control = screen.getByRole('checkbox', { name: '15 minutes before' });
    expect(control).toBeDisabled();
    expect(control.className).toContain('opacity-50');
  });
});
