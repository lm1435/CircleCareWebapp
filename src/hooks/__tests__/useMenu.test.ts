import { createElement, type ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import { useMenu } from '../useMenu';

/**
 * A minimal WAI-ARIA menu-button harness wired straight to the hook, mirroring
 * the contract documented on `MenuApi`: a trigger button plus a panel of
 * `role="menuitem"` buttons. `hiddenLabels` lets a test stub `checkVisibility`
 * on specific items to simulate an `xl:hidden` row (L1) — jsdom has no native
 * `checkVisibility`, so without this the fallback treats every item as visible.
 */
function Harness({
  hiddenLabels = [],
  orientation,
}: {
  hiddenLabels?: string[];
  orientation?: 'vertical' | 'horizontal';
}): ReactElement {
  const menu = useMenu({ orientation });
  return createElement(
    'div',
    null,
    createElement(
      'button',
      {
        ref: menu.buttonRef,
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': menu.open,
        onClick: menu.toggle,
        onKeyDown: menu.onButtonKeyDown,
      },
      'Trigger'
    ),
    menu.open &&
      createElement(
        'div',
        { ref: menu.menuRef, role: 'menu', onKeyDown: menu.onMenuKeyDown },
        ['Alpha', 'Beta', 'Gamma', 'Delta'].map((label) =>
          createElement(
            'button',
            {
              key: label,
              type: 'button',
              role: 'menuitem',
              ref: (node: HTMLButtonElement | null): void => {
                if (node && hiddenLabels.includes(label)) {
                  // Simulate an `xl:hidden` row: present in the DOM, but not
                  // visible at the current breakpoint. jsdom implements no
                  // native `checkVisibility`, so this stub is how a test
                  // exercises the browser-only branch of the filter.
                  Object.assign(node, { checkVisibility: () => false });
                }
              },
            },
            label
          )
        )
      )
  );
}

function openMenu(props: Parameters<typeof Harness>[0] = {}): void {
  render(createElement(Harness, props));
  fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
}

describe('useMenu — item visibility filtering (L1)', () => {
  it('jsdom fallback: with no checkVisibility, every item counts and ArrowDown wraps across all four', () => {
    openMenu();

    const menuEl = screen.getByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();

    fireEvent.keyDown(menuEl, { key: 'ArrowDown' });
    fireEvent.keyDown(menuEl, { key: 'ArrowDown' });
    fireEvent.keyDown(menuEl, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Delta' })).toHaveFocus();

    // Wraps back to the first item, not stuck on the last.
    fireEvent.keyDown(menuEl, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
  });

  it('filters out items whose checkVisibility reports hidden, so ArrowDown/End skip them', () => {
    // Gamma and Delta are the `xl:hidden` rows — present in the DOM, hidden at
    // this breakpoint.
    openMenu({ hiddenLabels: ['Gamma', 'Delta'] });

    const menuEl = screen.getByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();

    // ArrowDown moves to the next VISIBLE item (Beta), not the hidden Gamma.
    fireEvent.keyDown(menuEl, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveFocus();

    // From the last visible item, ArrowDown wraps to the first — it does not
    // get stuck focusing (or trying to focus) a display:none node.
    fireEvent.keyDown(menuEl, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();

    // End jumps to the last VISIBLE item (Beta), not the actually-last-in-DOM
    // (but hidden) Delta.
    fireEvent.keyDown(menuEl, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveFocus();
  });

  it('ArrowUp opening the menu focuses the last VISIBLE item, not a hidden trailing row', () => {
    render(createElement(Harness, { hiddenLabels: ['Gamma', 'Delta'] }));
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    trigger.focus();

    fireEvent.keyDown(trigger, { key: 'ArrowUp' });

    expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveFocus();
  });
});

describe('useMenu — orientation', () => {
  it('horizontal orientation maps ArrowRight/ArrowLeft to next/previous instead of ArrowDown/ArrowUp', () => {
    openMenu({ orientation: 'horizontal' });

    const menuEl = screen.getByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();

    // Vertical keys are inert in horizontal mode.
    fireEvent.keyDown(menuEl, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();

    fireEvent.keyDown(menuEl, { key: 'ArrowRight' });
    expect(screen.getByRole('menuitem', { name: 'Beta' })).toHaveFocus();

    fireEvent.keyDown(menuEl, { key: 'ArrowLeft' });
    expect(screen.getByRole('menuitem', { name: 'Alpha' })).toHaveFocus();
  });
});
