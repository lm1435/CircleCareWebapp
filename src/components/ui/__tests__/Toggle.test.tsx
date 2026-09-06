import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from '../Toggle';

/** The visible track — the aria-hidden span inside the switch button. */
function trackOf(button: HTMLElement): HTMLElement {
  const track = button.querySelector('[aria-hidden="true"]');
  if (!(track instanceof HTMLElement)) throw new Error('switch has no track');
  return track;
}

describe('Toggle', () => {
  it('is a labelled switch reporting its state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Reminders" />);
    const control = screen.getByRole('switch', { name: 'Reminders' });
    expect(control).toHaveAttribute('aria-checked', 'false');
    await user.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('describes the switch by its hint', () => {
    render(<Toggle checked onChange={vi.fn()} label="Reminders" hint="Sends a push" id="rem" />);
    const control = screen.getByRole('switch', { name: 'Reminders' });
    expect(control).toHaveAttribute('aria-describedby', 'rem-hint');
  });

  it('keeps a 44px target while the visible track stays a slim 24px switch', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Reminders" />);
    const control = screen.getByRole('switch', { name: 'Reminders' });
    // py-2.5 (10px) either side of the 24px track = 44.
    expect(control.className).toContain('py-2.5');
    const track = trackOf(control);
    expect(track.className).toContain('h-6');
    expect(track.className).toContain('w-11');
  });

  it('moves the track from line to moss and slides the thumb when checked', () => {
    const { rerender } = render(<Toggle checked={false} onChange={vi.fn()} label="Reminders" />);
    let track = trackOf(screen.getByRole('switch', { name: 'Reminders' }));
    expect(track.className).toContain('bg-line');
    expect(track.firstElementChild?.className).toContain('translate-x-0');

    rerender(<Toggle checked onChange={vi.fn()} label="Reminders" />);
    track = trackOf(screen.getByRole('switch', { name: 'Reminders' }));
    expect(track.className).toContain('bg-moss');
    expect(track.className).not.toContain('bg-line');
    expect(track.firstElementChild?.className).toContain('translate-x-5');
  });

  // The global *:focus-visible ring lands on the button; a second hand-rolled
  // ring on the track drew a different focus language from the rest of the app.
  it('draws no focus ring of its own', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Reminders" />);
    const control = screen.getByRole('switch', { name: 'Reminders' });
    expect(control.innerHTML).not.toContain('ring-');
    expect(control.className).not.toContain('ring-');
  });

  it('disables and dims at 50%', () => {
    render(<Toggle checked={false} onChange={vi.fn()} label="Reminders" disabled />);
    const control = screen.getByRole('switch', { name: 'Reminders' });
    expect(control).toBeDisabled();
    expect(control.className).toContain('opacity-50');
  });
});
