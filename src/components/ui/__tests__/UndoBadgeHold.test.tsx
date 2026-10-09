// WCAG 2.2.1 Timing Adjustable: the badge reports a HOLD while the pointer is
// over it or keyboard focus is inside it, and releases once both have gone.
// The caller pauses its commit timer for exactly that span; the bar pauses too.
//
// jsdom answers `:focus-visible` with `false` for every focus, so "keyboard
// focus" vs "focus that followed a mouse click" is driven by stubbing that one
// selector.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { UndoBadge } from '../UndoBadge';

let keyboardFocus = true;
const realMatches = Element.prototype.matches;

beforeEach(() => {
  keyboardFocus = true;
  vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
    this: Element,
    selector: string
  ) {
    if (selector === ':focus-visible') return keyboardFocus;
    return realMatches.call(this, selector);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('[data-outside]').forEach((el) => el.remove());
});

function renderBadge(onHoldChange = vi.fn()) {
  // Something else holds focus, so the badge's mount focus-rescue stays out of the way.
  const outside = document.createElement('button');
  outside.setAttribute('data-outside', '');
  document.body.appendChild(outside);
  outside.focus();
  const view = render(
    <UndoBadge
      kind="taken"
      label="Taken"
      undoLabel="Undo"
      itemLabel="Metformin"
      onUndo={() => {}}
      onHoldChange={onHoldChange}
    />
  );
  const badge = screen.getByRole('status');
  const undo = screen.getByRole('button', { name: 'Undo Metformin' });
  const bar = badge.querySelector('[aria-hidden]:last-child') as HTMLElement;
  return { ...view, badge, undo, bar, outside, onHoldChange };
}

describe('UndoBadge hold', () => {
  it('holds while hovered and releases on leave; the bar pauses with it', () => {
    const { badge, bar, onHoldChange } = renderBadge();
    expect(bar.style.animation).toContain('running');

    fireEvent.pointerMove(badge);
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    expect(bar.style.animation).toContain('paused');

    fireEvent.pointerLeave(badge);
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
    expect(bar.style.animation).toContain('running');
    expect(onHoldChange).toHaveBeenCalledTimes(2);
  });

  it('holds while keyboard focus is inside, and releases when it leaves', () => {
    const { undo, outside, onHoldChange } = renderBadge();
    act(() => undo.focus());
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    act(() => outside.focus());
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });

  it('stays held until BOTH hover and focus have gone', () => {
    const { badge, undo, outside, onHoldChange } = renderBadge();
    fireEvent.pointerMove(badge);
    act(() => undo.focus());
    fireEvent.pointerLeave(badge);
    expect(onHoldChange).toHaveBeenCalledTimes(1);
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
    act(() => outside.focus());
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
    expect(onHoldChange).toHaveBeenCalledTimes(2);
  });

  it('does NOT hold for focus that only followed a mouse click (not :focus-visible)', () => {
    keyboardFocus = false;
    const { undo, onHoldChange } = renderBadge();
    act(() => undo.focus());
    expect(onHoldChange).not.toHaveBeenCalled();
  });

  // The badge replaces the button just clicked, so it appears UNDER a resting
  // cursor: Chrome then reports it hovered (pointerenter) with nobody moving.
  it('does NOT hold for a cursor that was merely resting where the badge appeared', () => {
    const { badge, onHoldChange } = renderBadge();
    fireEvent.pointerEnter(badge);
    expect(onHoldChange).not.toHaveBeenCalled();
    fireEvent.pointerMove(badge);
    expect(onHoldChange).toHaveBeenLastCalledWith(true);
  });

  it('does NOT hold for touch contact (no sticky hover on phones)', () => {
    const { badge, onHoldChange } = renderBadge();
    fireEvent.pointerMove(badge, { pointerType: 'touch' });
    expect(onHoldChange).not.toHaveBeenCalled();
  });

  it('releases the hold if it unmounts while held', () => {
    const { badge, unmount, onHoldChange } = renderBadge();
    fireEvent.pointerMove(badge);
    unmount();
    expect(onHoldChange).toHaveBeenLastCalledWith(false);
  });
});
